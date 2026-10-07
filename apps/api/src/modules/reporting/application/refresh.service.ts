import { Injectable, Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../database/database.service';
import type { Db } from '../../../database/request-context';
import { reportRefreshes, tenants } from '../../../database/schema';
import { addDays, localDateParts } from '../../academic';

/**
 * « Vues matérialisées » du reporting : PostgreSQL n'applique pas de RLS aux vues matérialisées, on
 * matérialise donc dans des tables tenant (`report_attendance_daily`, `report_finance_daily`) recalculées
 * par le worker (toutes les 5 min sur les derniers jours, complet à la demande). Idempotent : delete + insert
 * sur l'intervalle, dans une transaction tenant.
 */
@Injectable()
export class ReportRefreshService {
  private readonly logger = new Logger(ReportRefreshService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Rafraîchit [from, to] (défaut : les 3 derniers jours dans le fuseau du tenant). */
  async refresh(tenantId: string, range?: { from: string; to: string }) {
    return this.db.withTenantTx(tenantId, async (tx) => {
      const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
      const today = localDateParts(new Date(), tenant.timezone).date;
      const from = range?.from ?? addDays(today, -3);
      const to = range?.to ?? today;
      const id = randomUUID();
      await tx.insert(reportRefreshes).values({
        id,
        tenantId,
        fromDay: from,
        toDay: to,
        startedAt: new Date(),
        finishedAt: null,
        attendanceRows: 0,
        financeRows: 0,
        error: null,
      });
      try {
        const attendanceRows = await this.refreshAttendance(
          tx,
          tenantId,
          tenant.timezone,
          from,
          to,
        );
        const financeRows = await this.refreshFinance(tx, tenantId, from, to);
        await tx
          .update(reportRefreshes)
          .set({ finishedAt: new Date(), attendanceRows, financeRows })
          .where(eq(reportRefreshes.id, id));
        return { from, to, attendanceRows, financeRows };
      } catch (e) {
        await tx
          .update(reportRefreshes)
          .set({ finishedAt: new Date(), error: (e as Error).message })
          .where(eq(reportRefreshes.id, id));
        this.logger.error({ msg: 'report refresh failed', tenantId, err: (e as Error).message });
        throw e;
      }
    });
  }

  /** Rafraîchissement complet : de la première séance (ou 400 jours) à aujourd'hui, séances planifiées incluses. */
  async refreshAll(tenantId: string) {
    return this.db
      .withTenantTx(tenantId, async (tx) => {
        const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
        const today = localDateParts(new Date(), tenant.timezone).date;
        const bounds = await tx.execute<{ first: string | null; last: string | null }>(
          sql`select min((s.starts_at at time zone ${tenant.timezone})::date)::text as first,
                     max((s.starts_at at time zone ${tenant.timezone})::date)::text as last
              from sessions s`,
        );
        const b = bounds.rows[0];
        const last = b?.last ?? today;
        return { from: b?.first ?? addDays(today, -400), to: last > today ? last : today };
      })
      .then((r) => this.refresh(tenantId, r));
  }

  private async refreshAttendance(tx: Db, tenantId: string, tz: string, from: string, to: string) {
    await tx.execute(
      sql`delete from report_attendance_daily where tenant_id = ${tenantId}::uuid and day between ${from}::date and ${to}::date`,
    );
    const res = await tx.execute(sql`
      with s as (
        select s.id, (s.starts_at at time zone ${tz})::date as day, co.group_id, s.status, s.ends_at,
               sh.status as sheet_status
        from sessions s
        join course_offerings co on co.id = s.course_offering_id
        left join attendance_sheets sh on sh.session_id = s.id
        where (s.starts_at at time zone ${tz})::date between ${from}::date and ${to}::date
      ),
      sess as (
        select day, group_id,
               count(*) filter (where status <> 'CANCELLED')::int as sessions_planned,
               count(*) filter (where status = 'HELD')::int as sessions_held,
               count(*) filter (where sheet_status in ('SUBMITTED','LOCKED'))::int as sheets_submitted,
               count(*) filter (where status <> 'CANCELLED' and ends_at < now()
                                  and coalesce(sheet_status, '') not in ('SUBMITTED','LOCKED'))::int as sheets_missing
        from s group by day, group_id
      ),
      rec as (
        select s.day, s.group_id,
               count(*)::int as records,
               count(*) filter (where r.status = 'PRESENT')::int as present,
               count(*) filter (where r.status = 'ABSENT')::int as absent,
               count(*) filter (where r.status = 'LATE')::int as late,
               count(*) filter (where r.status = 'ABSENT' and r.excuse_status = 'EXCUSED')::int as excused,
               count(*) filter (where r.status = 'ABSENT' and r.excuse_status in ('NONE','REJECTED'))::int as unjustified
        from attendance_records r
        join s on s.id = r.session_id
        join attendance_sheets sh on sh.id = r.sheet_id and sh.status in ('SUBMITTED','LOCKED')
        group by s.day, s.group_id
      )
      insert into report_attendance_daily (tenant_id, day, group_id, sessions_planned, sessions_held, sheets_submitted,
        sheets_missing, records, present, absent, late, excused, unjustified, refreshed_at)
      select ${tenantId}::uuid, sess.day, sess.group_id, sess.sessions_planned, sess.sessions_held, sess.sheets_submitted,
             sess.sheets_missing, coalesce(rec.records, 0), coalesce(rec.present, 0), coalesce(rec.absent, 0),
             coalesce(rec.late, 0), coalesce(rec.excused, 0), coalesce(rec.unjustified, 0), now()
      from sess left join rec on rec.day = sess.day and rec.group_id = sess.group_id`);
    return res.rowCount ?? 0;
  }

  private async refreshFinance(tx: Db, tenantId: string, from: string, to: string) {
    await tx.execute(
      sql`delete from report_finance_daily where tenant_id = ${tenantId}::uuid and day between ${from}::date and ${to}::date`,
    );
    const res = await tx.execute(sql`
      insert into report_finance_daily (tenant_id, day, channel, payments, amount, reversed_count, reversed_amount, fees, refreshed_at)
      select ${tenantId}::uuid, p.value_date,
             case when p.source = 'MANUAL' then p.method else coalesce(a.provider, 'ONLINE') end as channel,
             count(*) filter (where p.status = 'COMPLETED')::int,
             coalesce(sum(p.amount) filter (where p.status = 'COMPLETED'), 0),
             count(*) filter (where p.status = 'REVERSED')::int,
             coalesce(sum(p.amount) filter (where p.status = 'REVERSED'), 0),
             coalesce(sum(a.fees) filter (where p.status = 'COMPLETED'), 0),
             now()
      from payments p
      left join payment_attempts a on a.id = p.attempt_id
      where p.value_date between ${from}::date and ${to}::date
      group by p.value_date, 3`);
    return res.rowCount ?? 0;
  }

  async lastRefresh(tx: Db) {
    const r = await tx
      .select()
      .from(reportRefreshes)
      .orderBy(desc(reportRefreshes.startedAt))
      .limit(1);
    return r[0] ?? null;
  }
}
