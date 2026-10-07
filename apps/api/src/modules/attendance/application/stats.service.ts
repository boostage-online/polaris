import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { HistoryQuerySchema } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor, page } from '../../../common/http/cursor';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  academicYears,
  attendanceAlerts,
  attendanceDailyStats,
  attendanceRecords,
  attendanceSheets,
  courseOfferings,
  enrollments,
  groups,
  sessions,
  students,
  subjects,
  tenants,
} from '../../../database/schema';
import { AuditService } from '../../audit';
import { OutboxService } from '../../shared';
import { repeatedAbsencesDetected } from '../domain/events';
import { presenceRate, type AttendanceRules } from '../domain/policies';

type Row = Record<string, string | number | null>;
const n = (r: Row | undefined, k: string) => Number(r?.[k] ?? 0);

/**
 * Statistiques quotidiennes par élève (recalculées pour les élèves touchés, dans la transaction du cas d'usage :
 * déterministes et testables ; un recalcul complet par le worker donne le même résultat), alertes de seuil,
 * historique et résumés.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  private async tz(tx: Db) {
    const t = await tx.query.tenants.findFirst({
      where: eq(tenants.id, this.tenantId),
      columns: { timezone: true },
    });
    return t?.timezone ?? 'UTC';
  }

  /** Après soumission ou correction : stats des élèves concernés puis évaluation des seuils. */
  async afterChange(tx: Db, studentIds: string[], rules: AttendanceRules) {
    const ids = [...new Set(studentIds)];
    if (ids.length === 0) return;
    await this.recompute(tx, ids);
    await this.evaluateAlerts(tx, ids, rules);
  }

  /** Recalcule intégralement les lignes quotidiennes des élèves donnés (feuilles SUBMITTED/LOCKED uniquement). */
  async recompute(tx: Db, studentIds: string[]) {
    if (studentIds.length === 0) return;
    const tz = await this.tz(tx);
    await tx
      .delete(attendanceDailyStats)
      .where(inArray(attendanceDailyStats.studentId, studentIds));
    await tx.execute(sql`
      insert into attendance_daily_stats (tenant_id, student_id, day, sessions, present, absent, late, excused, unjustified, updated_at)
      select r.tenant_id, r.student_id, (s.starts_at at time zone ${tz})::date as day,
             count(*)::int,
             count(*) filter (where r.status = 'PRESENT')::int,
             count(*) filter (where r.status = 'ABSENT')::int,
             count(*) filter (where r.status = 'LATE')::int,
             count(*) filter (where r.status <> 'PRESENT' and r.excuse_status = 'EXCUSED')::int,
             count(*) filter (where r.status = 'ABSENT' and r.excuse_status <> 'EXCUSED')::int,
             now()
      from attendance_records r
      join attendance_sheets sh on sh.id = r.sheet_id and sh.status in ('SUBMITTED','LOCKED')
      join sessions s on s.id = r.session_id
      where r.student_id in ${studentIds}
      group by r.tenant_id, r.student_id, (s.starts_at at time zone ${tz})::date`);
  }

  /** Seuil « N absences non justifiées sur W jours » : une alerte ouverte par élève, mise à jour, résolue si retombe. */
  async evaluateAlerts(tx: Db, studentIds: string[], rules: AttendanceRules) {
    const today = new Date().toISOString().slice(0, 10);
    const windowFrom = new Date(Date.now() - (rules.repeatedAbsenceWindowDays - 1) * 24 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const rows = await tx
      .select({
        studentId: attendanceDailyStats.studentId,
        unjustified: sql<number>`coalesce(sum(${attendanceDailyStats.unjustified}), 0)::int`,
      })
      .from(attendanceDailyStats)
      .where(
        and(
          inArray(attendanceDailyStats.studentId, studentIds),
          gte(attendanceDailyStats.day, windowFrom),
        ),
      )
      .groupBy(attendanceDailyStats.studentId);
    const counts = new Map(rows.map((r) => [r.studentId, r.unjustified]));
    const open = await tx.query.attendanceAlerts.findMany({
      where: and(
        inArray(attendanceAlerts.studentId, studentIds),
        isNull(attendanceAlerts.resolvedAt),
      ),
    });
    const openBy = new Map(open.map((a) => [a.studentId, a]));
    for (const studentId of studentIds) {
      const count = counts.get(studentId) ?? 0;
      const existing = openBy.get(studentId);
      if (count >= rules.repeatedAbsenceThreshold) {
        if (existing) {
          if (existing.count !== count)
            await tx
              .update(attendanceAlerts)
              .set({ count, windowFrom, windowTo: today })
              .where(eq(attendanceAlerts.id, existing.id));
        } else {
          const id = randomUUID();
          await tx.insert(attendanceAlerts).values({
            id,
            tenantId: this.tenantId,
            studentId,
            kind: 'REPEATED_ABSENCES',
            windowFrom,
            windowTo: today,
            count,
            createdAt: new Date(),
            resolvedAt: null,
            resolvedBy: null,
          });
          await this.outbox.publish(
            repeatedAbsencesDetected({
              tenantId: this.tenantId,
              alertId: id,
              studentId,
              count,
              windowFrom,
              windowTo: today,
            }),
          );
        }
      } else if (existing) {
        await tx
          .update(attendanceAlerts)
          .set({ resolvedAt: new Date(), resolvedBy: null })
          .where(eq(attendanceAlerts.id, existing.id));
      }
    }
  }

  // ---------------------------------------------------------------- lectures
  async summary(tx: Db, studentId: string, from: string, to: string) {
    const r = (
      await tx.execute<Row>(sql`
        select coalesce(sum(sessions),0) as sessions, coalesce(sum(present),0) as present, coalesce(sum(absent),0) as absent,
               coalesce(sum(late),0) as late, coalesce(sum(excused),0) as excused, coalesce(sum(unjustified),0) as unjustified
        from attendance_daily_stats where student_id = ${studentId}::uuid and day between ${from}::date and ${to}::date`)
    ).rows[0];
    const sessionsN = n(r, 'sessions');
    return {
      sessions: sessionsN,
      present: n(r, 'present'),
      absent: n(r, 'absent'),
      late: n(r, 'late'),
      excused: n(r, 'excused'),
      unjustified: n(r, 'unjustified'),
      presenceRate: presenceRate(n(r, 'present'), sessionsN),
    };
  }

  async history(tx: Db, studentId: string, query: z.infer<typeof HistoryQuerySchema>) {
    const tz = await this.tz(tx);
    const cur = decodeCursor<{ t: string; id: string }>(query.cursor);
    const rows = await tx
      .select({
        r: attendanceRecords,
        s: sessions,
        subjectName: subjects.name,
        groupName: groups.name,
      })
      .from(attendanceRecords)
      .innerJoin(
        attendanceSheets,
        and(
          eq(attendanceSheets.id, attendanceRecords.sheetId),
          inArray(attendanceSheets.status, ['SUBMITTED', 'LOCKED']),
        ),
      )
      .innerJoin(sessions, eq(sessions.id, attendanceRecords.sessionId))
      .innerJoin(courseOfferings, eq(courseOfferings.id, sessions.courseOfferingId))
      .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
      .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
      .where(
        and(
          eq(attendanceRecords.studentId, studentId),
          query.from
            ? gte(sql`(${sessions.startsAt} at time zone ${tz})::date`, query.from)
            : undefined,
          query.to
            ? lte(sql`(${sessions.startsAt} at time zone ${tz})::date`, query.to)
            : undefined,
          query.status ? eq(attendanceRecords.status, query.status) : undefined,
          cur
            ? sql`(${sessions.startsAt}, ${attendanceRecords.id}) < (${new Date(cur.t)}, ${cur.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(sessions.startsAt), desc(attendanceRecords.id))
      .limit(query.limit + 1);
    return page(
      rows.map((x) => this.historyItem(x.r, x.s, x.subjectName, x.groupName)),
      query.limit,
      (last) => ({ t: last.startsAt, id: last.recordId }),
    );
  }

  historyItem(
    r: typeof attendanceRecords.$inferSelect,
    s: typeof sessions.$inferSelect,
    subjectName: string,
    groupName: string,
  ) {
    return {
      recordId: r.id,
      sessionId: s.id,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      subjectName,
      groupName,
      status: r.status,
      excuseStatus: r.excuseStatus,
      lateMinutes: r.lateMinutes,
      note: r.note,
    };
  }

  /** Variantes « requête courante » avec vérification d'existence de l'élève. */
  async historyOf(studentId: string, query: z.infer<typeof HistoryQuerySchema>) {
    const tx = this.db.current();
    await this.assertStudent(tx, studentId);
    return this.history(tx, studentId, query);
  }
  async summaryOf(studentId: string, from: string, to: string) {
    const tx = this.db.current();
    await this.assertStudent(tx, studentId);
    return this.summary(tx, studentId, from, to);
  }
  private async assertStudent(tx: Db, studentId: string) {
    const s = await tx.query.students.findFirst({
      where: and(eq(students.id, studentId), isNull(students.deletedAt)),
      columns: { id: true },
    });
    if (!s) throw AppError.notFound('Élève');
  }

  async watchlist() {
    const tx = this.db.current();
    const year = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    const rows = await tx
      .select({
        a: attendanceAlerts,
        s: students,
        groupName: sql<
          string | null
        >`(select g.name from enrollments e join groups g on g.id = e.group_id where e.student_id = ${students.id} and e.is_primary and e.left_at is null ${year ? sql`and e.academic_year_id = ${year.id}::uuid` : sql``} limit 1)`,
      })
      .from(attendanceAlerts)
      .innerJoin(students, eq(students.id, attendanceAlerts.studentId))
      .where(isNull(attendanceAlerts.resolvedAt))
      .orderBy(desc(attendanceAlerts.count), desc(attendanceAlerts.createdAt));
    return rows.map(({ a, s, groupName }) => ({
      alertId: a.id,
      student: {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        matricule: s.matricule,
        groupName,
      },
      kind: a.kind,
      count: a.count,
      windowFrom: a.windowFrom,
      windowTo: a.windowTo,
      createdAt: a.createdAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
    }));
  }

  async resolveAlert(alertId: string) {
    const tx = this.db.current();
    const a = await tx.query.attendanceAlerts.findFirst({
      where: and(eq(attendanceAlerts.id, alertId), isNull(attendanceAlerts.resolvedAt)),
    });
    if (!a) throw AppError.notFound('Alerte');
    await tx
      .update(attendanceAlerts)
      .set({
        resolvedAt: new Date(),
        resolvedBy: RequestContextStore.require().actor?.userId ?? null,
      })
      .where(eq(attendanceAlerts.id, alertId));
    await this.audit.record({
      action: 'attendance_alert.resolved',
      entityType: 'AttendanceAlert',
      entityId: alertId,
      after: { studentId: a.studentId },
    });
    return { resolved: true };
  }

  /** Groupe principal courant d'élèves (pour les vues). */
  async currentGroups(tx: Db, studentIds: string[]) {
    const map = new Map<string, string>();
    if (studentIds.length === 0) return map;
    const year = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    if (!year) return map;
    const rows = await tx
      .select({ studentId: enrollments.studentId, name: groups.name })
      .from(enrollments)
      .innerJoin(groups, eq(groups.id, enrollments.groupId))
      .where(
        and(
          inArray(enrollments.studentId, studentIds),
          eq(enrollments.academicYearId, year.id),
          eq(enrollments.isPrimary, true),
          isNull(enrollments.leftAt),
        ),
      );
    for (const r of rows) map.set(r.studentId, r.name);
    return map;
  }
}
