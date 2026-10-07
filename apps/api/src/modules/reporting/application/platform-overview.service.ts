import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type { PlatformOverview } from '@polaris/contracts';
import { DatabaseService } from '../../../database/database.service';
import { RedisService } from '../../shared';

const pct = (num: number, den: number) => (den > 0 ? Math.round((num * 100) / den) : null);
const n = (v: unknown) => Number(v ?? 0);

/** Files surveillées (nom BullMQ) et leurs DLQ. */
const QUEUES = ['domain-events', 'payments', 'schedules', 'reports', 'maintenance'];
const DLQS = ['domain-events-dlq', 'payments-dlq'];

/**
 * Vue Super Admin (portée plateforme, BYPASSRLS) : parc, volumétrie, paiements des 24 h, santé (base, Redis,
 * outbox, files, DLQ), erreurs, et une ligne par établissement. Lecture seule ; aucune donnée nominative.
 */
@Injectable()
export class PlatformOverviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  async overview(): Promise<PlatformOverview> {
    const tx = this.db.current();
    const [tenantsRow, totals, pay, byProvider, outbox, errors, perTenant, stale] =
      await Promise.all([
        tx.execute<{ total: number; active: number; trial: number; suspended: number }>(sql`
        select count(*)::int as total, count(*) filter (where status = 'ACTIVE')::int as active,
               count(*) filter (where status = 'TRIAL')::int as trial, count(*) filter (where status = 'SUSPENDED')::int as suspended
        from tenants`),
        tx.execute<{
          students: number;
          guardians: number;
          activated: number;
          paid_today: number;
          paid_month: number;
          records7: number;
          present7: number;
        }>(sql`
        select (select count(*) from students where status = 'ACTIVE')::int as students,
               (select count(*) from guardians where deleted_at is null)::int as guardians,
               (select count(*) from guardians where deleted_at is null and user_id is not null)::int as activated,
               (select coalesce(sum(amount), 0) from payments where status = 'COMPLETED' and value_date = current_date)::bigint as paid_today,
               (select coalesce(sum(amount), 0) from payments where status = 'COMPLETED' and value_date >= date_trunc('month', current_date)::date)::bigint as paid_month,
               (select coalesce(sum(records), 0) from report_attendance_daily where day >= current_date - 6)::int as records7,
               (select coalesce(sum(present + late), 0) from report_attendance_daily where day >= current_date - 6)::int as present7`),
        tx.execute<{
          attempts: number;
          succeeded: number;
          failed: number;
          pending: number;
          unknown: number;
          webhooks: number;
        }>(sql`
        select (select count(*) from payment_attempts where created_at >= now() - interval '24 hours')::int as attempts,
               (select count(*) from payment_attempts where created_at >= now() - interval '24 hours' and status = 'SUCCEEDED')::int as succeeded,
               (select count(*) from payment_attempts where created_at >= now() - interval '24 hours' and status in ('FAILED','CANCELLED','EXPIRED'))::int as failed,
               (select count(*) from payment_attempts where status in ('CREATED','PENDING','PROCESSING'))::int as pending,
               (select count(*) from payment_attempts where status = 'UNKNOWN')::int as unknown,
               (select count(*) from webhook_events where received_at >= now() - interval '24 hours')::int as webhooks`),
        tx.execute<{ provider: string; attempts: number; succeeded: number }>(sql`
        select provider, count(*)::int as attempts, count(*) filter (where status = 'SUCCEEDED')::int as succeeded
        from payment_attempts where created_at >= now() - interval '24 hours' group by provider order by provider`),
        tx.execute<{ backlog: number; oldest: number | null }>(sql`
        select count(*)::int as backlog, extract(epoch from (now() - min(occurred_at))) as oldest
        from outbox_events where published_at is null`),
        tx.execute<{
          unknown: number;
          notif_failed: number;
          imports_failed: number;
          review_open: number;
        }>(sql`
        select (select count(*) from payment_attempts where status = 'UNKNOWN' and updated_at >= now() - interval '24 hours')::int as unknown,
               (select count(*) from notifications where status = 'FAILED' and created_at >= now() - interval '24 hours')::int as notif_failed,
               (select count(*) from import_jobs where status = 'FAILED' and created_at >= now() - interval '24 hours')::int as imports_failed,
               (select count(*) from payment_attempts where review_status = 'OPEN')::int as review_open`),
        tx.execute<{
          id: string;
          code: string;
          name: string;
          status: string;
          students: number;
          guardians: number;
          activated: number;
          records7: number;
          present7: number;
          missing7: number;
          paid_month: number;
          provider: string | null;
          pending: number;
          review_open: number;
          sms_month: number;
          last_refresh: string | null;
        }>(sql`
        select t.id, t.code, t.name, t.status,
               (select count(*) from students s where s.tenant_id = t.id and s.status = 'ACTIVE')::int as students,
               (select count(*) from guardians g where g.tenant_id = t.id and g.deleted_at is null)::int as guardians,
               (select count(*) from guardians g where g.tenant_id = t.id and g.deleted_at is null and g.user_id is not null)::int as activated,
               (select coalesce(sum(records), 0) from report_attendance_daily d where d.tenant_id = t.id and d.day >= current_date - 6)::int as records7,
               (select coalesce(sum(present + late), 0) from report_attendance_daily d where d.tenant_id = t.id and d.day >= current_date - 6)::int as present7,
               (select coalesce(sum(sheets_missing), 0) from report_attendance_daily d where d.tenant_id = t.id and d.day >= current_date - 6)::int as missing7,
               (select coalesce(sum(amount), 0) from payments p where p.tenant_id = t.id and p.status = 'COMPLETED' and p.value_date >= date_trunc('month', current_date)::date)::bigint as paid_month,
               (select c.provider from tenant_payment_configs c where c.tenant_id = t.id and c.status = 'ACTIVE' limit 1) as provider,
               (select count(*) from payment_attempts a where a.tenant_id = t.id and a.status in ('CREATED','PENDING','PROCESSING'))::int as pending,
               (select count(*) from payment_attempts a where a.tenant_id = t.id and a.review_status = 'OPEN')::int as review_open,
               (select count(*) from notifications nt where nt.tenant_id = t.id and nt.channel = 'SMS' and nt.status in ('SENT','DELIVERED') and nt.created_at >= date_trunc('month', now()))::int as sms_month,
               (select max(finished_at) from report_refreshes r where r.tenant_id = t.id) as last_refresh
        from tenants t order by t.created_at`),
        tx.execute<{ c: number }>(sql`
        select count(*)::int as c from tenants t
        where t.status in ('ACTIVE','TRIAL')
          and coalesce((select max(finished_at) from report_refreshes r where r.tenant_id = t.id), 'epoch'::timestamptz) < now() - interval '20 minutes'`),
      ]);
    const [database, redisOk, queues, dlq] = await Promise.all([
      this.db.ping(),
      this.redis.ping(),
      this.queueStats(),
      this.dlqStats(),
    ]);
    const t = tenantsRow.rows[0]!;
    const tot = totals.rows[0]!;
    const p = pay.rows[0]!;
    const e = errors.rows[0]!;
    const o = outbox.rows[0]!;
    return {
      generatedAt: new Date().toISOString(),
      tenants: { total: t.total, active: t.active, trial: t.trial, suspended: t.suspended },
      totals: {
        studentsActive: tot.students,
        guardians: tot.guardians,
        guardiansActivated: tot.activated,
        paidToday: n(tot.paid_today),
        paidMonth: n(tot.paid_month),
        attendanceRate7d: pct(tot.present7, tot.records7),
      },
      payments24h: {
        attempts: p.attempts,
        succeeded: p.succeeded,
        failed: p.failed,
        pending: p.pending,
        unknown: p.unknown,
        webhooks: p.webhooks,
        byProvider: byProvider.rows,
      },
      health: {
        database,
        redis: redisOk,
        outboxBacklog: o.backlog,
        outboxOldestSeconds: o.oldest === null ? null : Math.round(Number(o.oldest)),
        queues,
        dlq,
        staleReports: stale.rows[0]?.c ?? 0,
      },
      errors24h: {
        attemptsUnknown: e.unknown,
        notificationsFailed: e.notif_failed,
        importsFailed: e.imports_failed,
        reviewOpen: e.review_open,
      },
      perTenant: perTenant.rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        status: r.status,
        studentsActive: r.students,
        guardiansActivationRate: pct(r.activated, r.guardians),
        attendanceRate7d: pct(r.present7, r.records7),
        missingSheets7d: r.missing7,
        paidMonth: n(r.paid_month),
        onlineProvider: r.provider,
        pendingAttempts: r.pending,
        reviewOpen: r.review_open,
        smsMonth: r.sms_month,
        lastRefreshAt: r.last_refresh ? new Date(r.last_refresh).toISOString() : null,
      })),
    };
  }

  private async queueStats() {
    const out: PlatformOverview['health']['queues'] = [];
    for (const name of QUEUES) {
      const q = new Queue(name, { connection: this.redis.duplicate() });
      try {
        const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
        const oldest = await q.getWaiting(0, 0);
        out.push({
          name,
          waiting: c['waiting'] ?? 0,
          active: c['active'] ?? 0,
          delayed: c['delayed'] ?? 0,
          failed: c['failed'] ?? 0,
          oldestWaitingSeconds: oldest[0]
            ? Math.round((Date.now() - oldest[0].timestamp) / 1000)
            : null,
        });
      } catch {
        out.push({
          name,
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
          oldestWaitingSeconds: null,
        });
      } finally {
        await q.close().catch(() => undefined);
      }
    }
    return out;
  }

  private async dlqStats() {
    const out: { name: string; count: number }[] = [];
    for (const name of DLQS) {
      const q = new Queue(name, { connection: this.redis.duplicate() });
      try {
        const c = await q.getJobCounts('waiting', 'delayed', 'failed', 'completed');
        out.push({
          name,
          count:
            (c['waiting'] ?? 0) + (c['delayed'] ?? 0) + (c['failed'] ?? 0) + (c['completed'] ?? 0),
        });
      } catch {
        out.push({ name, count: 0 });
      } finally {
        await q.close().catch(() => undefined);
      }
    }
    return out;
  }
}
