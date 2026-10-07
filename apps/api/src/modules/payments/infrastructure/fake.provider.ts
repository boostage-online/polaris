import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import {
  ProviderError,
  type InitiateInput,
  type InitiateResult,
  type NormalizedStatus,
  type ParsedWebhook,
  type PaymentProvider,
  type ProviderCredentials,
  type ProviderTransactionSummary,
  type VerifyResult,
} from '../domain/provider';

export interface FakeTransaction {
  externalId: string;
  attemptId: string | null;
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  method: 'MOBILE_MONEY' | 'CARD';
  createdAt: string;
  updatedAt: string;
}

const KEY = (id: string) => `fake-provider:tx:${id}`;
const OUTAGE = 'fake-provider:outage';
const TTL_SECONDS = 7 * 24 * 3600;

/**
 * Provider de démonstration et de test : états pilotables (page « caisse factice » du web, endpoint de dev,
 * ou Redis directement dans les tests), panne simulable (`setOutage`), webhooks signés rejouables.
 * État partagé via Redis pour être visible de l'API et du worker. Jamais activé en production.
 */
export class FakeProvider implements PaymentProvider {
  readonly code = 'FAKE' as const;
  constructor(
    private readonly redis: Redis,
    private readonly webOrigin: string,
  ) {}

  capabilities() {
    return {
      serverInitiated: true,
      clientWidget: false,
      refunds: false,
      payouts: false,
      listTransactions: true,
    };
  }

  // ---------------------------------------------------------------- pilotage
  async setOutage(on: boolean) {
    if (on) await this.redis.set(OUTAGE, '1', 'EX', 3600);
    else await this.redis.del(OUTAGE);
  }
  private async assertUp() {
    if (await this.redis.get(OUTAGE))
      throw new ProviderError('UNAVAILABLE', 'Provider de démonstration en panne simulée');
  }
  async get(externalId: string): Promise<FakeTransaction | null> {
    const raw = await this.redis.get(KEY(externalId));
    return raw ? (JSON.parse(raw) as FakeTransaction) : null;
  }
  /** Change l'état d'une transaction (le « parent » a payé / échoué / annulé) et retourne le webhook signé à poster. */
  async complete(
    externalId: string,
    status: FakeTransaction['status'],
    opts: { amount?: number; webhookSecret?: string | null } = {},
  ): Promise<{ tx: FakeTransaction; headers: Record<string, string>; body: string } | null> {
    const tx = await this.get(externalId);
    if (!tx) return null;
    tx.status = status;
    if (opts.amount !== undefined) tx.amount = opts.amount;
    tx.updatedAt = new Date().toISOString();
    await this.redis.set(KEY(externalId), JSON.stringify(tx), 'EX', TTL_SECONDS);
    const body = JSON.stringify({
      id: `evt_${randomBytes(6).toString('hex')}`,
      event: `transaction.${status.toLowerCase()}`,
      transactionId: externalId,
      attemptId: tx.attemptId,
      amount: tx.amount,
      status,
      timestamp: tx.updatedAt,
    });
    return {
      tx,
      headers: { 'x-fake-signature': FakeProvider.sign(opts.webhookSecret ?? '', body) },
      body,
    };
  }
  static sign(secret: string, body: string) {
    return createHash('sha256').update(`${secret}|${body}`).digest('hex');
  }

  // ---------------------------------------------------------------- port
  async initiate(_creds: ProviderCredentials, input: InitiateInput): Promise<InitiateResult> {
    await this.assertUp();
    const externalId = `fake_${randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();
    const tx: FakeTransaction = {
      externalId,
      attemptId: input.attemptId,
      amount: input.amount,
      status: 'PENDING',
      method: 'MOBILE_MONEY',
      createdAt: now,
      updatedAt: now,
    };
    await this.redis.set(KEY(externalId), JSON.stringify(tx), 'EX', TTL_SECONDS);
    const url = `${this.webOrigin}/pay/fake/${externalId}?return=${encodeURIComponent(input.callbackUrl)}`;
    return { externalId, checkout: { kind: 'REDIRECT', url } };
  }

  async verify(_creds: ProviderCredentials, externalId: string): Promise<VerifyResult> {
    await this.assertUp();
    const tx = await this.get(externalId);
    if (!tx)
      return {
        status: 'NOT_FOUND',
        providerStatus: null,
        amount: null,
        fees: null,
        currency: null,
        method: null,
        attemptId: null,
        raw: null,
      };
    const map: Record<FakeTransaction['status'], NormalizedStatus> = {
      PENDING: 'PENDING',
      SUCCESS: 'SUCCEEDED',
      FAILED: 'FAILED',
      CANCELLED: 'CANCELLED',
    };
    return {
      status: map[tx.status],
      providerStatus: tx.status,
      amount: tx.amount,
      fees: Math.round(tx.amount * 0.017),
      currency: 'XOF',
      method: tx.method,
      attemptId: tx.attemptId,
      raw: tx,
    };
  }

  parseWebhook(
    creds: ProviderCredentials,
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ): ParsedWebhook | 'INVALID_SIGNATURE' | 'UNPARSEABLE' {
    const given = headers['x-fake-signature'] ?? '';
    const expected = FakeProvider.sign(creds.webhookSecret ?? '', rawBody.toString('utf8'));
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return 'INVALID_SIGNATURE';
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return 'UNPARSEABLE';
    }
    const status = typeof body['status'] === 'string' ? body['status'] : '';
    return {
      externalEventId: typeof body['id'] === 'string' ? body['id'] : '',
      externalTransactionId:
        typeof body['transactionId'] === 'string' ? body['transactionId'] : null,
      hintStatus: status === 'SUCCESS' ? 'SUCCEEDED' : status === 'FAILED' ? 'FAILED' : null,
      attemptId: typeof body['attemptId'] === 'string' ? body['attemptId'] : null,
      raw: body,
    };
  }

  async listTransactions(
    _creds: ProviderCredentials,
    day: { from: Date; to: Date },
  ): Promise<ProviderTransactionSummary[]> {
    await this.assertUp();
    const out: ProviderTransactionSummary[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', KEY('*'), 'COUNT', 200);
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.redis.mget(...keys);
      for (const v of values) {
        if (!v) continue;
        const tx = JSON.parse(v) as FakeTransaction;
        const ts = Date.parse(tx.updatedAt);
        if (ts < day.from.getTime() || ts >= day.to.getTime()) continue;
        out.push({
          externalId: tx.externalId,
          status:
            tx.status === 'SUCCESS'
              ? 'SUCCEEDED'
              : tx.status === 'FAILED'
                ? 'FAILED'
                : tx.status === 'CANCELLED'
                  ? 'CANCELLED'
                  : 'PENDING',
          amount: tx.amount,
          fees: Math.round(tx.amount * 0.017),
          occurredAt: tx.updatedAt,
          attemptId: tx.attemptId,
        });
      }
    } while (cursor !== '0');
    return out;
  }

  async healthCheck() {
    try {
      await this.assertUp();
      return { ok: true, detail: 'Provider de démonstration prêt' };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
