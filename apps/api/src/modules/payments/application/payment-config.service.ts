import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { UpsertPaymentConfigSchema } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import { tenantPaymentConfigs, tenants } from '../../../database/schema';
import { AuditService } from '../../audit';
import { paymentProviderConfigured } from '../domain/events';
import type { ProviderCode, ProviderCredentials } from '../domain/provider';
import { ProviderRegistry } from '../infrastructure/provider-registry';
import { LocalKeyWrapper, OutboxService, maskSecret, openSecrets, sealSecrets } from '../../shared';

type ConfigRow = typeof tenantPaymentConfigs.$inferSelect;
interface SealedCredentials {
  secrets: Record<string, string>;
}

/** Secrets attendus par provider (le reste est refusé : on ne stocke que ce qu'on utilise). */
const EXPECTED_SECRETS: Record<ProviderCode, string[]> = {
  FEDAPAY: ['secretKey'],
  KKIAPAY: ['privateKey', 'secret'],
  FAKE: [],
};

/**
 * Compte marchand de l'établissement (ADR-0010, Option A) : une configuration par provider, secrets
 * chiffrés par enveloppe, déchiffrés uniquement ici et passés aux adaptateurs ; jamais renvoyés par l'API.
 */
@Injectable()
export class PaymentConfigService {
  private readonly wrapper: LocalKeyWrapper;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly registry: ProviderRegistry,
  ) {
    this.wrapper = new LocalKeyWrapper(env.PAYMENT_MASTER_KEY);
  }

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  webhookUrl(provider: string, token: string) {
    return `${this.env.API_PUBLIC_URL}/api/v1/webhooks/payments/${provider.toLowerCase()}/${token}`;
  }

  // ---------------------------------------------------------------- lecture
  async list() {
    const rows = await this.db
      .current()
      .select()
      .from(tenantPaymentConfigs)
      .where(eq(tenantPaymentConfigs.tenantId, this.tenantId));
    return rows.map((r) => this.dto(r));
  }

  /** Configuration active du tenant (un seul provider par établissement au MVP). */
  async active(tx: Db = this.db.current(), tenantId = this.tenantId): Promise<ConfigRow | null> {
    const rows = await tx
      .select()
      .from(tenantPaymentConfigs)
      .where(
        and(eq(tenantPaymentConfigs.tenantId, tenantId), eq(tenantPaymentConfigs.status, 'ACTIVE')),
      );
    return rows[0] ?? null;
  }

  async byProvider(provider: ProviderCode, tx: Db = this.db.current()): Promise<ConfigRow | null> {
    return (
      (await tx.query.tenantPaymentConfigs.findFirst({
        where: and(
          eq(tenantPaymentConfigs.tenantId, this.tenantId),
          eq(tenantPaymentConfigs.provider, provider),
        ),
      })) ?? null
    );
  }

  /** Résolution d'un webhook : le jeton d'URL désigne le tenant et le provider (lecture plateforme, hors contexte). */
  async byWebhookToken(token: string): Promise<(ConfigRow & { tenantCode: string }) | null> {
    return this.db.withPlatformTx('webhook config lookup', async (tx) => {
      const rows = await tx
        .select({ c: tenantPaymentConfigs, tenantCode: tenants.code })
        .from(tenantPaymentConfigs)
        .innerJoin(tenants, eq(tenants.id, tenantPaymentConfigs.tenantId))
        .where(eq(tenantPaymentConfigs.webhookToken, token))
        .limit(1);
      const r = rows[0];
      return r ? { ...r.c, tenantCode: r.tenantCode } : null;
    });
  }

  /** Secrets déchiffrés pour l'adaptateur : ne sortent jamais du module. */
  credentials(row: ConfigRow): ProviderCredentials {
    const sealed = openSecrets<SealedCredentials>(this.wrapper, row.credentialsEncrypted);
    const webhookSecret = row.webhookSecretEncrypted
      ? openSecrets<{ value: string }>(this.wrapper, row.webhookSecretEncrypted).value
      : null;
    return {
      publicKey: row.publicKey,
      secrets: sealed.secrets,
      webhookSecret,
      environment: row.environment,
    };
  }

  // ---------------------------------------------------------------- écriture
  async upsert(input: z.infer<typeof UpsertPaymentConfigSchema>) {
    const tx = this.db.current();
    if (!this.registry.available().includes(input.provider))
      throw AppError.validation([
        { path: 'provider', message: `Provider ${input.provider} non disponible` },
      ]);
    if (input.provider === 'FAKE' && input.environment === 'LIVE')
      throw AppError.validation([
        { path: 'environment', message: 'Le provider de démonstration est sandbox uniquement' },
      ]);
    const expected = EXPECTED_SECRETS[input.provider];
    const existing = await this.byProvider(input.provider, tx);
    const previous = existing ? this.credentials(existing) : null;
    // Un secret omis ou masqué (« •••• ») conserve la valeur précédente : l'écran ne renvoie jamais la clé complète.
    const secrets: Record<string, string> = {};
    for (const k of expected) {
      const given = input.credentials[k];
      if (given && !given.startsWith('••••')) secrets[k] = given.trim();
      else if (previous?.secrets[k]) secrets[k] = previous.secrets[k]!;
      else throw AppError.validation([{ path: `credentials.${k}`, message: 'Clé requise' }]);
    }
    for (const k of Object.keys(input.credentials))
      if (!expected.includes(k))
        throw AppError.validation([
          { path: `credentials.${k}`, message: 'Clé inconnue pour ce provider' },
        ]);
    if (input.provider === 'KKIAPAY' && !(input.publicKey ?? existing?.publicKey))
      throw AppError.validation([
        { path: 'publicKey', message: 'Clé publique requise pour KKiaPay' },
      ]);
    let webhookSecretEncrypted = existing?.webhookSecretEncrypted ?? null;
    if (input.webhookSecret && !input.webhookSecret.startsWith('••••'))
      webhookSecretEncrypted = sealSecrets(this.wrapper, { value: input.webhookSecret.trim() });
    else if (!webhookSecretEncrypted && input.provider === 'FAKE')
      webhookSecretEncrypted = sealSecrets(this.wrapper, {
        value: randomBytes(16).toString('hex'),
      });
    const credentialsEncrypted = sealSecrets(this.wrapper, { secrets } satisfies SealedCredentials);
    const now = new Date();
    const id = existing?.id ?? randomUUID();
    // Changer de clés ou d'environnement impose un nouveau test avant activation.
    const status = 'PENDING_TEST' as const;
    if (existing) {
      await tx
        .update(tenantPaymentConfigs)
        .set({
          environment: input.environment,
          publicKey: input.publicKey === undefined ? existing.publicKey : input.publicKey,
          credentialsEncrypted,
          webhookSecretEncrypted,
          status,
        })
        .where(eq(tenantPaymentConfigs.id, existing.id));
    } else {
      await tx.insert(tenantPaymentConfigs).values({
        id,
        tenantId: this.tenantId,
        provider: input.provider,
        mode: 'OWN_ACCOUNT',
        environment: input.environment,
        publicKey: input.publicKey ?? null,
        credentialsEncrypted,
        webhookSecretEncrypted,
        webhookToken: randomBytes(24).toString('base64url'),
        status,
        lastTestAt: null,
        lastTestResult: null,
        createdBy: RequestContextStore.require().actor?.userId ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
    await this.audit.record({
      action: existing ? 'payment_config.updated' : 'payment_config.created',
      entityType: 'TenantPaymentConfig',
      entityId: id,
      after: {
        provider: input.provider,
        environment: input.environment,
        keys: Object.keys(secrets),
      },
    });
    return this.dto(
      (await tx.query.tenantPaymentConfigs.findFirst({ where: eq(tenantPaymentConfigs.id, id) }))!,
    );
  }

  /** Test de connexion avec les clés fournies ; succès → ACTIVE (les autres providers du tenant sont désactivés). */
  async test(provider: ProviderCode) {
    const tx = this.db.current();
    const row = await this.byProvider(provider, tx);
    if (!row) throw AppError.notFound('Configuration de paiement');
    const result = await this.registry.get(provider).healthCheck(this.credentials(row));
    const status = result.ok ? 'ACTIVE' : 'PENDING_TEST';
    if (result.ok)
      await tx
        .update(tenantPaymentConfigs)
        .set({ status: 'DISABLED' })
        .where(
          and(
            eq(tenantPaymentConfigs.tenantId, this.tenantId),
            eq(tenantPaymentConfigs.status, 'ACTIVE'),
          ),
        );
    await tx
      .update(tenantPaymentConfigs)
      .set({ status, lastTestAt: new Date(), lastTestResult: result.detail })
      .where(eq(tenantPaymentConfigs.id, row.id));
    await this.audit.record({
      action: 'payment_config.tested',
      entityType: 'TenantPaymentConfig',
      entityId: row.id,
      after: { provider, ok: result.ok, detail: result.detail },
    });
    await this.outbox.publish(
      paymentProviderConfigured({
        tenantId: this.tenantId,
        provider,
        environment: row.environment,
        status,
      }),
    );
    return this.dto(
      (await tx.query.tenantPaymentConfigs.findFirst({
        where: eq(tenantPaymentConfigs.id, row.id),
      }))!,
    );
  }

  async setStatus(provider: ProviderCode, status: 'ACTIVE' | 'DISABLED') {
    const tx = this.db.current();
    const row = await this.byProvider(provider, tx);
    if (!row) throw AppError.notFound('Configuration de paiement');
    if (status === 'ACTIVE' && row.status === 'PENDING_TEST')
      throw AppError.conflict('Testez la connexion avant d’activer ce provider');
    if (status === 'ACTIVE')
      await tx
        .update(tenantPaymentConfigs)
        .set({ status: 'DISABLED' })
        .where(
          and(
            eq(tenantPaymentConfigs.tenantId, this.tenantId),
            eq(tenantPaymentConfigs.status, 'ACTIVE'),
          ),
        );
    await tx
      .update(tenantPaymentConfigs)
      .set({ status })
      .where(eq(tenantPaymentConfigs.id, row.id));
    await this.audit.record({
      action: 'payment_config.status',
      entityType: 'TenantPaymentConfig',
      entityId: row.id,
      before: { status: row.status },
      after: { status },
    });
    return this.dto(
      (await tx.query.tenantPaymentConfigs.findFirst({
        where: eq(tenantPaymentConfigs.id, row.id),
      }))!,
    );
  }

  dto(r: ConfigRow) {
    const creds = this.credentials(r);
    return {
      id: r.id,
      provider: r.provider,
      mode: r.mode,
      environment: r.environment,
      publicKey: r.publicKey,
      credentialsMasked: Object.fromEntries(
        Object.entries(creds.secrets).map(([k, v]) => [k, maskSecret(v)]),
      ),
      webhookSecretSet: Boolean(creds.webhookSecret),
      webhookUrl: this.webhookUrl(r.provider, r.webhookToken),
      status: r.status,
      lastTestAt: r.lastTestAt?.toISOString() ?? null,
      lastTestResult: r.lastTestResult,
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
