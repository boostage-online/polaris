import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { providerTransactions, tenantPaymentConfigs } from '../../../database/schema';
import { ProviderRegistry } from '../infrastructure/provider-registry';
import { PaymentConfigService } from './payment-config.service';
import { WebhookService } from './webhook.service';

/**
 * « Caisse factice » du provider de démonstration : la page web /pay/fake/:externalId affiche la transaction
 * et simule le parent qui paie, échoue ou annule ; chaque action poste le webhook signé sur notre propre
 * endpoint, exactement comme le ferait FedaPay/KKiaPay. Désactivé en production (PAYMENT_FAKE_PROVIDER_ENABLED).
 */
@Injectable()
export class FakeCheckoutService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ProviderRegistry,
    private readonly configs: PaymentConfigService,
    private readonly webhooks: WebhookService,
  ) {}

  private get fake() {
    const f = this.registry.fake;
    if (!f) throw AppError.notFound('Provider de démonstration');
    return f;
  }

  async get(externalId: string) {
    const tx = await this.fake.get(externalId);
    if (!tx) throw AppError.notFound('Transaction');
    return {
      externalId: tx.externalId,
      amount: tx.amount,
      status: tx.status,
      createdAt: tx.createdAt,
    };
  }

  async complete(externalId: string, status: 'SUCCESS' | 'FAILED' | 'CANCELLED', amount?: number) {
    const fake = this.fake;
    const endpoint = await this.db.withPlatformTx('fake checkout endpoint', async (tx) => {
      const t = await tx.query.providerTransactions.findFirst({
        where: eq(providerTransactions.externalId, externalId),
      });
      if (!t) return null;
      const cfg = await tx.query.tenantPaymentConfigs.findFirst({
        where: and(
          eq(tenantPaymentConfigs.tenantId, t.tenantId),
          eq(tenantPaymentConfigs.provider, 'FAKE'),
        ),
      });
      return cfg
        ? { token: cfg.webhookToken, secret: this.configs.credentials(cfg).webhookSecret }
        : null;
    });
    if (!endpoint) throw AppError.notFound('Transaction');
    const hook = await fake.complete(externalId, status, {
      amount,
      webhookSecret: endpoint.secret,
    });
    if (!hook) throw AppError.notFound('Transaction');
    const outcome = await this.webhooks.receive(
      'fake',
      endpoint.token,
      hook.headers,
      Buffer.from(hook.body),
    );
    return { status: hook.tx.status, webhook: outcome.outcome };
  }

  async setOutage(on: boolean) {
    await this.fake.setOutage(on);
    return { outage: on };
  }
}
