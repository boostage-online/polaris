import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import type { DomainEvent } from '../domain/events';

/**
 * Outbox transactionnel (ADR-0003) : l'événement est inséré dans la transaction courante.
 * Hors transaction → erreur : on ne publie jamais un événement dont l'état métier n'est pas garanti.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly db: DatabaseService) {}

  async publish(event: DomainEvent): Promise<string> {
    const tx = this.db.current();
    const ctx = RequestContextStore.require();
    const tenantId = event.tenantId ?? ctx.tenantId ?? null;
    const payload = {
      ...event.payload,
      _meta: {
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        actorUserId: ctx.actor?.userId ?? null,
        actorMembershipId: ctx.actor?.membershipId ?? null,
      },
    };
    const res = await tx.execute<{ id: string }>(sql`
      insert into outbox_events (tenant_id, event_type, aggregate_type, aggregate_id, payload)
      values (${tenantId}, ${event.type}, ${event.aggregateType}, ${event.aggregateId ?? null}, ${JSON.stringify(payload)}::jsonb)
      returning id`);
    return res.rows[0]!.id;
  }
}
