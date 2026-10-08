import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { RequestContextStore } from '../database/request-context';
import { RedisService } from '../modules/shared';
import { EVENT_HANDLERS, type EventHandler, type QueuedEvent } from './event-handlers';
import { DOMAIN_EVENTS_DLQ, DOMAIN_EVENTS_QUEUE } from './outbox-relay.service';

/**
 * Consomme `domain-events` et distribue aux handlers. Idempotence par (handler, event_id) dans
 * processed_events : un événement rejoué n'a aucun effet. Échec définitif → file DLQ + log d'erreur.
 */
@Injectable()
export class DomainEventsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventsProcessor.name);
  private worker!: Worker<QueuedEvent>;
  private dlq!: Queue;
  private readonly byType = new Map<string, EventHandler[]>();

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    @Inject(EVENT_HANDLERS) handlers: EventHandler[],
  ) {
    for (const h of handlers)
      for (const t of h.eventTypes) this.byType.set(t, [...(this.byType.get(t) ?? []), h]);
  }

  onModuleInit() {
    this.dlq = new Queue(DOMAIN_EVENTS_DLQ, { connection: this.redis.duplicate() });
    this.worker = new Worker<QueuedEvent>(DOMAIN_EVENTS_QUEUE, (job) => this.process(job), {
      connection: this.redis.duplicate(),
      concurrency: 8,
    });
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const final = job.attemptsMade >= (job.opts.attempts ?? 1);
      this.logger.error({
        msg: 'event handling failed',
        eventId: job.data.id,
        type: job.data.type,
        attempt: job.attemptsMade,
        final,
        err: err.message,
      });
      if (final)
        void this.dlq.add(
          job.data.type,
          { ...job.data, error: err.message },
          { jobId: job.data.id },
        );
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.dlq?.close();
  }

  async process(job: Job<QueuedEvent>) {
    const event = job.data;
    const handlers = this.byType.get(event.type) ?? [];
    const meta = (event.payload._meta ?? {}) as { traceId?: string; requestId?: string };
    await RequestContextStore.run(
      RequestContextStore.blank({
        traceId: meta.traceId,
        requestId: meta.requestId,
        tenantId: event.tenantId,
      }),
      async () => {
        for (const handler of handlers) {
          const fresh = await this.db.withPlatformTx('processed_events claim', async (tx) => {
            const res = await tx.execute(
              sql`insert into processed_events (handler, event_id) values (${handler.name}, ${event.id}) on conflict do nothing`,
            );
            return (res.rowCount ?? 0) > 0;
          });
          if (!fresh) continue;
          try {
            await handler.handle(event);
          } catch (e) {
            await this.db.withPlatformTx('processed_events release', (tx) =>
              tx.execute(
                sql`delete from processed_events where handler = ${handler.name} and event_id = ${event.id}`,
              ),
            );
            throw e;
          }
        }
      },
    );
  }
}
