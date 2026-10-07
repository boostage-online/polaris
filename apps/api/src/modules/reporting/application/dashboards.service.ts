import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DirectionDashboard, FinanceChannels, PedagogyDashboard } from '@polaris/contracts';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import { tenants } from '../../../database/schema';
import { addDays, localDateParts } from '../../academic';
import { ReportRefreshService } from './refresh.service';
import { CHANNEL_LABELS, ReportsService } from './reports.service';

const pct = (num: number, den: number) => (den > 0 ? Math.round((num * 100) / den) : null);
const n = (v: unknown) => Number(v ?? 0);

/** Tableaux de bord de synthèse : direction (KPI + tendances), pédagogique (classes, élèves à risque), canaux financiers. */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly reports: ReportsService,
    private readonly refresh: ReportRefreshService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  private async today(tx: Db) {
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
    return { today: localDateParts(new Date(), tenant.timezone).date, tenant };
  }

  private async attendanceRate(tx: Db, from: string, to: string) {
    const r = await tx.execute<{
      records: number;
      present: number;
      late: number;
      missing: number;
      unjustified: number;
    }>(sql`
      select coalesce(sum(records), 0)::int as records, coalesce(sum(present), 0)::int as present, coalesce(sum(late), 0)::int as late,
             coalesce(sum(sheets_missing), 0)::int as missing, coalesce(sum(unjustified), 0)::int as unjustified
      from report_attendance_daily where day between ${from}::date and ${to}::date`);
    const x = r.rows[0]!;
    return {
      rate: pct(x.present + x.late, x.records),
      missing: x.missing,
      unjustified: x.unjustified,
    };
  }

  // ---------------------------------------------------------------- direction
  async direction(): Promise<DirectionDashboard> {
    const tx = this.db.current();
    const { today, tenant } = await this.today(tx);
    const from30 = addDays(today, -29);
    const from7 = addDays(today, -6);
    const prevFrom = addDays(from30, -30);
    const prevTo = addDays(from30, -1);
    const monthStart = `${today.slice(0, 7)}-01`;
    const prevMonthStart = `${addDays(monthStart, -1).slice(0, 7)}-01`;
    const [a7, a30, aPrev] = await Promise.all([
      this.attendanceRate(tx, from7, today),
      this.attendanceRate(tx, from30, today),
      this.attendanceRate(tx, prevFrom, prevTo),
    ]);
    const students = (
      await tx.execute<{ active: number; new30: number }>(sql`
        select count(*) filter (where status = 'ACTIVE')::int as active,
               count(*) filter (where status = 'ACTIVE' and created_at >= ${from30}::date)::int as new30
        from students`)
    ).rows[0]!;
    const atRisk = (await this.reports.studentsAtRisk(tx, { from: from30, to: today })).length;
    const fin = (
      await tx.execute<{ due: number; paid: number; overdue: number }>(sql`
        select coalesce(sum(greatest(0, amount_due + adjustments_total)), 0)::bigint as due,
               coalesce(sum(amount_allocated), 0)::bigint as paid,
               coalesce(sum(case when status = 'OVERDUE' then greatest(0, amount_due + adjustments_total - amount_allocated) else 0 end), 0)::bigint as overdue
        from installments i join student_fees f on f.id = i.student_fee_id
        join academic_years y on y.id = f.academic_year_id and y.is_current
        where i.status <> 'CANCELLED'`)
    ).rows[0]!;
    const months = (
      await tx.execute<{ cur: number; prev: number; online30: number; total30: number }>(sql`
        select coalesce(sum(amount) filter (where day >= ${monthStart}::date), 0)::bigint as cur,
               coalesce(sum(amount) filter (where day >= ${prevMonthStart}::date and day < ${monthStart}::date), 0)::bigint as prev,
               coalesce(sum(amount) filter (where day >= ${from30}::date and channel not in ('CASH','BANK_TRANSFER','CHEQUE','MOBILE_MONEY_OFFLINE')), 0)::bigint as online30,
               coalesce(sum(amount) filter (where day >= ${from30}::date), 0)::bigint as total30
        from report_finance_daily`)
    ).rows[0]!;
    const pendingReviews = n(
      (
        await tx.execute<{ c: number }>(
          sql`select count(*)::int as c from payment_attempts where review_status = 'OPEN'`,
        )
      ).rows[0]?.c,
    );
    const parents = (
      await tx.execute<{ total: number; activated: number }>(sql`
        select count(*)::int as total, count(*) filter (where user_id is not null)::int as activated
        from guardians where deleted_at is null`)
    ).rows[0]!;
    const smsCap = n(
      (tenant.settings as { notifications?: { smsMonthlyCap?: number } }).notifications
        ?.smsMonthlyCap ?? 2000,
    );
    const notif = (
      await tx.execute<{ sms: number; unread: number }>(sql`
        select count(*) filter (where channel = 'SMS' and status in ('SENT','DELIVERED') and created_at >= ${monthStart}::date)::int as sms,
               count(*) filter (where channel = 'INAPP' and read_at is null)::int as unread
        from notifications`)
    ).rows[0]!;
    // Tendances hebdomadaires (8 semaines) : taux de présence et encaissements.
    const weeksFrom = addDays(today, -55);
    const aw = await tx.execute<{ wk: string; records: number; present: number; late: number }>(sql`
      select to_char(date_trunc('week', day), 'IYYY-"S"IW') as wk, sum(records)::int as records, sum(present)::int as present, sum(late)::int as late
      from report_attendance_daily where day between ${weeksFrom}::date and ${today}::date group by 1 order by 1`);
    const fw = await tx.execute<{ wk: string; amount: number }>(sql`
      select to_char(date_trunc('week', day), 'IYYY-"S"IW') as wk, sum(amount)::bigint as amount
      from report_finance_daily where day between ${weeksFrom}::date and ${today}::date group by 1 order by 1`);
    const groups = (await this.reports.attendanceByGroup(tx, { from: from30, to: today }))
      .filter((g) => n(g['records']) > 0)
      .sort((a, b) => n(a['presenceRate']) - n(b['presenceRate']))
      .slice(0, 5);
    const last = await this.refresh.lastRefresh(tx);
    return {
      period: { from: from30, to: today },
      students: { active: students.active, newLast30d: students.new30 },
      attendance: {
        rate7d: a7.rate,
        rate30d: a30.rate,
        ratePrev30d: aPrev.rate,
        missingSheets7d: a7.missing,
        atRisk,
        unjustified30d: a30.unjustified,
      },
      finance: {
        invoiced: n(fin.due),
        paid: n(fin.paid),
        outstanding: n(fin.due) - n(fin.paid),
        overdue: n(fin.overdue),
        recoveryRate: pct(n(fin.paid), n(fin.due)),
        paidThisMonth: n(months.cur),
        paidPrevMonth: n(months.prev),
        onlineShare30d: pct(n(months.online30), n(months.total30)),
        pendingReviews,
      },
      parents: {
        total: parents.total,
        activated: parents.activated,
        activationRate: pct(parents.activated, parents.total),
      },
      notifications: { smsThisMonth: notif.sms, smsCap, inAppUnread: notif.unread },
      trends: {
        attendanceWeekly: aw.rows.map((w) => ({
          label: w.wk,
          value: pct(w.present + w.late, w.records),
        })),
        collectionsWeekly: fw.rows.map((w) => ({ label: w.wk, value: n(w.amount) })),
      },
      groupsAtRisk: groups.map((g) => ({
        groupId: String(g['groupId']),
        groupName: String(g['groupName']),
        rate30d: g['presenceRate'] as number | null,
        unjustified30d: n(g['unjustified']),
      })),
      refreshedAt: last?.finishedAt?.toISOString() ?? null,
    };
  }

  // ---------------------------------------------------------------- pédagogique
  async pedagogy(q: { from?: string; to?: string }): Promise<PedagogyDashboard> {
    const tx = this.db.current();
    const { today } = await this.today(tx);
    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -29);
    const byGroup = await this.reports.attendanceByGroup(tx, { from, to });
    const atRisk = await this.reports.studentsAtRisk(tx, { from, to });
    const teachers = await tx.execute<{
      staff_profile_id: string | null;
      teacher: string;
      missing: number;
      sessions: number;
    }>(sql`
      with s as (
        select s.id, s.course_offering_id, s.status, s.ends_at, sh.status as sheet_status
        from sessions s left join attendance_sheets sh on sh.session_id = s.id
        where s.status <> 'CANCELLED' and s.ends_at < now() and s.starts_at >= ${from}::date and s.starts_at < (${to}::date + 1)
      )
      select ct.staff_profile_id, coalesce(u.display_name, 'Sans enseignant') as teacher,
             count(*) filter (where coalesce(s.sheet_status, '') not in ('SUBMITTED','LOCKED'))::int as missing,
             count(*)::int as sessions
      from s
      left join course_teachers ct on ct.course_offering_id = s.course_offering_id and ct.role = 'MAIN'
      left join staff_profiles sp on sp.id = ct.staff_profile_id
      left join memberships m on m.id = sp.membership_id
      left join users u on u.id = m.user_id
      group by ct.staff_profile_id, u.display_name
      having count(*) filter (where coalesce(s.sheet_status, '') not in ('SUBMITTED','LOCKED')) > 0
      order by missing desc limit 20`);
    const late = await tx.execute<{ bucket: string; count: number }>(sql`
      select case when late_minutes <= 5 then '≤ 5 min' when late_minutes <= 15 then '6–15 min' when late_minutes <= 30 then '16–30 min' else '> 30 min' end as bucket,
             count(*)::int as count
      from attendance_records r join sessions s on s.id = r.session_id
      where r.status = 'LATE' and s.starts_at >= ${from}::date and s.starts_at < (${to}::date + 1)
      group by 1 order by min(late_minutes)`);
    const last = await this.refresh.lastRefresh(tx);
    return {
      period: { from, to },
      byGroup: byGroup.map((g) => ({
        groupId: String(g['groupId']),
        groupName: String(g['groupName']),
        levelName: (g['levelName'] as string | null) ?? null,
        sessionsHeld: n(g['sessionsHeld']),
        records: n(g['records']),
        presenceRate: g['presenceRate'] as number | null,
        absent: n(g['absent']),
        late: n(g['late']),
        unjustified: n(g['unjustified']),
        sheetsMissing: n(g['sheetsMissing']),
      })),
      studentsAtRisk: atRisk.slice(0, 50).map((s) => ({
        studentId: String(s['studentId']),
        firstName: String(s['firstName']),
        lastName: String(s['lastName']),
        matricule: String(s['matricule']),
        groupName: (s['groupName'] as string | null) ?? null,
        sessions: n(s['sessions']),
        absent: n(s['absent']),
        unjustified: n(s['unjustified']),
        late: n(s['late']),
        presenceRate: s['presenceRate'] as number | null,
        openAlert: Boolean(s['openAlert']),
      })),
      missingSheetsByTeacher: teachers.rows.map((t) => ({
        staffProfileId: t.staff_profile_id,
        teacherName: t.teacher,
        missing: t.missing,
        sessions: t.sessions,
      })),
      lateDistribution: late.rows.map((l) => ({ bucket: l.bucket, count: l.count })),
      refreshedAt: last?.finishedAt?.toISOString() ?? null,
    };
  }

  // ---------------------------------------------------------------- canaux financiers
  async financeChannels(q: { from?: string; to?: string }): Promise<FinanceChannels> {
    const tx = this.db.current();
    const { today } = await this.today(tx);
    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -29);
    const channels = await this.reports.collectionsByChannel(tx, { from, to });
    const online = (
      await tx.execute<{
        attempts: number;
        succeeded: number;
        failed: number;
        pending: number;
        unknown: number;
        median: number | null;
      }>(sql`
        select count(*)::int as attempts,
               count(*) filter (where status = 'SUCCEEDED')::int as succeeded,
               count(*) filter (where status in ('FAILED','CANCELLED','EXPIRED'))::int as failed,
               count(*) filter (where status in ('CREATED','PENDING','PROCESSING'))::int as pending,
               count(*) filter (where status = 'UNKNOWN')::int as unknown,
               percentile_cont(0.5) within group (order by extract(epoch from (completed_at - created_at))) filter (where status = 'SUCCEEDED') as median
        from payment_attempts where created_at >= ${from}::date and created_at < (${to}::date + 1)`)
    ).rows[0]!;
    const daily = await tx.execute<{ day: string; manual: number; online: number }>(sql`
      select day::text as day,
             coalesce(sum(amount) filter (where channel in ('CASH','BANK_TRANSFER','CHEQUE','MOBILE_MONEY_OFFLINE')), 0)::bigint as manual,
             coalesce(sum(amount) filter (where channel not in ('CASH','BANK_TRANSFER','CHEQUE','MOBILE_MONEY_OFFLINE')), 0)::bigint as online
      from report_finance_daily where day between ${from}::date and ${to}::date group by day order by day`);
    return {
      period: { from, to },
      channels: channels.map((c) => ({
        channel: String(c['channelCode']),
        label: CHANNEL_LABELS[String(c['channelCode'])] ?? String(c['channelCode']),
        kind: c['kind'] === 'Caisse' ? 'MANUAL' : 'ELECTRONIC',
        payments: n(c['payments']),
        amount: n(c['amount']),
        reversedAmount: n(c['reversedAmount']),
        fees: n(c['fees']),
        share: c['share'] as number | null,
      })),
      online: {
        attempts: online.attempts,
        succeeded: online.succeeded,
        failed: online.failed,
        pending: online.pending,
        unknown: online.unknown,
        successRate: pct(online.succeeded, online.succeeded + online.failed),
        medianConfirmSeconds: online.median === null ? null : Math.round(Number(online.median)),
      },
      daily: daily.rows.map((d) => ({ day: d.day, manual: n(d.manual), online: n(d.online) })),
    };
  }
}
