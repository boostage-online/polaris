import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  CorrectRecordSchema,
  LockSheetsSchema,
  MissingQuerySchema,
  PatchSheetSchema,
  RecordInputSchema,
  SheetsQuerySchema,
  SubmitSheetSchema,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor, page } from '../../../common/http/cursor';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  attendanceRecordRevisions,
  attendanceRecords,
  attendanceSheets,
  courseOfferings,
  courseTeachers,
  enrollments,
  groups,
  sessions,
  students,
  subjects,
  tenants,
  users,
} from '../../../database/schema';
import { CourseService, localDateParts, zonedDateTimeToUtc } from '../../academic';
import { AuditService } from '../../audit';
import { OutboxService } from '../../shared';
import {
  attendanceCorrected,
  attendanceSheetSubmitted,
  type MarkedStudent,
} from '../domain/events';
import { AttendancePolicy, rulesFrom, type Actor, type AttendanceRules } from '../domain/policies';
import { StatsService } from './stats.service';

export interface SessionContext {
  session: typeof sessions.$inferSelect;
  subjectName: string;
  groupName: string;
  groupId: string;
  teacherIds: string[];
}

/** Feuilles d'appel : ouverture, brouillon, soumission, corrections, verrouillage, appels manquants. */
@Injectable()
export class SheetService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly courses: CourseService,
    private readonly stats: StatsService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  // ---------------------------------------------------------------- contexte
  async tenant(tx: Db) {
    const t = await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) });
    if (!t) throw AppError.notFound('Établissement');
    return t;
  }
  async rules(tx: Db): Promise<AttendanceRules> {
    return rulesFrom((await this.tenant(tx)).settings);
  }
  async actor(tx: Db): Promise<Actor & { userId: string | null }> {
    const a = RequestContextStore.require().actor;
    return {
      permissions: new Set(a?.permissions ?? []),
      staffProfileId: await this.courses.staffProfileOfActor(tx),
      userId: a?.userId ?? null,
    };
  }

  async sessionContext(tx: Db, sessionId: string): Promise<SessionContext> {
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
        .where(eq(sessions.id, sessionId))
        .limit(1)
    )[0];
    if (!r) throw AppError.notFound('Séance');
    const teachers = await tx
      .select({ id: courseTeachers.staffProfileId })
      .from(courseTeachers)
      .where(eq(courseTeachers.courseOfferingId, r.s.courseOfferingId));
    return {
      session: r.s,
      subjectName: r.subjectName,
      groupName: r.groupName,
      groupId: r.groupId,
      teacherIds: teachers.map((t) => t.id),
    };
  }

  // ---------------------------------------------------------------- séances du jour
  /** Séances du jour (fuseau de l'établissement) de l'acteur, avec l'état de l'appel et la « prochaine ». */
  async today(date?: string) {
    const tx = this.db.current();
    const tenant = await this.tenant(tx);
    const actor = await this.actor(tx);
    const day = date ?? localDateParts(new Date(), tenant.timezone).date;
    const from = zonedDateTimeToUtc(day, '00:00', tenant.timezone);
    const to = new Date(from.getTime() + 24 * 3_600_000);
    const rows = await tx
      .select({
        s: sessions,
        subjectName: subjects.name,
        groupName: groups.name,
        groupId: groups.id,
        sheetId: attendanceSheets.id,
        sheetStatus: attendanceSheets.status,
      })
      .from(sessions)
      .innerJoin(courseOfferings, eq(courseOfferings.id, sessions.courseOfferingId))
      .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
      .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
      .leftJoin(attendanceSheets, eq(attendanceSheets.sessionId, sessions.id))
      .where(
        and(
          gte(sessions.startsAt, from),
          lt(sessions.startsAt, to),
          ne(sessions.status, 'CANCELLED'),
        ),
      )
      .orderBy(asc(sessions.startsAt));
    const teachers = await this.courses.teachersOf(tx, [
      ...new Set(rows.map((r) => r.s.courseOfferingId)),
    ]);
    const visible = rows.filter((r) =>
      AttendancePolicy.canView(
        actor,
        teachers
          .filter((t) => t.courseOfferingId === r.s.courseOfferingId)
          .map((t) => t.staffProfileId),
      ),
    );
    const counts = await this.countsForSheets(
      tx,
      visible.map((r) => r.sheetId).filter((x): x is string => x !== null),
    );
    const nextId = AttendancePolicy.nextSessionId(
      visible.map((r) => ({ id: r.s.id, endsAt: r.s.endsAt, sheetStatus: r.sheetStatus })),
      new Date(),
    );
    return visible.map((r) => ({
      id: r.s.id,
      startsAt: r.s.startsAt.toISOString(),
      endsAt: r.s.endsAt.toISOString(),
      subjectName: r.subjectName,
      groupName: r.groupName,
      groupId: r.groupId,
      room: r.s.room,
      status: r.s.status,
      sheet:
        r.sheetId && r.sheetStatus
          ? {
              id: r.sheetId,
              status: r.sheetStatus,
              counts: counts.get(r.sheetId) ?? { present: 0, absent: 0, late: 0 },
            }
          : null,
      isNext: r.s.id === nextId,
    }));
  }

  private async countsForSheets(tx: Db, sheetIds: string[]) {
    const map = new Map<string, { present: number; absent: number; late: number }>();
    if (sheetIds.length === 0) return map;
    const rows = await tx
      .select({
        sheetId: attendanceRecords.sheetId,
        present: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'PRESENT')::int`,
        absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'ABSENT')::int`,
        late: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'LATE')::int`,
      })
      .from(attendanceRecords)
      .where(inArray(attendanceRecords.sheetId, sheetIds))
      .groupBy(attendanceRecords.sheetId);
    for (const r of rows)
      map.set(r.sheetId, { present: r.present, absent: r.absent, late: r.late });
    return map;
  }

  // ---------------------------------------------------------------- ouverture
  /** Ouvre (ou retrouve) la feuille d'une séance : un enregistrement PRESENT par inscription active à la date. */
  async open(sessionId: string) {
    const tx = this.db.current();
    const ctx = await this.sessionContext(tx, sessionId);
    const actor = await this.actor(tx);
    if (!AttendancePolicy.canTake(actor, ctx.teacherIds))
      throw AppError.forbidden("Vous n'enseignez pas ce cours");
    if (ctx.session.status === 'CANCELLED') throw AppError.conflict('Séance annulée');
    const existing = await tx.query.attendanceSheets.findFirst({
      where: eq(attendanceSheets.sessionId, sessionId),
    });
    if (existing) return this.get(existing.id);

    const now = new Date();
    if (AttendancePolicy.tooEarly(ctx.session, now))
      throw AppError.validation([
        { path: 'sessionId', message: "L'appel ne peut s'ouvrir que 15 minutes avant la séance" },
      ]);
    const retroactive = AttendancePolicy.isRetroactive(ctx.session, now);
    if (retroactive && !actor.permissions.has('TAKE_ATTENDANCE_ANY'))
      throw AppError.forbidden('Saisie rétroactive réservée à la vie scolaire');

    const tenant = await this.tenant(tx);
    const day = localDateParts(ctx.session.startsAt, tenant.timezone).date;
    const enrolled = await tx
      .select({ studentId: enrollments.studentId })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          eq(enrollments.groupId, ctx.groupId),
          lte(enrollments.enrolledAt, day),
          or(isNull(enrollments.leftAt), gte(enrollments.leftAt, day)),
          isNull(students.deletedAt),
        ),
      );
    const sheetId = randomUUID();
    try {
      await tx.insert(attendanceSheets).values({
        id: sheetId,
        tenantId: this.tenantId,
        sessionId,
        status: 'DRAFT',
        version: 1,
        retroactive,
        openedBy: actor.userId,
        submittedBy: null,
        submittedAt: null,
        lockedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (e) {
      // Deux ouvertures simultanées : la contrainte UNIQUE(session_id) désigne le gagnant, l'autre relit.
      if ((e as { code?: string }).code === '23505') {
        const winner = await tx.query.attendanceSheets.findFirst({
          where: eq(attendanceSheets.sessionId, sessionId),
        });
        if (winner) return this.get(winner.id);
      }
      throw e;
    }
    if (enrolled.length > 0) {
      await tx.insert(attendanceRecords).values(
        enrolled.map((e) => ({
          id: randomUUID(),
          tenantId: this.tenantId,
          sheetId,
          sessionId,
          studentId: e.studentId,
          status: 'PRESENT' as const,
          excuseStatus: 'NONE' as const,
          lateMinutes: null,
          leftEarlyAt: null,
          note: null,
          updatedBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    await this.audit.record({
      action: 'attendance_sheet.opened',
      entityType: 'AttendanceSheet',
      entityId: sheetId,
      after: { sessionId, students: enrolled.length, retroactive },
    });
    return this.get(sheetId);
  }

  // ---------------------------------------------------------------- lecture
  async get(sheetId: string) {
    const tx = this.db.current();
    const sheet = await tx.query.attendanceSheets.findFirst({
      where: eq(attendanceSheets.id, sheetId),
    });
    if (!sheet) throw AppError.notFound("Feuille d'appel");
    const ctx = await this.sessionContext(tx, sheet.sessionId);
    const actor = await this.actor(tx);
    if (!AttendancePolicy.canView(actor, ctx.teacherIds))
      throw AppError.notFound("Feuille d'appel");
    const records = await tx
      .select({
        r: attendanceRecords,
        firstName: students.firstName,
        lastName: students.lastName,
        matricule: students.matricule,
      })
      .from(attendanceRecords)
      .innerJoin(students, eq(students.id, attendanceRecords.studentId))
      .where(eq(attendanceRecords.sheetId, sheetId))
      .orderBy(asc(students.lastName), asc(students.firstName));
    return this.dto(sheet, ctx, records);
  }

  async bySession(sessionId: string) {
    const tx = this.db.current();
    const sheet = await tx.query.attendanceSheets.findFirst({
      where: eq(attendanceSheets.sessionId, sessionId),
    });
    if (!sheet) {
      // 404 « séance » si elle n'existe pas, 404 « feuille » si elle existe sans appel.
      await this.sessionContext(tx, sessionId);
      throw AppError.notFound("Feuille d'appel");
    }
    return this.get(sheet.id);
  }

  async list(query: z.infer<typeof SheetsQuerySchema>) {
    const tx = this.db.current();
    const actor = await this.actor(tx);
    const tenant = await this.tenant(tx);
    const cur = decodeCursor<{ t: string; id: string }>(query.cursor);
    const conds = [
      query.from
        ? gte(sessions.startsAt, zonedDateTimeToUtc(query.from, '00:00', tenant.timezone))
        : undefined,
      query.to
        ? lt(
            sessions.startsAt,
            new Date(
              zonedDateTimeToUtc(query.to, '00:00', tenant.timezone).getTime() + 24 * 3_600_000,
            ),
          )
        : undefined,
      query.groupId ? eq(courseOfferings.groupId, query.groupId) : undefined,
      query.status ? eq(attendanceSheets.status, query.status) : undefined,
      cur
        ? sql`(${sessions.startsAt}, ${attendanceSheets.id}) < (${new Date(cur.t)}, ${cur.id}::uuid)`
        : undefined,
    ];
    const mineOnly = query.mine || !AttendancePolicy.canView(actor, []);
    if (mineOnly) {
      if (!actor.staffProfileId)
        return { data: [], meta: { nextCursor: null, limit: query.limit } };
      conds.push(
        sql`exists (select 1 from course_teachers ct where ct.course_offering_id = ${sessions.courseOfferingId} and ct.staff_profile_id = ${actor.staffProfileId}::uuid)`,
      );
    }
    const rows = await tx
      .select({
        sh: attendanceSheets,
        s: sessions,
        subjectName: subjects.name,
        groupName: groups.name,
        groupId: groups.id,
      })
      .from(attendanceSheets)
      .innerJoin(sessions, eq(sessions.id, attendanceSheets.sessionId))
      .innerJoin(courseOfferings, eq(courseOfferings.id, sessions.courseOfferingId))
      .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
      .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
      .where(and(...conds))
      .orderBy(desc(sessions.startsAt), desc(attendanceSheets.id))
      .limit(query.limit + 1);
    const counts = await this.countsForSheets(
      tx,
      rows.map((r) => r.sh.id),
    );
    return page(
      rows.map((r) => ({
        ...this.sheetDto(r.sh),
        session: this.sessionDto(r.s, r.subjectName, r.groupName, r.groupId),
        counts: counts.get(r.sh.id) ?? { present: 0, absent: 0, late: 0 },
      })),
      query.limit,
      (last) => ({ t: last.session.startsAt, id: last.id }),
    );
  }

  // ---------------------------------------------------------------- brouillon et soumission
  async patch(sheetId: string, input: z.infer<typeof PatchSheetSchema>) {
    const tx = this.db.current();
    const { sheet, ctx, actor, rules } = await this.loadForWrite(tx, sheetId);
    if (sheet.status !== 'DRAFT')
      throw AppError.conflict('Feuille déjà soumise : utilisez une correction', 'CONFLICT', {
        status: sheet.status,
      });
    this.assertVersion(sheet, input.version);
    await this.applyRecords(tx, sheet, ctx, rules, input.records, actor.userId);
    await tx
      .update(attendanceSheets)
      .set({ version: sheet.version + 1 })
      .where(eq(attendanceSheets.id, sheetId));
    return this.get(sheetId);
  }

  async submit(sheetId: string, input: z.infer<typeof SubmitSheetSchema>) {
    const tx = this.db.current();
    const { sheet, ctx, actor, rules } = await this.loadForWrite(tx, sheetId);
    if (sheet.status !== 'DRAFT')
      throw AppError.conflict('Feuille déjà soumise', 'CONFLICT', { status: sheet.status });
    this.assertVersion(sheet, input.version);
    if (input.records) await this.applyRecords(tx, sheet, ctx, rules, input.records, actor.userId);
    const now = new Date();
    await tx
      .update(attendanceSheets)
      .set({
        status: 'SUBMITTED',
        version: sheet.version + 1,
        submittedAt: now,
        submittedBy: actor.userId,
      })
      .where(eq(attendanceSheets.id, sheetId));
    if (ctx.session.status === 'PLANNED')
      await tx.update(sessions).set({ status: 'HELD' }).where(eq(sessions.id, ctx.session.id));

    const recs = await tx.query.attendanceRecords.findMany({
      where: eq(attendanceRecords.sheetId, sheetId),
    });
    const marked: MarkedStudent[] = recs
      .filter((r) => r.status !== 'PRESENT')
      .map((r) => ({
        studentId: r.studentId,
        recordId: r.id,
        status: r.status as 'ABSENT' | 'LATE',
        lateMinutes: r.lateMinutes,
      }));
    await this.audit.record({
      action: 'attendance_sheet.submitted',
      entityType: 'AttendanceSheet',
      entityId: sheetId,
      after: {
        sessionId: ctx.session.id,
        total: recs.length,
        absent: marked.filter((m) => m.status === 'ABSENT').length,
        late: marked.filter((m) => m.status === 'LATE').length,
        retroactive: sheet.retroactive,
      },
    });
    await this.outbox.publish(
      attendanceSheetSubmitted({
        tenantId: this.tenantId,
        sheetId,
        sessionId: ctx.session.id,
        startsAt: ctx.session.startsAt.toISOString(),
        subjectName: ctx.subjectName,
        groupName: ctx.groupName,
        marked,
        retroactive: sheet.retroactive,
      }),
    );
    await this.stats.afterChange(
      tx,
      recs.map((r) => r.studentId),
      rules,
    );
    return this.get(sheetId);
  }

  private async loadForWrite(tx: Db, sheetId: string) {
    const sheet = await tx.query.attendanceSheets.findFirst({
      where: eq(attendanceSheets.id, sheetId),
    });
    if (!sheet) throw AppError.notFound("Feuille d'appel");
    const ctx = await this.sessionContext(tx, sheet.sessionId);
    const actor = await this.actor(tx);
    if (!AttendancePolicy.canView(actor, ctx.teacherIds))
      throw AppError.notFound("Feuille d'appel");
    if (!AttendancePolicy.canTake(actor, ctx.teacherIds))
      throw AppError.forbidden("Vous n'enseignez pas ce cours");
    const rules = await this.rules(tx);
    return { sheet, ctx, actor, rules };
  }

  private assertVersion(sheet: typeof attendanceSheets.$inferSelect, version: number) {
    if (sheet.version !== version)
      throw AppError.conflict(
        'La feuille a été modifiée entre-temps : rechargez-la',
        'VERSION_CONFLICT',
        { currentVersion: sheet.version },
      );
  }

  /** Applique des saisies à une feuille DRAFT ; un élève sans enregistrement (pas inscrit) → 422 détaillé. */
  private async applyRecords(
    tx: Db,
    sheet: typeof attendanceSheets.$inferSelect,
    ctx: SessionContext,
    rules: AttendanceRules,
    inputs: z.infer<typeof RecordInputSchema>[],
    userId: string | null,
  ) {
    if (inputs.length === 0) return;
    const existing = await tx.query.attendanceRecords.findMany({
      where: eq(attendanceRecords.sheetId, sheet.id),
    });
    const byStudent = new Map(existing.map((r) => [r.studentId, r]));
    const errors: { path: string; message: string }[] = [];
    const updates: {
      id: string;
      status: 'PRESENT' | 'ABSENT' | 'LATE';
      lateMinutes: number | null;
      leftEarlyAt: Date | null;
      note: string | null;
    }[] = [];
    inputs.forEach((input, i) => {
      const rec = byStudent.get(input.studentId);
      if (!rec) {
        errors.push({
          path: `records[${i}].studentId`,
          message: 'Élève sans inscription active dans ce groupe à la date de la séance',
        });
        return;
      }
      const n = AttendancePolicy.normalize(input, ctx.session, rules);
      for (const m of n.errors) errors.push({ path: `records[${i}]`, message: m });
      if (n.errors.length === 0)
        updates.push({
          id: rec.id,
          status: n.status,
          lateMinutes: n.lateMinutes,
          leftEarlyAt: n.leftEarlyAt,
          note: n.note,
        });
    });
    if (errors.length) throw AppError.validation(errors);
    for (const u of updates) {
      await tx
        .update(attendanceRecords)
        .set({
          status: u.status,
          lateMinutes: u.lateMinutes,
          leftEarlyAt: u.leftEarlyAt,
          note: u.note,
          updatedBy: userId,
        })
        .where(eq(attendanceRecords.id, u.id));
    }
  }

  // ---------------------------------------------------------------- corrections
  async correct(recordId: string, input: z.infer<typeof CorrectRecordSchema>) {
    const tx = this.db.current();
    const rec = await tx.query.attendanceRecords.findFirst({
      where: eq(attendanceRecords.id, recordId),
    });
    if (!rec) throw AppError.notFound('Enregistrement');
    const sheet = (await tx.query.attendanceSheets.findFirst({
      where: eq(attendanceSheets.id, rec.sheetId),
    }))!;
    const ctx = await this.sessionContext(tx, rec.sessionId);
    const actor = await this.actor(tx);
    if (!AttendancePolicy.canView(actor, ctx.teacherIds)) throw AppError.notFound('Enregistrement');
    if (sheet.status === 'DRAFT')
      throw AppError.conflict("La feuille n'est pas soumise : modifiez le brouillon");
    const rules = await this.rules(tx);
    const mode = AttendancePolicy.correctionMode(
      actor,
      sheet.status,
      ctx.session,
      new Date(),
      rules,
    );
    if (!mode)
      throw AppError.forbidden(
        sheet.status === 'LOCKED'
          ? 'Feuille verrouillée : correction réservée à la vie scolaire'
          : 'Hors fenêtre de correction : correction réservée à la vie scolaire',
      );
    const n = AttendancePolicy.normalize(input, ctx.session, rules);
    if (n.errors.length)
      throw AppError.validation(n.errors.map((m) => ({ path: 'record', message: m })));
    const statusChanged = n.status !== rec.status || n.lateMinutes !== rec.lateMinutes;
    await tx
      .update(attendanceRecords)
      .set({
        status: n.status,
        lateMinutes: n.lateMinutes,
        leftEarlyAt: n.leftEarlyAt,
        note: input.note === undefined ? rec.note : n.note,
        updatedBy: actor.userId,
        // Un enregistrement qui redevient PRESENT n'a plus d'excuse à porter.
        excuseStatus: n.status === 'PRESENT' ? 'NONE' : rec.excuseStatus,
      })
      .where(eq(attendanceRecords.id, recordId));
    const revisionId = randomUUID();
    await tx.insert(attendanceRecordRevisions).values({
      id: revisionId,
      tenantId: this.tenantId,
      recordId,
      beforeStatus: rec.status,
      afterStatus: n.status,
      beforeLateMinutes: rec.lateMinutes,
      afterLateMinutes: n.lateMinutes,
      reason: input.reason,
      outOfWindow: mode.outOfWindow,
      authorId: actor.userId,
      createdAt: new Date(),
    });
    await this.audit.record({
      action: mode.outOfWindow
        ? 'attendance_record.corrected_out_of_window'
        : 'attendance_record.corrected',
      entityType: 'AttendanceRecord',
      entityId: recordId,
      before: { status: rec.status, lateMinutes: rec.lateMinutes },
      after: { status: n.status, lateMinutes: n.lateMinutes, reason: input.reason },
    });
    if (statusChanged) {
      await this.outbox.publish(
        attendanceCorrected({
          tenantId: this.tenantId,
          recordId,
          sessionId: rec.sessionId,
          studentId: rec.studentId,
          from: rec.status,
          to: n.status,
          startsAt: ctx.session.startsAt.toISOString(),
          subjectName: ctx.subjectName,
          reason: input.reason,
        }),
      );
      await this.stats.afterChange(tx, [rec.studentId], rules);
    }
    return this.get(sheet.id);
  }

  async revisions(recordId: string) {
    const tx = this.db.current();
    const rec = await tx.query.attendanceRecords.findFirst({
      where: eq(attendanceRecords.id, recordId),
    });
    if (!rec) throw AppError.notFound('Enregistrement');
    const ctx = await this.sessionContext(tx, rec.sessionId);
    if (!AttendancePolicy.canView(await this.actor(tx), ctx.teacherIds))
      throw AppError.notFound('Enregistrement');
    const rows = await tx
      .select({ r: attendanceRecordRevisions, authorName: users.displayName })
      .from(attendanceRecordRevisions)
      .leftJoin(users, eq(users.id, attendanceRecordRevisions.authorId))
      .where(eq(attendanceRecordRevisions.recordId, recordId))
      .orderBy(desc(attendanceRecordRevisions.createdAt));
    return rows.map(({ r, authorName }) => ({
      id: r.id,
      recordId: r.recordId,
      beforeStatus: r.beforeStatus,
      afterStatus: r.afterStatus,
      beforeLateMinutes: r.beforeLateMinutes,
      afterLateMinutes: r.afterLateMinutes,
      reason: r.reason,
      outOfWindow: r.outOfWindow,
      authorId: r.authorId,
      authorName,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------- verrouillage et appels manquants
  async lock(input: z.infer<typeof LockSheetsSchema>) {
    const tx = this.db.current();
    const tenant = await this.tenant(tx);
    const from = zonedDateTimeToUtc(input.from, '00:00', tenant.timezone);
    const to = new Date(
      zonedDateTimeToUtc(input.to, '00:00', tenant.timezone).getTime() + 24 * 3_600_000,
    );
    const ids = await tx
      .select({ id: attendanceSheets.id })
      .from(attendanceSheets)
      .innerJoin(sessions, eq(sessions.id, attendanceSheets.sessionId))
      .innerJoin(courseOfferings, eq(courseOfferings.id, sessions.courseOfferingId))
      .where(
        and(
          gte(sessions.startsAt, from),
          lt(sessions.startsAt, to),
          input.groupId ? eq(courseOfferings.groupId, input.groupId) : undefined,
          eq(attendanceSheets.status, input.action === 'LOCK' ? 'SUBMITTED' : 'LOCKED'),
        ),
      );
    if (ids.length > 0) {
      await tx
        .update(attendanceSheets)
        .set(
          input.action === 'LOCK'
            ? { status: 'LOCKED', lockedAt: new Date() }
            : { status: 'SUBMITTED', lockedAt: null },
        )
        .where(
          inArray(
            attendanceSheets.id,
            ids.map((i) => i.id),
          ),
        );
    }
    await this.audit.record({
      action: input.action === 'LOCK' ? 'attendance_sheets.locked' : 'attendance_sheets.unlocked',
      entityType: 'AttendanceSheet',
      after: { ...input, count: ids.length },
    });
    return { count: ids.length };
  }

  /** Séances terminées sans feuille soumise (par défaut : 7 derniers jours). */
  async missing(query: z.infer<typeof MissingQuerySchema>) {
    const tx = this.db.current();
    const tenant = await this.tenant(tx);
    const today = localDateParts(new Date(), tenant.timezone).date;
    const fromDay =
      query.from ??
      new Date(zonedDateTimeToUtc(today, '00:00', tenant.timezone).getTime() - 7 * 24 * 3_600_000)
        .toISOString()
        .slice(0, 10);
    const from = zonedDateTimeToUtc(fromDay, '00:00', tenant.timezone);
    const to = query.to
      ? new Date(zonedDateTimeToUtc(query.to, '00:00', tenant.timezone).getTime() + 24 * 3_600_000)
      : new Date();
    const rows = await tx
      .select({
        s: sessions,
        subjectName: subjects.name,
        groupName: groups.name,
        sheetStatus: attendanceSheets.status,
      })
      .from(sessions)
      .innerJoin(courseOfferings, eq(courseOfferings.id, sessions.courseOfferingId))
      .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
      .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
      .leftJoin(attendanceSheets, eq(attendanceSheets.sessionId, sessions.id))
      .where(
        and(
          gte(sessions.startsAt, from),
          lt(sessions.endsAt, to),
          ne(sessions.status, 'CANCELLED'),
          query.groupId ? eq(courseOfferings.groupId, query.groupId) : undefined,
          or(
            isNull(attendanceSheets.id),
            notInArray(attendanceSheets.status, ['SUBMITTED', 'LOCKED']),
          ),
        ),
      )
      .orderBy(desc(sessions.startsAt));
    const teachers = await this.courses.teachersOf(tx, [
      ...new Set(rows.map((r) => r.s.courseOfferingId)),
    ]);
    return rows.map((r) => ({
      sessionId: r.s.id,
      startsAt: r.s.startsAt.toISOString(),
      endsAt: r.s.endsAt.toISOString(),
      subjectName: r.subjectName,
      groupName: r.groupName,
      teachers: teachers
        .filter((t) => t.courseOfferingId === r.s.courseOfferingId)
        .map((t) => ({ staffProfileId: t.staffProfileId, displayName: t.displayName })),
      sheetStatus: r.sheetStatus ?? null,
    }));
  }

  // ---------------------------------------------------------------- dto
  private sheetDto(sh: typeof attendanceSheets.$inferSelect) {
    return {
      id: sh.id,
      sessionId: sh.sessionId,
      status: sh.status,
      version: sh.version,
      retroactive: sh.retroactive,
      openedAt: sh.createdAt.toISOString(),
      submittedAt: sh.submittedAt?.toISOString() ?? null,
      submittedBy: sh.submittedBy,
      lockedAt: sh.lockedAt?.toISOString() ?? null,
    };
  }
  private sessionDto(
    s: typeof sessions.$inferSelect,
    subjectName: string,
    groupName: string,
    groupId: string,
  ) {
    return {
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      subjectName,
      groupName,
      groupId,
      room: s.room,
      status: s.status,
    };
  }
  private dto(
    sh: typeof attendanceSheets.$inferSelect,
    ctx: SessionContext,
    records: {
      r: typeof attendanceRecords.$inferSelect;
      firstName: string;
      lastName: string;
      matricule: string;
    }[],
  ) {
    return {
      ...this.sheetDto(sh),
      session: this.sessionDto(ctx.session, ctx.subjectName, ctx.groupName, ctx.groupId),
      counts: {
        present: records.filter((x) => x.r.status === 'PRESENT').length,
        absent: records.filter((x) => x.r.status === 'ABSENT').length,
        late: records.filter((x) => x.r.status === 'LATE').length,
      },
      records: records.map(({ r, firstName, lastName, matricule }) => ({
        id: r.id,
        studentId: r.studentId,
        student: { firstName, lastName, matricule },
        status: r.status,
        excuseStatus: r.excuseStatus,
        lateMinutes: r.lateMinutes,
        leftEarlyAt: r.leftEarlyAt?.toISOString() ?? null,
        note: r.note,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }
}
