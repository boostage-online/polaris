import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  CreateSessionSchema,
  GenerateSessionsSchema,
  SessionsQuerySchema,
  UpdateSessionSchema,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor, page } from '../../../common/http/cursor';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  academicYears,
  courseOfferings,
  courseTeachers,
  groups,
  scheduleSlots,
  sessions,
  subjects,
  tenants,
} from '../../../database/schema';
import { AuditService } from '../../audit';
import { SchedulePolicy } from '../domain/policies';
import { addDays, localDateParts, zonedDateTimeToUtc } from '../domain/tz';
import { CourseService } from './course.service';
import { StructureService } from './structure.service';

/** Séances concrètes : génération depuis les créneaux, création manuelle, déplacement, annulation, vues enseignant. */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly courses: CourseService,
    private readonly structure: StructureService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  /**
   * Génère les séances des `horizonDays` prochains jours depuis les créneaux récurrents de l'année courante.
   * Idempotent : `ON CONFLICT (tenant_id, course_offering_id, starts_at) DO NOTHING`.
   * Appelée par le cron quotidien du worker (pour chaque tenant) et à la demande par l'administrateur.
   */
  async generate(
    input: z.infer<typeof GenerateSessionsSchema>,
    tx: Db = this.db.current(),
  ): Promise<{ created: number; scanned: number }> {
    const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) });
    const year = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    if (!tenant || !year) return { created: 0, scanned: 0 };
    const tz = tenant.timezone;
    const slots = await tx
      .select({ s: scheduleSlots, courseId: courseOfferings.id })
      .from(scheduleSlots)
      .innerJoin(courseOfferings, eq(courseOfferings.id, scheduleSlots.courseOfferingId))
      .where(
        and(
          eq(courseOfferings.academicYearId, year.id),
          isNull(scheduleSlots.deletedAt),
          isNull(courseOfferings.deletedAt),
        ),
      );
    if (slots.length === 0) return { created: 0, scanned: 0 };

    const today = localDateParts(new Date(), tz).date;
    const values: (typeof sessions.$inferInsert)[] = [];
    for (let i = 0; i < input.horizonDays; i++) {
      const date = addDays(today, i);
      if (date < year.startDate || date > year.endDate) continue;
      const weekday = localDateParts(zonedDateTimeToUtc(date, '12:00', tz), tz).isoWeekday;
      for (const { s, courseId } of slots) {
        if (s.weekday !== weekday) continue;
        if (s.validFrom && date < s.validFrom) continue;
        if (s.validTo && date > s.validTo) continue;
        values.push({
          id: randomUUID(),
          tenantId: this.tenantId,
          courseOfferingId: courseId,
          scheduleSlotId: s.id,
          startsAt: zonedDateTimeToUtc(date, s.startTime.slice(0, 5), tz),
          endsAt: zonedDateTimeToUtc(date, s.endTime.slice(0, 5), tz),
          status: 'PLANNED',
          room: s.room,
          cancelReason: null,
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }
    let created = 0;
    for (let i = 0; i < values.length; i += 500) {
      const chunk = values.slice(i, i + 500);
      const res = await tx
        .insert(sessions)
        .values(chunk)
        .onConflictDoNothing({
          target: [sessions.tenantId, sessions.courseOfferingId, sessions.startsAt],
        })
        .returning({ id: sessions.id });
      created += res.length;
    }
    return { created, scanned: values.length };
  }

  async list(query: z.infer<typeof SessionsQuerySchema>) {
    const tx = this.db.current();
    const cur = decodeCursor<{ t: string; id: string }>(query.cursor);
    const conds = [
      query.from ? gte(sessions.startsAt, new Date(query.from)) : undefined,
      query.to ? lte(sessions.startsAt, new Date(query.to)) : undefined,
      query.groupId ? eq(courseOfferings.groupId, query.groupId) : undefined,
      query.courseOfferingId ? eq(sessions.courseOfferingId, query.courseOfferingId) : undefined,
      query.status ? eq(sessions.status, query.status) : undefined,
      cur
        ? sql`(${sessions.startsAt}, ${sessions.id}) > (${new Date(cur.t)}, ${cur.id}::uuid)`
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const rows = await tx
      .select({
        s: sessions,
        subjectName: subjects.name,
        groupName: groups.name,
        groupId: groups.id,
      })
      .from(sessions)
      .innerJoin(courseOfferings, eq(courseOfferings.id, sessions.courseOfferingId))
      .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
      .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
      .where(conds.length ? and(...conds) : sql`true`)
      .orderBy(asc(sessions.startsAt), asc(sessions.id))
      .limit(query.limit + 1);
    const teachers = await this.courses.teachersOf(tx, [
      ...new Set(rows.map((r) => r.s.courseOfferingId)),
    ]);
    return page(
      rows.map((r) => this.dto(r.s, r, teachers)),
      query.limit,
      (last) => ({ t: last.startsAt, id: last.id }),
    );
  }

  /** Séances de l'acteur : ses cours, ou toutes avec une portée globale. */
  async mine(query: { from?: string; to?: string; limit: number; cursor?: string }) {
    const tx = this.db.current();
    const actor = RequestContextStore.require().actor!;
    const perms = new Set(actor.permissions ?? []);
    const spId = await this.courses.staffProfileOfActor(tx);
    if (SchedulePolicy.canSeeSession({ permissions: perms, staffProfileId: spId }, [])) {
      return this.list({ ...query, limit: query.limit });
    }
    if (!spId) return { data: [], meta: { nextCursor: null, limit: query.limit } };
    const own = await tx
      .select({ id: courseTeachers.courseOfferingId })
      .from(courseTeachers)
      .where(eq(courseTeachers.staffProfileId, spId));
    if (own.length === 0) return { data: [], meta: { nextCursor: null, limit: query.limit } };
    const cur = decodeCursor<{ t: string; id: string }>(query.cursor);
    const rows = await tx
      .select({
        s: sessions,
        subjectName: subjects.name,
        groupName: groups.name,
        groupId: groups.id,
      })
      .from(sessions)
      .innerJoin(courseOfferings, eq(courseOfferings.id, sessions.courseOfferingId))
      .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
      .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
      .where(
        and(
          inArray(
            sessions.courseOfferingId,
            own.map((o) => o.id),
          ),
          query.from ? gte(sessions.startsAt, new Date(query.from)) : undefined,
          query.to ? lte(sessions.startsAt, new Date(query.to)) : undefined,
          cur
            ? sql`(${sessions.startsAt}, ${sessions.id}) > (${new Date(cur.t)}, ${cur.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(sessions.startsAt), asc(sessions.id))
      .limit(query.limit + 1);
    const teachers = await this.courses.teachersOf(tx, [
      ...new Set(rows.map((r) => r.s.courseOfferingId)),
    ]);
    return page(
      rows.map((r) => this.dto(r.s, r, teachers)),
      query.limit,
      (last) => ({ t: last.startsAt, id: last.id }),
    );
  }

  async create(courseId: string, input: z.infer<typeof CreateSessionSchema>) {
    const tx = this.db.current();
    const course = await tx.query.courseOfferings.findFirst({
      where: and(eq(courseOfferings.id, courseId), isNull(courseOfferings.deletedAt)),
    });
    if (!course) throw AppError.notFound('Cours');
    const id = randomUUID();
    try {
      await tx.insert(sessions).values({
        id,
        tenantId: this.tenantId,
        courseOfferingId: courseId,
        scheduleSlotId: null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        status: 'PLANNED',
        room: input.room ?? null,
        cancelReason: null,
        createdBy: RequestContextStore.require().actor?.userId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw AppError.conflict('Une séance de ce cours commence déjà à cet instant');
      throw e;
    }
    await this.audit.record({
      action: 'session.created',
      entityType: 'Session',
      entityId: id,
      after: { courseId, ...input },
    });
    return this.get(id);
  }

  async get(id: string) {
    const tx = this.db.current();
    const r = (
      await tx
        .select({
          s: sessions,
          subjectName: subjects.name,
          groupName: groups.name,
          groupId: groups.id,
        })
        .from(sessions)
        .innerJoin(courseOfferings, eq(courseOfferings.id, sessions.courseOfferingId))
        .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
        .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
        .where(eq(sessions.id, id))
        .limit(1)
    )[0];
    if (!r) throw AppError.notFound('Séance');
    const teachers = await this.courses.teachersOf(tx, [r.s.courseOfferingId]);
    return this.dto(r.s, r, teachers);
  }

  async update(id: string, patch: z.infer<typeof UpdateSessionSchema>) {
    const tx = this.db.current();
    const before = await this.get(id);
    // Phase 3 : interdira le déplacement/l'annulation d'une séance dont la feuille d'appel est soumise.
    if (patch.status === 'CANCELLED' && !patch.cancelReason)
      throw AppError.validation([{ path: 'cancelReason', message: "Motif d'annulation requis" }]);
    const starts = patch.startsAt ? new Date(patch.startsAt) : new Date(before.startsAt);
    const ends = patch.endsAt ? new Date(patch.endsAt) : new Date(before.endsAt);
    if (ends <= starts)
      throw AppError.validation([{ path: 'endsAt', message: 'La fin doit suivre le début' }]);
    try {
      await tx
        .update(sessions)
        .set({
          startsAt: starts,
          endsAt: ends,
          room: patch.room === undefined ? undefined : patch.room,
          status: patch.status,
          cancelReason: patch.cancelReason === undefined ? undefined : patch.cancelReason,
        })
        .where(eq(sessions.id, id));
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw AppError.conflict('Une séance de ce cours commence déjà à cet instant');
      throw e;
    }
    const after = await this.get(id);
    await this.audit.record({
      action: patch.status === 'CANCELLED' ? 'session.cancelled' : 'session.updated',
      entityType: 'Session',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  private dto(
    s: typeof sessions.$inferSelect,
    names: { subjectName: string; groupName: string; groupId: string },
    teachers: { courseOfferingId: string; staffProfileId: string; displayName: string | null }[],
  ) {
    return {
      id: s.id,
      courseOfferingId: s.courseOfferingId,
      subjectName: names.subjectName,
      groupName: names.groupName,
      groupId: names.groupId,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      status: s.status,
      room: s.room,
      cancelReason: s.cancelReason,
      teachers: teachers
        .filter((t) => t.courseOfferingId === s.courseOfferingId)
        .map((t) => ({ staffProfileId: t.staffProfileId, displayName: t.displayName })),
    };
  }
}
