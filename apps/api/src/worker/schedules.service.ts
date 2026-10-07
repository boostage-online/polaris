import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { tenants } from '../database/schema';
import { SessionService } from '../modules/academic';
import { LedgerService, UnpaidService } from '../modules/billing';
import { NotificationPlanner } from '../modules/notifications';
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
