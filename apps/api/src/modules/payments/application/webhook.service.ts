import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../database/database.service';
import { paymentAttempts, providerTransactions, webhookEvents } from '../../../database/schema';
import type { ProviderCode } from '../domain/provider';
import { ProviderRegistry } from '../infrastructure/provider-registry';
import { PaymentConfigService } from './payment-config.service';
import { PaymentsQueue } from './payments.queue';

export type WebhookOutcome =
  | { outcome: 'ACCEPTED'; eventId: string }
  | { outcome: 'DUPLICATE' }
  | { outcome: 'INVALID_SIGNATURE' }
  | { outcome: 'UNPARSEABLE' }
  | { outcome: 'UNKNOWN_ENDPOINT' };

/** En-têtes conservés pour la chronologie (jamais les secrets). */
const KEPT_HEADERS = ['content-type', 'user-agent', 'x-request-id', 'x-fedapay-signature'];

/**
 * Réception d'un webhook : authentifier (`parseWebhook`), tracer (`webhook_events`, unique par événement),
 * mettre en file — et répondre 200 en moins de 200 ms. Aucune logique métier ici : `verify` fait foi.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ProviderRegistry,
    private readonly configs: PaymentConfigService,
    private readonly queue: PaymentsQueue,
  ) {}

  async receive(
    providerCode: string,
    token: string,
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ): Promise<WebhookOutcome> {
    const code = providerCode.toUpperCase() as ProviderCode;
    const config = await this.configs.byWebhookToken(token);
    if (!config || config.provider !== code) {
      this.logger.warn({ msg: 'webhook on unknown endpoint', provider: code });
      return { outcome: 'UNKNOWN_ENDPOINT' };
    }
    const provider = this.registry.get(code);
    const parsed = provider.parseWebhook(this.configs.credentials(config), headers, rawBody);
    if (parsed === 'INVALID_SIGNATURE') {
      this.logger.warn({
        msg: 'webhook signature invalid',
        provider: code,
        tenantId: config.tenantId,
      });
      return { outcome: 'INVALID_SIGNATURE' };
    }
    if (parsed === 'UNPARSEABLE') {
      this.logger.warn({ msg: 'webhook unparseable', provider: code, tenantId: config.tenantId });
      return { outcome: 'UNPARSEABLE' };
    }
    const kept: Record<string, string> = {};
    for (const h of KEPT_HEADERS) {
      const v = headers[h];
      if (v) kept[h] = h.includes('signature') ? '[présent]' : v;
    }

    const stored = await this.db.withTenantTx(config.tenantId, async (tx) => {
      // Rapprochement : attempt_id transmis en métadonnée, sinon transaction provider déjà connue.
      let attemptId = parsed.attemptId;
      if (attemptId) {
        const a = await tx.query.paymentAttempts.findFirst({
          where: eq(paymentAttempts.id, attemptId),
        });
        if (!a) attemptId = null;
      }
      if (!attemptId && parsed.externalTransactionId) {
        const t = await tx.query.providerTransactions.findFirst({
          where: eq(providerTransactions.externalId, parsed.externalTransactionId),
        });
        attemptId = t?.attemptId ?? null;
      }
      const id = randomUUID();
      const inserted = await tx
        .insert(webhookEvents)
        .values({
          id,
          tenantId: config.tenantId,
          provider: code,
          externalEventId: parsed.externalEventId,
          externalTransactionId: parsed.externalTransactionId,
          hintStatus: parsed.hintStatus,
          attemptId,
          signatureValid: true,
          headers: kept,
          body: parsed.raw,
          receivedAt: new Date(),
          processedAt: null,
          processingError: attemptId
            ? null
            : 'Tentative introuvable à la réception : rapprochement différé',
        })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      return { id: inserted[0]?.id ?? null, attemptId };
    });
    if (!stored.id) return { outcome: 'DUPLICATE' };
    await this.queue.enqueueConfirm({
      tenantId: config.tenantId,
      attemptId: stored.attemptId ?? undefined,
      externalId: parsed.externalTransactionId ?? undefined,
      webhookEventId: stored.id,
      source: 'WEBHOOK',
    });
    return { outcome: 'ACCEPTED', eventId: stored.id };
  }
}
