import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '../../shared';

export const REPORTS_QUEUE = 'reports';

export type ReportsJobData =
  | { kind: 'tenant-export'; tenantId: string; exportId: string }
  | { kind: 'refresh'; tenantId: string; full?: boolean };

/** File `reports` : exports complets et rafraîchissements à la demande (le worker la consomme). */
@Injectable()
export class ReportsQueue implements OnModuleDestroy {
  private readonly logger = new Logger(ReportsQueue.name);
  private queue: Queue<ReportsJobData> | null = null;

  constructor(private readonly redis: RedisService) {}

  private get q() {
    this.queue ??= new Queue<ReportsJobData>(REPORTS_QUEUE, { connection: this.redis.duplicate() });
    return this.queue;
  }

  async enqueue(data: ReportsJobData) {
    const jobId =
      data.kind === 'tenant-export'
        ? `export:${data.exportId}`
        : `refresh:${data.tenantId}:${data.full ? 'full' : 'inc'}:${Date.now()}`;
    try {
      await this.q.add(data.kind, data, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 200,
      });
    } catch (e) {
      this.logger.error({ msg: 'reports queue unavailable', err: (e as Error).message });
    }
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}
