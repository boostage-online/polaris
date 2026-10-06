import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../modules/shared';

export const MAINTENANCE_QUEUE = 'maintenance';

/** Jobs planifiés : purges techniques. Un job répétable BullMQ n'est planifié qu'une fois quel que soit le nombre de workers. */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.redis.duplicate() });
    await this.queue.upsertJobScheduler('hourly-purge', { every: 3_600_000 }, { name: 'purge' });
    this.worker = new Worker(MAINTENANCE_QUEUE, async () => this.purge(), {
      connection: this.redis.duplicate(),
      concurrency: 1,
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async purge() {
    const counts = await this.db.withPlatformTx('maintenance purge', async (tx) => {
      const r1 = await tx.execute(
        sql`delete from refresh_tokens where expires_at < now() - interval '30 days'`,
      );
      const r2 = await tx.execute(
        sql`delete from otp_codes where expires_at < now() - interval '1 day'`,
      );
      const r3 = await tx.execute(
        sql`delete from outbox_events where published_at is not null and published_at < now() - interval '7 days'`,
      );
      const r4 = await tx.execute(sql`delete from idempotency_keys where expires_at < now()`);
      const r5 = await tx.execute(
        sql`delete from tenant_invitations where accepted_at is null and expires_at < now() - interval '30 days'`,
      );
      return {
        refreshTokens: r1.rowCount,
        otp: r2.rowCount,
        outbox: r3.rowCount,
        idempotency: r4.rowCount,
        invitations: r5.rowCount,
      };
    });
    this.logger.log({ msg: 'purge done', ...counts });
    return counts;
  }
}
