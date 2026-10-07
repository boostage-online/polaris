import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import {
  PAYMENTS_DLQ,
  PAYMENTS_QUEUE,
  PaymentsService,
  type ConfirmJobData,
} from '../modules/payments';
import { RedisService } from '../modules/shared';

/**
 * Consomme la file `payments` : `confirm-attempt` → `PaymentsService.confirmJob` (verify + transaction).
 * Un provider muet fait échouer le job → retries exponentiels ; échec définitif → `payments-dlq`
 * (la tentative reste PENDING et la réconciliation reprend la main : aucun paiement n'est perdu ni doublé).
 */
@Injectable()
export class PaymentsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsProcessor.name);
  private worker!: Worker<ConfirmJobData>;
  private dlq!: Queue;

  constructor(
    private readonly redis: RedisService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit() {
    this.dlq = new Queue(PAYMENTS_DLQ, { connection: this.redis.duplicate() });
    this.worker = new Worker<ConfirmJobData>(PAYMENTS_QUEUE, (job) => this.process(job), {
      connection: this.redis.duplicate(),
      concurrency: 4,
    });
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const final = job.attemptsMade >= (job.opts.attempts ?? 1);
      this.logger.error({
        msg: 'payment confirmation failed',
        attemptId: job.data.attemptId,
        externalId: job.data.externalId,
        attempt: job.attemptsMade,
        final,
        err: err.message,
      });
      if (final)
        void this.dlq.add(
          'confirm-attempt',
          { ...job.data, error: err.message },
          { jobId: job.id },
        );
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.dlq?.close();
  }

  async process(job: Job<ConfirmJobData>) {
    const r = await this.payments.confirmJob(job.data);
    if (!r && job.data.source === 'WEBHOOK')
      // Webhook arrivé avant que la tentative ait un identifiant (KKiaPay) : on réessaie plus tard.
      throw new Error('Tentative introuvable pour ce webhook : nouvel essai planifié');
    return r?.status ?? 'NOT_FOUND';
  }
}
