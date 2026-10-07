import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { PlatformAlert } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import { platformAlerts, tenants, users } from '../../../database/schema';
import { EMAIL_GATEWAY, RedisService, type EmailGateway } from '../../shared';
import { PlatformOverviewService } from './platform-overview.service';

type Severity = 'WARNING' | 'CRITICAL';
interface Condition {
  key: string;
  severity: Severity;
  title: string;
  detail: Record<string, unknown>;
  tenantId?: string | null;
}

/** Seuils (Partie 14 / runbooks) : au-delà, une alerte s'ouvre ; en deçà, elle se résout toute seule. */
export const ALERT_THRESHOLDS = {
  outboxLagWarningSeconds: 300,
  outboxLagCriticalSeconds: 900,
  queueWaitingWarningSeconds: 600,
  staleReportsMinutes: 20,
  notificationsFailedPerHour: 20,
  reviewOpenMaxAgeMinutes: 60,
  smsCapWarningRatio: 0.9,
  renotifyAfterHours: 6,
};

/**
 * Supervision applicative sans dépendance externe : le worker évalue toutes les 5 minutes un jeu de conditions
 * (DLQ, retard de l'outbox, files, agrégats périmés, transactions à vérifier, notifications en échec, quotas SMS,
 * intégrité du grand-livre, disjoncteurs), tient une table d'alertes ouvertes/résolues et prévient les
 * administrateurs plateforme par e-mail (à l'ouverture, puis toutes les 6 h tant que l'alerte reste ouverte).
 * Une alerte est une ligne, pas un e-mail : la vue plateforme l'affiche, on peut l'acquitter, elle se résout
 * automatiquement quand la condition disparaît.
 */
@Injectable()
export class PlatformAlertsService {
  private readonly logger = new Logger(PlatformAlertsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly overview: PlatformOverviewService,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Évaluation complète (worker, ou `POST /platform/alerts/evaluate`). */
  async evaluate(now = new Date()) {
    const conditions = await this.db.withPlatformTx('platform alerts evaluation', (tx) =>
      this.collect(tx, now),
    );
    const result = await this.db.withPlatformTx('platform alerts upsert', async (tx) => {
      const open = await tx.select().from(platformAlerts).where(isNull(platformAlerts.resolvedAt));
      const byKey = new Map(open.map((a) => [a.key, a]));
      let opened = 0;
      const toNotify: typeof open = [];
      for (const c of conditions) {
        const existing = byKey.get(c.key);
        if (existing) {
          await tx
            .update(platformAlerts)
            .set({ lastSeenAt: now, severity: c.severity, title: c.title, detail: c.detail })
            .where(eq(platformAlerts.id, existing.id));
          byKey.delete(c.key);
          const stale =
            !existing.notifiedAt ||
            now.getTime() - existing.notifiedAt.getTime() >
              ALERT_THRESHOLDS.renotifyAfterHours * 3600_000;
          if (stale && !existing.acknowledgedAt)
            toNotify.push({ ...existing, severity: c.severity, title: c.title, detail: c.detail });
        } else {
          const id = randomUUID();
          const row = {
            id,
            key: c.key,
            severity: c.severity,
            title: c.title,
            detail: c.detail,
            tenantId: c.tenantId ?? null,
            openedAt: now,
            lastSeenAt: now,
            resolvedAt: null,
            notifiedAt: null,
            acknowledgedAt: null,
            acknowledgedBy: null,
          };
          await tx.insert(platformAlerts).values(row);
          opened++;
          toNotify.push(row);
        }
      }
      const resolvedIds = [...byKey.values()].map((a) => a.id);
      if (resolvedIds.length)
        await tx
          .update(platformAlerts)
          .set({ resolvedAt: now })
          .where(inArray(platformAlerts.id, resolvedIds));
      const notified = await this.notify(tx, toNotify, now);
      return {
        evaluatedAt: now.toISOString(),
        opened,
        stillOpen: conditions.length,
        resolved: resolvedIds.length,
        notified,
      };
    });
    if (result.opened || result.resolved)
      this.logger.log({ msg: 'platform alerts evaluated', ...result });
    return result;
  }

  async list(status: 'open' | 'resolved' | 'all'): Promise<PlatformAlert[]> {
    const tx = this.db.current();
    const where =
      status === 'open'
        ? isNull(platformAlerts.resolvedAt)
        : status === 'resolved'
          ? sql`${platformAlerts.resolvedAt} is not null`
          : undefined;
    const rows = await tx
      .select({ a: platformAlerts, tenantName: tenants.name, ackName: users.displayName })
      .from(platformAlerts)
      .leftJoin(tenants, eq(tenants.id, platformAlerts.tenantId))
      .leftJoin(users, eq(users.id, platformAlerts.acknowledgedBy))
      .where(where)
      .orderBy(desc(platformAlerts.openedAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.a.id,
      key: r.a.key,
      severity: r.a.severity,
      title: r.a.title,
      detail: r.a.detail,
      tenantId: r.a.tenantId,
      tenantName: r.tenantName,
      openedAt: r.a.openedAt.toISOString(),
      lastSeenAt: r.a.lastSeenAt.toISOString(),
      resolvedAt: r.a.resolvedAt?.toISOString() ?? null,
      notifiedAt: r.a.notifiedAt?.toISOString() ?? null,
      acknowledgedAt: r.a.acknowledgedAt?.toISOString() ?? null,
      acknowledgedByName: r.ackName,
    }));
  }

  async acknowledge(id: string) {
    const tx = this.db.current();
    const userId = RequestContextStore.require().actor?.userId ?? null;
    const [row] = await tx
      .update(platformAlerts)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: userId })
      .where(eq(platformAlerts.id, id))
      .returning({ id: platformAlerts.id });
    if (!row) throw AppError.notFound('Alerte');
    return (await this.list('all')).find((a) => a.id === id)!;
  }

  // ------------------------------------------------------------------ conditions

  private async collect(tx: Db, now: Date): Promise<Condition[]> {
    const out: Condition[] = [];
    const T = ALERT_THRESHOLDS;

    // Redis
    if (!(await this.redis.ping()))
      out.push({ key: 'redis:down', severity: 'CRITICAL', title: 'Redis injoignable', detail: {} });

    // Outbox
    const outbox = (
      await tx.execute<{ backlog: number; oldest: number | null }>(sql`
        select count(*)::int as backlog,
               extract(epoch from (now() - min(occurred_at)))::int as oldest
        from outbox_events where published_at is null`)
    ).rows[0]!;
    const lag = Number(outbox.oldest ?? 0);
    if (lag > T.outboxLagWarningSeconds)
      out.push({
        key: 'outbox:lag',
        severity: lag > T.outboxLagCriticalSeconds ? 'CRITICAL' : 'WARNING',
        title: `Outbox en retard : plus ancien événement non publié depuis ${Math.round(lag / 60)} min`,
        detail: { backlog: outbox.backlog, oldestSeconds: lag },
      });

    // Files et DLQ
    for (const q of await this.overview.queueStats()) {
      if ((q.oldestWaitingSeconds ?? 0) > T.queueWaitingWarningSeconds)
        out.push({
          key: `queue:${q.name}:waiting`,
          severity: 'WARNING',
          title: `File « ${q.name} » : un job attend depuis ${Math.round((q.oldestWaitingSeconds ?? 0) / 60)} min`,
          detail: { ...q },
        });
    }
    for (const d of await this.overview.dlqStats()) {
      if (d.count > 0)
        out.push({
          key: `dlq:${d.name}`,
          severity: 'CRITICAL',
          title: `${d.count} job(s) en file d'échec « ${d.name} »`,
          detail: { count: d.count },
        });
    }

    // Par établissement actif
    const perTenant = await tx.execute<{
      id: string;
      name: string;
      last_refresh: string | null;
      review_open_old: number;
      sms_month: number;
      sms_cap: number;
      sched_errors: number;
      integrity_mismatches: number | null;
      integrity_at: string | null;
    }>(sql`
      select t.id, t.name,
             (select max(finished_at) from report_refreshes r where r.tenant_id = t.id) as last_refresh,
             (select count(*) from payment_attempts a where a.tenant_id = t.id and a.review_status = 'OPEN'
                 and a.updated_at < now() - make_interval(mins => ${T.reviewOpenMaxAgeMinutes}::int))::int as review_open_old,
             (select count(*) from notifications nt where nt.tenant_id = t.id and nt.channel = 'SMS'
                 and nt.status in ('SENT','DELIVERED') and nt.created_at >= date_trunc('month', now()))::int as sms_month,
             coalesce((t.settings -> 'notifications' ->> 'smsMonthlyCap')::int, 2000) as sms_cap,
             (select count(*) from scheduled_reports s where s.tenant_id = t.id and s.enabled and s.last_error is not null
                 and s.updated_at > now() - interval '24 hours')::int as sched_errors,
             (select c.mismatches from ledger_integrity_checks c where c.tenant_id = t.id order by c.checked_at desc limit 1) as integrity_mismatches,
             (select c.checked_at::text from ledger_integrity_checks c where c.tenant_id = t.id order by c.checked_at desc limit 1) as integrity_at
      from tenants t where t.status in ('ACTIVE','TRIAL')`);
    for (const t of perTenant.rows) {
      const last = t.last_refresh ? new Date(t.last_refresh).getTime() : 0;
      if (now.getTime() - last > T.staleReportsMinutes * 60_000)
        out.push({
          key: `tenant:${t.id}:stale-reports`,
          severity: 'WARNING',
          title: `${t.name} : agrégats de reporting périmés`,
          detail: { lastRefreshAt: t.last_refresh },
          tenantId: t.id,
        });
      if (t.review_open_old > 0)
        out.push({
          key: `tenant:${t.id}:review-open`,
          severity: 'WARNING',
          title: `${t.name} : ${t.review_open_old} transaction(s) à vérifier depuis plus d'une heure`,
          detail: { count: t.review_open_old },
          tenantId: t.id,
        });
      if (t.sms_cap > 0 && t.sms_month >= t.sms_cap * T.smsCapWarningRatio)
        out.push({
          key: `tenant:${t.id}:sms-cap`,
          severity: t.sms_month >= t.sms_cap ? 'CRITICAL' : 'WARNING',
          title: `${t.name} : quota SMS ${t.sms_month >= t.sms_cap ? 'atteint' : 'à 90 %'} (${t.sms_month}/${t.sms_cap})`,
          detail: { smsMonth: t.sms_month, smsCap: t.sms_cap },
          tenantId: t.id,
        });
      if (t.sched_errors > 0)
        out.push({
          key: `tenant:${t.id}:scheduled-reports`,
          severity: 'WARNING',
          title: `${t.name} : ${t.sched_errors} rapport(s) planifié(s) en erreur`,
          detail: { count: t.sched_errors },
          tenantId: t.id,
        });
      if ((t.integrity_mismatches ?? 0) > 0)
        out.push({
          key: `tenant:${t.id}:ledger-integrity`,
          severity: 'CRITICAL',
          title: `${t.name} : ${t.integrity_mismatches} écart(s) d'intégrité du grand-livre`,
          detail: { mismatches: t.integrity_mismatches, checkedAt: t.integrity_at },
          tenantId: t.id,
        });
    }

    // Notifications en échec (dernière heure, tous tenants)
    const failed = (
      await tx.execute<{ c: number }>(
        sql`select count(*)::int as c from notifications where status = 'FAILED' and created_at >= now() - interval '1 hour'`,
      )
    ).rows[0]!;
    if (failed.c >= T.notificationsFailedPerHour)
      out.push({
        key: 'notifications:failed',
        severity: 'WARNING',
        title: `${failed.c} notifications en échec dans la dernière heure`,
        detail: { count: failed.c },
      });

    // Disjoncteurs de paiement ouverts (clés Redis payments:cb:<tenant>:<provider>:open)
    try {
      const keys = await this.redis.client.keys('payments:cb:*:open');
      for (const k of keys) {
        const [, , tenantId, provider] = k.split(':');
        out.push({
          key: `tenant:${tenantId}:circuit:${provider}`,
          severity: 'WARNING',
          title: `Provider ${provider} indisponible (disjoncteur ouvert)`,
          detail: { provider },
          tenantId,
        });
      }
    } catch {
      /* Redis déjà signalé */
    }
    return out;
  }

  // ------------------------------------------------------------------ notification

  private async notify(tx: Db, alerts: (typeof platformAlerts.$inferSelect)[], now: Date) {
    if (alerts.length === 0) return 0;
    const admins = await tx.execute<{ email: string }>(
      sql`select distinct u.email from users u join memberships m on m.user_id = u.id
          where m.kind = 'PLATFORM' and m.status = 'ACTIVE' and u.status = 'ACTIVE' and u.email is not null`,
    );
    const critical = alerts.filter((a) => a.severity === 'CRITICAL').length;
    const subject = `[Polaris] ${alerts.length} alerte(s) de supervision${critical ? ` dont ${critical} critique(s)` : ''}`;
    const lines = alerts.map(
      (a) => `- [${a.severity}] ${a.title} (depuis ${a.openedAt.toISOString()})`,
    );
    const text = `${lines.join('\n')}\n\nVue plateforme : ${this.env.WEB_ORIGIN}/platform (onglet Alertes)\nRunbook : docs/runbooks/alerts.md`;
    for (const a of admins.rows) {
      try {
        await this.email.send({ to: a.email, subject, text, reference: 'platform-alert' });
      } catch (e) {
        this.logger.error({ msg: 'alert e-mail failed', err: (e as Error).message });
      }
    }
    await tx
      .update(platformAlerts)
      .set({ notifiedAt: now })
      .where(
        inArray(
          platformAlerts.id,
          alerts.map((a) => a.id),
        ),
      );
    return alerts.length;
  }
}
