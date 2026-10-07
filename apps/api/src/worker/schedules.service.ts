import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { tenants } from '../database/schema';
import { SessionService } from '../modules/academic';
import { LedgerService, UnpaidService } from '../modules/billing';
import { NotificationPlanner } from '../modules/notifications';
import { ReconciliationService } from '../modules/payments';
import { ReportRefreshService, ScheduledReportsService } from '../modules/reporting';
import { RedisService } from '../modules/shared';

export const SCHEDULES_QUEUE = 'schedules';
/** Horizon de génération : les séances des 14 prochains jours existent toujours. */
export const SESSION_HORIZON_DAYS = 14;

/**
 * Génération quotidienne des séances depuis les emplois du temps, tenant par tenant.
 * Idempotente (ON CONFLICT DO NOTHING) : un rejeu ou un second worker ne crée pas de doublon.
 */
@Injectable()
export class SchedulesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulesService.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationPlanner,
    private readonly ledger: LedgerService,
    private readonly unpaid: UnpaidService,
    private readonly reconciliation: ReconciliationService,
    private readonly reportRefresh: ReportRefreshService,
    private readonly scheduledReports: ScheduledReportsService,
  ) {}

  async onModuleInit() {
    this.queue = new Queue(SCHEDULES_QUEUE, { connection: this.redis.duplicate() });
    await this.queue.upsertJobScheduler(
      'daily-session-generation',
      { pattern: '30 2 * * *', tz: 'Africa/Porto-Novo' },
      { name: 'generate-sessions' },
    );
    await this.queue.upsertJobScheduler(
      'hourly-missing-sheets',
      { every: 3_600_000 },
      { name: 'missing-sheets' },
    );
    await this.queue.upsertJobScheduler(
      'quarter-hourly-dispatch',
      { every: 15 * 60_000 },
      { name: 'dispatch-notifications' },
    );
    await this.queue.upsertJobScheduler(
      'daily-billing',
      { pattern: '0 6 * * *', tz: 'Africa/Porto-Novo' },
      { name: 'billing-daily' },
    );
    await this.queue.upsertJobScheduler(
      'payments-reconcile-pending',
      { every: 5 * 60_000 },
      { name: 'payments-reconcile-pending' },
    );
    await this.queue.upsertJobScheduler(
      'payments-expire-stale',
      { every: 15 * 60_000 },
      { name: 'payments-expire-stale' },
    );
    await this.queue.upsertJobScheduler(
      'payments-daily-reconciliation',
      { pattern: '30 5 * * *', tz: 'Africa/Porto-Novo' },
      { name: 'payments-daily-reconciliation' },
    );
    await this.queue.upsertJobScheduler(
      'reports-refresh',
      { every: 5 * 60_000 },
      { name: 'reports-refresh' },
    );
    await this.queue.upsertJobScheduler(
      'reports-scheduled-send',
      { pattern: '30 6 * * *', tz: 'Africa/Porto-Novo' },
      { name: 'reports-scheduled-send' },
    );
    this.worker = new Worker(SCHEDULES_QUEUE, async (job) => this.run(job.name), {
      connection: this.redis.duplicate(),
      concurrency: 1,
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async run(name: string) {
    if (name === 'missing-sheets') return this.missingSheetsAll();
    if (name === 'dispatch-notifications') return this.dispatchAll();
    if (name === 'billing-daily') return this.billingDaily();
    if (name === 'payments-reconcile-pending') return this.paymentsJob('pending');
    if (name === 'payments-expire-stale') return this.paymentsJob('stale');
    if (name === 'payments-daily-reconciliation') return this.paymentsJob('daily');
    if (name === 'reports-refresh') return this.reportsRefreshAll();
    if (name === 'reports-scheduled-send') return this.scheduledReportsAll();
    return this.generateAll();
  }

  private async activeTenantIds() {
    return this.db.withPlatformTx('list active tenants', async (tx) =>
      (
        await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(inArray(tenants.status, ['TRIAL', 'ACTIVE']))
      ).map((t) => t.id),
    );
  }

  /** Appels manquants : notification in-app aux enseignants 2 h après la fin de séance (idempotent). */
  async missingSheetsAll() {
    const results: Record<string, number> = {};
    for (const id of await this.activeTenantIds()) {
      try {
        results[id] = await this.notifications.planMissingSheets(id);
      } catch (e) {
        this.logger.error({ msg: 'missing sheets notification failed', tenantId: id, err: e });
      }
    }
    this.logger.log({ msg: 'missing sheets done', results });
    return results;
  }

  /** Filet de sécurité : envoie ce qui serait resté QUEUED (renvoi manuel, avertissement de quota…). */
  async dispatchAll() {
    for (const id of await this.activeTenantIds()) {
      try {
        await this.notifications.dispatch(id);
      } catch (e) {
        this.logger.error({ msg: 'notification dispatch failed', tenantId: id, err: e });
      }
    }
    return { ok: true };
  }

  /** Quotidien : statuts d'échéance (DUE/OVERDUE), rappels J−n / J+1 / récurrents, contrôle d'intégrité du grand-livre. */
  async billingDaily() {
    const results: Record<string, unknown> = {};
    for (const id of await this.activeTenantIds()) {
      try {
        results[id] = await this.db.withTenantTx(id, async (tx) => {
          const refreshed = await this.ledger.refreshDueStatuses(tx);
          const reminders = await this.unpaid.scheduleReminders(tx);
          const integrity = await this.ledger.integrityCheck();
          return { refreshed, ...reminders, mismatches: integrity.mismatches };
        });
      } catch (e) {
        this.logger.error({ msg: 'billing daily failed', tenantId: id, err: e });
      }
    }
    this.logger.log({ msg: 'billing daily done', results });
    return results;
  }

  /** Réconciliation des paiements (Partie 10) : tenant par tenant, avec les clés de chacun. */
  async paymentsJob(kind: 'pending' | 'stale' | 'daily') {
    const results: Record<string, unknown> = {};
    for (const id of await this.reconciliation.tenantsWithActiveConfig()) {
      try {
        results[id] =
          kind === 'pending'
            ? await this.reconciliation.reconcilePending(id)
            : kind === 'stale'
              ? await this.reconciliation.expireStale(id)
              : await this.reconciliation.daily(id);
      } catch (e) {
        this.logger.error({
          msg: `payments ${kind} failed`,
          tenantId: id,
          err: (e as Error).message,
        });
      }
    }
    return results;
  }

  /** Agrégats du reporting : derniers jours, tenant par tenant (< 5 min de fraîcheur). */
  async reportsRefreshAll() {
    const results: Record<string, unknown> = {};
    for (const id of await this.activeTenantIds()) {
      try {
        results[id] = await this.reportRefresh.refresh(id);
      } catch (e) {
        this.logger.error({
          msg: 'reports refresh failed',
          tenantId: id,
          err: (e as Error).message,
        });
      }
    }
    return results;
  }

  /** Rapports planifiés dus aujourd'hui (06:30). */
  async scheduledReportsAll() {
    const results: Record<string, unknown> = {};
    for (const id of await this.activeTenantIds()) {
      try {
        results[id] = await this.scheduledReports.runDue(id);
      } catch (e) {
        this.logger.error({
          msg: 'scheduled reports failed',
          tenantId: id,
          err: (e as Error).message,
        });
      }
    }
    return results;
  }

  async generateAll() {
    const ids = await this.db.withPlatformTx('list tenants for session generation', async (tx) =>
      tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(inArray(tenants.status, ['TRIAL', 'ACTIVE'])),
    );
    const results: Record<string, { created: number; scanned: number }> = {};
    for (const { id } of ids) {
      try {
        results[id] = await this.db.withTenantTx(id, (tx) =>
          this.sessions.generate({ horizonDays: SESSION_HORIZON_DAYS }, tx),
        );
      } catch (e) {
        this.logger.error({ msg: 'session generation failed', tenantId: id, err: e });
      }
    }
    this.logger.log({ msg: 'session generation done', tenants: ids.length, results });
    return results;
  }
}
