import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '../../shared';

export const PAYMENTS_QUEUE = 'payments';
export const PAYMENTS_DLQ = 'payments-dlq';

export interface ConfirmJobData {
  tenantId: string;
  attemptId?: string;
  externalId?: string;
  webhookEventId?: string;
  source: 'WEBHOOK' | 'RETURN' | 'RECONCILIATION' | 'MANUAL';
}

/**
 * File `payments` : jobs `confirm-attempt` (webhook, retour parent injoignable, réconciliation).
 * Retries exponentiels (6 essais ≈ 10 min) ; échec définitif → `payments-dlq` (écran « à traiter »).
 */
@Injectable()
export class PaymentsQueue implements OnModuleDestroy {
  private readonly logger = new Logger(PaymentsQueue.name);
  private queue: Queue<ConfirmJobData> | null = null;

  constructor(private readonly redis: RedisService) {}

  private get q() {
    this.queue ??= new Queue<ConfirmJobData>(PAYMENTS_QUEUE, {
      connection: this.redis.duplicate(),
    });
    return this.queue;
  }

  async enqueueConfirm(data: ConfirmJobData) {
    const key = `confirm:${data.attemptId ?? data.externalId ?? 'x'}:${data.webhookEventId ?? data.source}`;
    try {
      await this.q.add('confirm-attempt', data, {
        jobId: key.replace(/[^A-Za-z0-9:_-]/g, '_'),
        attempts: 6,
        backoff: { type: 'exponential', delay: 20_000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      });
    } catch (e) {
      // La file est un accélérateur : si Redis manque, la réconciliation (5 min) tranchera.
      this.logger.error({ msg: 'payments queue unavailable', err: (e as Error).message });
    }
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}
