import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { mapFedaPayStatus } from '../domain/attempts';
import {
  ProviderError,
  type InitiateInput,
  type InitiateResult,
  type ParsedWebhook,
  type PaymentProvider,
  type ProviderCredentials,
  type ProviderTransactionSummary,
  type VerifyResult,
} from '../domain/provider';
import { fetchJson, num, pick, str } from './http';

/**
 * Adaptateur FedaPay (création côté serveur → URL de paiement ; vérification par GET transaction ;
 * webhook signé `X-FEDAPAY-SIGNATURE: t=<ts>,s=<hmac>` avec le secret de l'endpoint).
 * Les chemins et champs suivent la documentation publique ; ils sont à confirmer sur le compte sandbox
 * (Phase 0 : enregistrer les payloads réels pour les tests d'adaptateur).
 */
export class FedaPayProvider implements PaymentProvider {
  readonly code = 'FEDAPAY' as const;
  constructor(
    private readonly bases: { SANDBOX: string; LIVE: string },
    private readonly timeoutMs: number,
    /** Tolérance d'horodatage de la signature (rejeu). */
    private readonly toleranceSeconds = 300,
  ) {}

  capabilities() {
    return {
      serverInitiated: true,
      clientWidget: false,
      refunds: true,
      payouts: false,
      listTransactions: true,
    };
  }

  private base(creds: ProviderCredentials) {
    return this.bases[creds.environment];
  }
  private headers(creds: ProviderCredentials) {
    const key = creds.secrets['secretKey'];
    if (!key) throw new ProviderError('AUTH', 'Clé secrète FedaPay absente');
    return { Authorization: `Bearer ${key}` };
  }

  async initiate(creds: ProviderCredentials, input: InitiateInput): Promise<InitiateResult> {
    const phone = input.customer.phone?.replace(/\s/g, '');
    const created = await fetchJson(`${this.base(creds)}/transactions`, {
      method: 'POST',
      headers: this.headers(creds),
      timeoutMs: this.timeoutMs,
      body: {
        description: input.description,
        amount: input.amount,
        currency: { iso: input.currency },
        callback_url: input.callbackUrl,
        custom_metadata: { attempt_id: input.attemptId },
        customer: {
          firstname: input.customer.firstName,
          lastname: input.customer.lastName,
          ...(input.customer.email ? { email: input.customer.email } : {}),
          ...(phone
            ? { phone_number: { number: phone.replace(/^\+229/, ''), country: 'bj' } }
            : {}),
        },
      },
    });
    const tx = (pick(created.body, ['v1/transaction']) ?? created.body) as Record<string, unknown>;
    const id = str(tx['id']);
    if (created.status >= 400 || !id)
      throw new ProviderError(
        'REJECTED',
        'FedaPay a refusé la création de la transaction',
        created.body,
      );
    const token = await fetchJson(`${this.base(creds)}/transactions/${id}/token`, {
      method: 'POST',
      headers: this.headers(creds),
      timeoutMs: this.timeoutMs,
    });
    const url = str(pick(token.body, ['url']));
    if (token.status >= 400 || !url)
      throw new ProviderError('REJECTED', 'FedaPay n’a pas fourni d’URL de paiement', token.body);
    return { externalId: id, checkout: { kind: 'REDIRECT', url }, raw: tx };
  }

  async verify(creds: ProviderCredentials, externalId: string): Promise<VerifyResult> {
    const res = await fetchJson(
      `${this.base(creds)}/transactions/${encodeURIComponent(externalId)}`,
      {
        headers: this.headers(creds),
        timeoutMs: this.timeoutMs,
      },
    );
    if (res.status === 404)
      return {
        status: 'NOT_FOUND',
        providerStatus: null,
        amount: null,
        fees: null,
        currency: null,
        method: null,
        attemptId: null,
        raw: res.body,
      };
    const tx = (pick(res.body, ['v1/transaction']) ?? res.body) as Record<string, unknown>;
    const providerStatus = str(tx['status']);
    return {
      status: mapFedaPayStatus(providerStatus),
      providerStatus,
      amount: num(tx['amount']),
      fees: num(tx['fees']),
      currency: str(pick(tx, ['currency', 'iso'])) ?? 'XOF',
      method: (str(tx['mode']) ?? '').toLowerCase() === 'card' ? 'CARD' : 'MOBILE_MONEY',
      attemptId: str(pick(tx, ['custom_metadata', 'attempt_id'])),
      raw: tx,
    };
  }

  parseWebhook(
    creds: ProviderCredentials,
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ): ParsedWebhook | 'INVALID_SIGNATURE' | 'UNPARSEABLE' {
    const sig = headers['x-fedapay-signature'];
    const secret = creds.webhookSecret;
    if (!sig || !secret) return 'INVALID_SIGNATURE';
    const parts = Object.fromEntries(
      sig.split(',').map((kv) => kv.trim().split('=') as [string, string]),
    );
    const t = parts['t'];
    const s = parts['s'];
    if (!t || !s) return 'INVALID_SIGNATURE';
    const expected = createHmac('sha256', secret)
      .update(`${t}.${rawBody.toString('utf8')}`)
      .digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(s, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return 'INVALID_SIGNATURE';
    if (Math.abs(Date.now() / 1000 - Number(t)) > this.toleranceSeconds) return 'INVALID_SIGNATURE';
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return 'UNPARSEABLE';
    }
    const entity = (body['entity'] ?? {}) as Record<string, unknown>;
    const externalTransactionId = str(entity['id']);
    const name = str(body['name']) ?? '';
    const hinted = name.split('.').pop() ?? null;
    // FedaPay ne fournit pas d'identifiant d'événement : clé = sha256(provider, transaction, statut, horodatage).
    const externalEventId =
      str(body['id']) ??
      createHash('sha256')
        .update(`FEDAPAY|${externalTransactionId ?? ''}|${name}|${t}`)
        .digest('hex')
        .slice(0, 40);
    return {
      externalEventId,
      externalTransactionId,
      hintStatus: hinted ? mapFedaPayStatus(hinted) : null,
      attemptId: str(pick(entity, ['custom_metadata', 'attempt_id'])),
      raw: body,
    };
  }

  async listTransactions(
    creds: ProviderCredentials,
    day: { from: Date; to: Date },
  ): Promise<ProviderTransactionSummary[]> {
    const out: ProviderTransactionSummary[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await fetchJson(
        `${this.base(creds)}/transactions?per_page=100&page=${page}&sort=created_at:desc`,
        { headers: this.headers(creds), timeoutMs: this.timeoutMs },
      );
      const list = (pick(res.body, ['v1/transactions']) ?? []) as Record<string, unknown>[];
      if (!Array.isArray(list) || list.length === 0) break;
      let older = false;
      for (const tx of list) {
        const at = str(tx['created_at']);
        const ts = at ? Date.parse(at) : NaN;
        if (Number.isNaN(ts)) continue;
        if (ts < day.from.getTime()) {
          older = true;
          continue;
        }
        if (ts >= day.to.getTime()) continue;
        const id = str(tx['id']);
        if (!id) continue;
        out.push({
          externalId: id,
          status: mapFedaPayStatus(str(tx['status'])),
          amount: num(tx['amount']) ?? 0,
          fees: num(tx['fees']),
          occurredAt: at,
          attemptId: str(pick(tx, ['custom_metadata', 'attempt_id'])),
        });
      }
      if (older) break;
    }
    return out;
  }

  async healthCheck(creds: ProviderCredentials) {
    try {
      const res = await fetchJson(`${this.base(creds)}/transactions?per_page=1`, {
        headers: this.headers(creds),
        timeoutMs: this.timeoutMs,
      });
      return res.status < 400
        ? { ok: true, detail: `Connexion FedaPay ${creds.environment} établie` }
        : { ok: false, detail: `FedaPay a répondu ${res.status}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
