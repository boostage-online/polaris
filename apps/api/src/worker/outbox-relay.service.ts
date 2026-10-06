import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { DatabaseService } from '../database/database.service';
import { MetricsService, RedisService } from '../modules/shared';

export const DOMAIN_EVENTS_QUEUE = 'domain-events';
export const DOMAIN_EVENTS_DLQ = 'domain-events-dlq';

interface OutboxRow {
  id: string;
  tenant_id: string | null;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

/**
 * Relais outbox → BullMQ (ADR-0003). Réveillé par LISTEN outbox, et par un poll de sécurité toutes les 2 s.
 * `FOR UPDATE SKIP LOCKED` autorise plusieurs relais concurrents sans doublon ; `jobId = event.id`
 * rend l'ajout en file idempotent côté BullMQ.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private queue!: Queue;
  private listener: Client | null = null;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private stopped = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleInit() {
    this.queue = new Queue(DOMAIN_EVENTS_QUEUE, { connection: this.redis.duplicate() });
    await this.startListener();
    this.timer = setInterval(() => void this.drain(), 2_000);
    await this.drain();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.listener?.end().catch(() => undefined);
    await this.queue.close();
  }

  private async startListener() {
    try {
      // Client dédié (hors pool) pour LISTEN : une connexion en écoute ne doit jamais retourner au pool.
      const client = new Client({
        connectionString: this.db.platformPool.options.connectionString,
      });
      await client.connect();
      await client.query('listen outbox');
      client.on('notification', () => void this.drain());
      client.on('error', (e) => this.logger.warn({ msg: 'listener error', err: e.message }));
      this.listener = client;
    } catch (e) {
      this.logger.warn({ msg: 'LISTEN outbox indisponible, poll seul', err: (e as Error).message });
    }
  }

  /** Publie jusqu'à 100 événements non publiés. Renvoie le nombre relayé. */
  async drain(): Promise<number> {
    if (this.draining || this.stopped) return 0;
    this.draining = true;
    try {
      let total = 0;
      for (;;) {
        const n = await this.db.withPlatformTx('outbox relay', async (tx) => {
          const res = await tx.execute<OutboxRow>(sql`
            select id, tenant_id, event_type, aggregate_type, aggregate_id, payload, occurred_at
            from outbox_events where published_at is null order by occurred_at limit 100 for update skip locked`);
          if (res.rows.length === 0) return 0;
          await this.queue.addBulk(
            res.rows.map((r) => ({
              name: r.event_type,
              data: {
                id: r.id,
                type: r.event_type,
                tenantId: r.tenant_id,
                aggregateType: r.aggregate_type,
                aggregateId: r.aggregate_id,
                payload: r.payload,
                occurredAt: r.occurred_at,
              },
              opts: {
                jobId: r.id,
                attempts: 5,
                backoff: { type: 'exponential', delay: 30_000 },
                removeOnComplete: 1000,
                removeOnFail: false,
              },
            })),
          );
          const ids = res.rows.map((r) => r.id);
          await tx.execute(
            sql`update outbox_events set published_at = now(), attempts = attempts + 1 where id = any(${ids}::uuid[])`,
          );
          for (const r of res.rows) this.metrics.outboxPublished.inc({ event_type: r.event_type });
          return res.rows.length;
        });
        total += n;
        if (n < 100) return total;
      }
    } catch (e) {
      this.logger.error({ msg: 'outbox drain failed', err: (e as Error).message });
      return 0;
    } finally {
      this.draining = false;
    }
  }
}
