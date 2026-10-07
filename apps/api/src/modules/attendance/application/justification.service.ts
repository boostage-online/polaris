import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  CreateJustificationSchema,
  JustificationsQuerySchema,
  ReviewJustificationSchema,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor, page } from '../../../common/http/cursor';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  absenceJustifications,
  attendanceRecords,
  attendanceSheets,
  justificationRecords,
  sessions,
  students,
  tenants,
  users,
} from '../../../database/schema';
import { AuditService } from '../../audit';
import { OutboxService } from '../../shared';
import { GuardianService } from '../../students-guardians';
import { justificationReviewed, justificationSubmitted } from '../domain/events';
import { rulesFrom } from '../domain/policies';
import { StatsService } from './stats.service';

/** Justificatifs d'absence : dépôt (vie scolaire ou parent autorisé), file de traitement, décision. */
@Injectable()
export class JustificationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly guardians: GuardianService,
    private readonly stats: StatsService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  /** Dépôt par le personnel (REVIEW_JUSTIFICATION ou TAKE_ATTENDANCE_ANY). */
  async create(input: z.infer<typeof CreateJustificationSchema>) {
    return this.createAs(input, 'STAFF');
  }

  /** Dépôt par un tuteur : règle tenant activée et droit `can_justify` sur cet enfant. */
  async createAsGuardian(input: z.infer<typeof CreateJustificationSchema>) {
    const tx = this.db.current();
    // 404 d'abord (pas mon enfant), 403 ensuite (règle de l'établissement).
    await this.guardians.assertGuardianAccess(input.studentId, 'justify', tx);
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
    if (!rulesFrom(tenant.settings).guardianJustificationsEnabled)
      throw AppError.forbidden(
        "Cet établissement n'accepte pas les justificatifs déposés par les parents",
      );
    return this.createAs(input, 'GUARDIAN');
  }

  private async createAs(
    input: z.infer<typeof CreateJustificationSchema>,
    kind: 'STAFF' | 'GUARDIAN',
  ) {
    const tx = this.db.current();
    const student = await tx.query.students.findFirst({
      where: and(eq(students.id, input.studentId), isNull(students.deletedAt)),
    });
    if (!student) throw AppError.notFound('Élève');
    const id = randomUUID();
    const actor = RequestContextStore.require().actor;
    await tx.insert(absenceJustifications).values({
      id,
      tenantId: this.tenantId,
      studentId: input.studentId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      reason: input.reason.trim(),
      documentKey: input.documentName ?? null,
      status: 'PENDING',
      submittedBy: actor?.userId ?? null,
      submittedByKind: kind,
      reviewedBy: null,
      reviewedAt: null,
      reviewComment: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const attached = await this.attachRecords(
      tx,
      id,
      input.studentId,
      input.fromDate,
      input.toDate,
    );
    await this.audit.record({
      action: 'justification.submitted',
      entityType: 'AbsenceJustification',
      entityId: id,
      after: { ...input, kind, records: attached },
    });
    await this.outbox.publish(
      justificationSubmitted({
        tenantId: this.tenantId,
        justificationId: id,
        studentId: input.studentId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        submittedByKind: kind,
      }),
    );
    return this.get(id);
  }

  /** Rattache les enregistrements ABSENT/LATE soumis de l'intervalle et les passe en attente d'excuse. */
  private async attachRecords(
    tx: Db,
    justificationId: string,
    studentId: string,
    from: string,
    to: string,
  ) {
    const tz =
      (
        await tx.query.tenants.findFirst({
          where: eq(tenants.id, this.tenantId),
          columns: { timezone: true },
        })
      )?.timezone ?? 'UTC';
    const recs = await tx
      .select({ id: attendanceRecords.id, excuseStatus: attendanceRecords.excuseStatus })
      .from(attendanceRecords)
      .innerJoin(
        attendanceSheets,
        and(
          eq(attendanceSheets.id, attendanceRecords.sheetId),
          inArray(attendanceSheets.status, ['SUBMITTED', 'LOCKED']),
        ),
      )
      .innerJoin(sessions, eq(sessions.id, attendanceRecords.sessionId))
      .where(
        and(
          eq(attendanceRecords.studentId, studentId),
          inArray(attendanceRecords.status, ['ABSENT', 'LATE']),
          sql`(${sessions.startsAt} at time zone ${tz})::date between ${from}::date and ${to}::date`,
        ),
      );
    if (recs.length === 0) return 0;
    await tx
      .insert(justificationRecords)
      .values(recs.map((r) => ({ tenantId: this.tenantId, justificationId, recordId: r.id })))
      .onConflictDoNothing();
    const toPending = recs.filter((r) => r.excuseStatus !== 'EXCUSED').map((r) => r.id);
    if (toPending.length)
      await tx
        .update(attendanceRecords)
        .set({ excuseStatus: 'PENDING' })
        .where(inArray(attendanceRecords.id, toPending));
    return recs.length;
  }

  async list(query: z.infer<typeof JustificationsQuerySchema>) {
    const tx = this.db.current();
    const cur = decodeCursor<{ t: string; id: string }>(query.cursor);
    const rows = await tx
      .select({ j: absenceJustifications, s: students, submitter: users.displayName })
      .from(absenceJustifications)
      .innerJoin(students, eq(students.id, absenceJustifications.studentId))
      .leftJoin(users, eq(users.id, absenceJustifications.submittedBy))
      .where(
        and(
          query.status ? eq(absenceJustifications.status, query.status) : undefined,
          query.studentId ? eq(absenceJustifications.studentId, query.studentId) : undefined,
          query.groupId
            ? sql`exists (select 1 from enrollments e where e.student_id = ${students.id} and e.group_id = ${query.groupId}::uuid and e.left_at is null)`
            : undefined,
          cur
            ? sql`(${absenceJustifications.createdAt}, ${absenceJustifications.id}) > (${new Date(cur.t)}, ${cur.id}::uuid)`
            : undefined,
        ),
      )
      // File de traitement : les plus anciennes d'abord.
      .orderBy(asc(absenceJustifications.createdAt), asc(absenceJustifications.id))
      .limit(query.limit + 1);
    const counts = await this.recordCounts(
      tx,
      rows.map((r) => r.j.id),
    );
    return page(
      rows.map((r) => this.dto(r.j, r.s, r.submitter, counts.get(r.j.id) ?? 0)),
      query.limit,
      (last) => ({ t: last.createdAt, id: last.id }),
    );
  }

  /** Justificatifs d'un enfant vus par son tuteur. */
  async forChild(studentId: string) {
    const tx = this.db.current();
    await this.guardians.assertGuardianAccess(studentId, 'attendance', tx);
    const rows = await tx
      .select({ j: absenceJustifications, s: students, submitter: users.displayName })
      .from(absenceJustifications)
      .innerJoin(students, eq(students.id, absenceJustifications.studentId))
      .leftJoin(users, eq(users.id, absenceJustifications.submittedBy))
      .where(eq(absenceJustifications.studentId, studentId))
      .orderBy(desc(absenceJustifications.createdAt))
      .limit(50);
    const counts = await this.recordCounts(
      tx,
      rows.map((r) => r.j.id),
    );
    return rows.map((r) => this.dto(r.j, r.s, r.submitter, counts.get(r.j.id) ?? 0));
  }

  async get(id: string) {
    const tx = this.db.current();
    const r = (
      await tx
        .select({ j: absenceJustifications, s: students, submitter: users.displayName })
        .from(absenceJustifications)
        .innerJoin(students, eq(students.id, absenceJustifications.studentId))
        .leftJoin(users, eq(users.id, absenceJustifications.submittedBy))
        .where(eq(absenceJustifications.id, id))
        .limit(1)
    )[0];
    if (!r) throw AppError.notFound('Justificatif');
    const counts = await this.recordCounts(tx, [id]);
    const records = await tx
      .select({ r: attendanceRecords, s: sessions })
      .from(justificationRecords)
      .innerJoin(attendanceRecords, eq(attendanceRecords.id, justificationRecords.recordId))
      .innerJoin(sessions, eq(sessions.id, attendanceRecords.sessionId))
      .where(eq(justificationRecords.justificationId, id))
      .orderBy(asc(sessions.startsAt));
    return {
      ...this.dto(r.j, r.s, r.submitter, counts.get(id) ?? 0),
      records: records.map((x) => ({
        recordId: x.r.id,
        sessionId: x.s.id,
        startsAt: x.s.startsAt.toISOString(),
        status: x.r.status,
        excuseStatus: x.r.excuseStatus,
        lateMinutes: x.r.lateMinutes,
      })),
    };
  }

  async review(id: string, input: z.infer<typeof ReviewJustificationSchema>) {
    const tx = this.db.current();
    const j = await tx.query.absenceJustifications.findFirst({
      where: eq(absenceJustifications.id, id),
    });
    if (!j) throw AppError.notFound('Justificatif');
    if (j.status === 'APPROVED' || j.status === 'REJECTED')
      throw AppError.conflict('Justificatif déjà traité', 'CONFLICT', { status: j.status });
    const actor = RequestContextStore.require().actor;
    await tx
      .update(absenceJustifications)
      .set({
        status: input.decision,
        reviewedBy: actor?.userId ?? null,
        reviewedAt: new Date(),
        reviewComment: input.comment?.trim() || null,
      })
      .where(eq(absenceJustifications.id, id));
    const linked = await tx
      .select({ recordId: justificationRecords.recordId })
      .from(justificationRecords)
      .where(eq(justificationRecords.justificationId, id));
    const ids = linked.map((l) => l.recordId);
    if (ids.length && input.decision !== 'INFO_REQUESTED') {
      // Un refus ne rétrograde jamais un enregistrement déjà excusé par un autre justificatif.
      await tx
        .update(attendanceRecords)
        .set({ excuseStatus: input.decision === 'APPROVED' ? 'EXCUSED' : 'REJECTED' })
        .where(
          and(
            inArray(attendanceRecords.id, ids),
            inArray(attendanceRecords.status, ['ABSENT', 'LATE']),
            input.decision === 'REJECTED'
              ? ne(attendanceRecords.excuseStatus, 'EXCUSED')
              : undefined,
          ),
        );
    }
    await this.audit.record({
      action: `justification.${input.decision.toLowerCase()}`,
      entityType: 'AbsenceJustification',
      entityId: id,
      before: { status: j.status },
      after: { status: input.decision, comment: input.comment ?? null, records: ids.length },
    });
    await this.outbox.publish(
      justificationReviewed({
        tenantId: this.tenantId,
        justificationId: id,
        studentId: j.studentId,
        decision: input.decision,
        comment: input.comment ?? null,
        submittedBy: j.submittedBy,
        fromDate: j.fromDate,
        toDate: j.toDate,
      }),
    );
    if (input.decision !== 'INFO_REQUESTED') {
      const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
      await this.stats.afterChange(tx, [j.studentId], rulesFrom(tenant.settings));
    }
    return this.get(id);
  }

  async pendingCount(tx: Db) {
    const r = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(absenceJustifications)
      .where(inArray(absenceJustifications.status, ['PENDING', 'INFO_REQUESTED']));
    return r[0]?.n ?? 0;
  }

  private async recordCounts(tx: Db, ids: string[]) {
    const map = new Map<string, number>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: justificationRecords.justificationId, n: sql<number>`count(*)::int` })
      .from(justificationRecords)
      .where(inArray(justificationRecords.justificationId, ids))
      .groupBy(justificationRecords.justificationId);
    for (const r of rows) map.set(r.id, r.n);
    return map;
  }

  private dto(
    j: typeof absenceJustifications.$inferSelect,
    s: typeof students.$inferSelect,
    submitter: string | null,
    recordCount: number,
  ) {
    return {
      id: j.id,
      studentId: j.studentId,
      student: { firstName: s.firstName, lastName: s.lastName, matricule: s.matricule },
      fromDate: j.fromDate,
      toDate: j.toDate,
      reason: j.reason,
      documentName: j.documentKey,
      status: j.status,
      submittedByKind: j.submittedByKind,
      submittedByName: submitter,
      reviewComment: j.reviewComment,
      reviewedAt: j.reviewedAt?.toISOString() ?? null,
      recordCount,
      createdAt: j.createdAt.toISOString(),
    };
  }
}
