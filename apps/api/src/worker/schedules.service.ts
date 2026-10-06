import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { tenants } from '../database/schema';
import { SessionService } from '../modules/academic';
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
  ) {}

  async onModuleInit() {
    this.queue = new Queue(SCHEDULES_QUEUE, { connection: this.redis.duplicate() });
    await this.queue.upsertJobScheduler(
      'daily-session-generation',
      { pattern: '30 2 * * *', tz: 'Africa/Porto-Novo' },
      { name: 'generate-sessions' },
    );
    this.worker = new Worker(SCHEDULES_QUEUE, async () => this.generateAll(), {
      connection: this.redis.duplicate(),
      concurrency: 1,
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
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
