import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { HistoryQuerySchema } from '@polaris/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { Db } from '../../../database/request-context';
import {
  absenceJustifications,
  attendanceAlerts,
  attendanceRecords,
  attendanceSheets,
  courseOfferings,
  groups,
  sessions,
  subjects,
} from '../../../database/schema';
import { localDateParts, zonedDateTimeToUtc } from '../../academic';
import { GuardianService } from '../../students-guardians';
import { JustificationService } from './justification.service';
import { SheetService } from './sheet.service';
import { StatsService } from './stats.service';

type Row = Record<string, string | number | null>;
const n = (r: Row | undefined, k: string) => Number(r?.[k] ?? 0);

/** Tableaux de bord enseignant, vie scolaire et parent. */
@Injectable()
export class AttendanceDashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sheets: SheetService,
    private readonly stats: StatsService,
    private readonly justifications: JustificationService,
    private readonly guardians: GuardianService,
  ) {}

  private async dayBounds(tx: Db) {
    const tenant = await this.sheets.tenant(tx);
    const today = localDateParts(new Date(), tenant.timezone).date;
    const from = zonedDateTimeToUtc(today, '00:00', tenant.timezone);
    return { today, from, to: new Date(from.getTime() + 24 * 3_600_000) };
  }

  async teacher() {
    const today = await this.sheets.today();
    const submitted = today.filter((s) => s.sheet && s.sheet.status !== 'DRAFT');
    const pending = today.filter((s) => !s.sheet || s.sheet.status === 'DRAFT');
    return {
      today,
      pendingSheets: pending.length,
      submittedToday: submitted.length,
      absencesToday: submitted.reduce((acc, s) => acc + (s.sheet?.counts.absent ?? 0), 0),
      lateToday: submitted.reduce((acc, s) => acc + (s.sheet?.counts.late ?? 0), 0),
    };
  }

  async studentLife() {
    const tx = this.db.current();
    const { from, to } = await this.dayBounds(tx);
    const todayRow = (
      await tx.execute<Row>(sql`
        select
          (select count(*) from sessions s where s.starts_at >= ${from} and s.starts_at < ${to} and s.status <> 'CANCELLED') as sessions,
          (select count(*) from attendance_sheets sh join sessions s on s.id = sh.session_id
             where s.starts_at >= ${from} and s.starts_at < ${to} and sh.status in ('SUBMITTED','LOCKED')) as sheets,
          (select count(*) from attendance_records r join sessions s on s.id = r.session_id join attendance_sheets sh on sh.id = r.sheet_id
             where s.starts_at >= ${from} and s.starts_at < ${to} and sh.status in ('SUBMITTED','LOCKED') and r.status = 'ABSENT') as absent,
          (select count(*) from attendance_records r join sessions s on s.id = r.session_id join attendance_sheets sh on sh.id = r.sheet_id
             where s.starts_at >= ${from} and s.starts_at < ${to} and sh.status in ('SUBMITTED','LOCKED') and r.status = 'LATE') as late,
          (select count(*) from attendance_records r join sessions s on s.id = r.session_id join attendance_sheets sh on sh.id = r.sheet_id
             where s.starts_at >= ${from} and s.starts_at < ${to} and sh.status in ('SUBMITTED','LOCKED') and r.status = 'ABSENT' and r.excuse_status in ('NONE','REJECTED')) as unjustified`)
    ).rows[0];
    const watch = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(attendanceAlerts)
      .where(isNull(attendanceAlerts.resolvedAt));
    const missing = await this.sheets.missing({});
    return {
      today: {
        sessions: n(todayRow, 'sessions'),
        sheetsSubmitted: n(todayRow, 'sheets'),
        absent: n(todayRow, 'absent'),
        late: n(todayRow, 'late'),
        unjustified: n(todayRow, 'unjustified'),
      },
      justificationsPending: await this.justifications.pendingCount(tx),
      watchlist: watch[0]?.n ?? 0,
      missingSheets: missing.length,
    };
  }

  /** Vue parent : un appel pour tous les enfants autorisés (`can_view_attendance`). */
  async childrenSummary() {
    const tx = this.db.current();
    const kids = (await this.guardians.myChildren()).filter((k) => k.rights.attendance);
    const { today, from, to } = await this.dayBounds(tx);
    const since = new Date(from.getTime() - 29 * 24 * 3_600_000).toISOString().slice(0, 10);
    const out = [];
    for (const k of kids) {
      const sid = k.student.id;
      const todayItems = await this.items(
        tx,
        sid,
        (q) => and(q, gte(sessions.startsAt, from), lt(sessions.startsAt, to)),
        20,
      );
      const recent = await this.items(
        tx,
        sid,
        (q) => and(q, ne(attendanceRecords.status, 'PRESENT')),
        10,
      );
      const alerts = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(attendanceAlerts)
        .where(and(eq(attendanceAlerts.studentId, sid), isNull(attendanceAlerts.resolvedAt)));
      const pend = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(absenceJustifications)
        .where(
          and(
            eq(absenceJustifications.studentId, sid),
            inArray(absenceJustifications.status, ['PENDING', 'INFO_REQUESTED']),
          ),
        );
      out.push({
        student: {
          id: sid,
          firstName: k.student.firstName,
          lastName: k.student.lastName,
          matricule: k.student.matricule,
          groupName: k.currentGroup?.name ?? null,
        },
        canJustify: k.rights.justify,
        today: todayItems,
        last30Days: await this.stats.summary(tx, sid, since, today),
        recent,
        alerts: alerts[0]?.n ?? 0,
        pendingJustifications: pend[0]?.n ?? 0,
      });
    }
    return out;
  }

  /** Historique d'un enfant pour son tuteur (droit assiduité vérifié, 404 sinon). */
  async childHistory(studentId: string, query: z.infer<typeof HistoryQuerySchema>) {
    const tx = this.db.current();
    await this.guardians.assertGuardianAccess(studentId, 'attendance', tx);
    return this.stats.history(tx, studentId, query);
  }

  private async items(
    tx: Db,
    studentId: string,
    where: (base: ReturnType<typeof and>) => ReturnType<typeof and>,
    limit: number,
  ) {
    const base = and(
      eq(attendanceRecords.studentId, studentId),
      inArray(attendanceSheets.status, ['SUBMITTED', 'LOCKED']),
    );
    const rows = await tx
      .select({
        r: attendanceRecords,
        s: sessions,
        subjectName: subjects.name,
        groupName: groups.name,
      })
      .from(attendanceRecords)
      .innerJoin(attendanceSheets, eq(attendanceSheets.id, attendanceRecords.sheetId))
      .innerJoin(sessions, eq(sessions.id, attendanceRecords.sessionId))
      .innerJoin(courseOfferings, eq(courseOfferings.id, sessions.courseOfferingId))
      .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
      .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
      .where(where(base))
      .orderBy(desc(sessions.startsAt))
      .limit(limit);
    return rows.map((x) => this.stats.historyItem(x.r, x.s, x.subjectName, x.groupName));
  }
}
