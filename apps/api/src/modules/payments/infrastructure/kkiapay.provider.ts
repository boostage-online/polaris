import { createHash, timingSafeEqual } from 'node:crypto';
import { mapKKiaPayStatus } from '../domain/attempts';
import {
  ProviderError,
  type InitiateInput,
  type InitiateResult,
  type ParsedWebhook,
  type PaymentProvider,
  type ProviderCredentials,
  type VerifyResult,
} from '../domain/provider';
import { fetchJson, num, pick, str } from './http';

/**
 * Adaptateur KKiaPay : le widget s'ouvre côté client avec la clé publique et notre `attempt_id` en donnée
 * externe ; le serveur n'apprend l'identifiant de transaction qu'au retour (callback ou webhook). Le webhook
 * porte un secret statique (`x-kkiapay-secret`) qui ne prouve pas l'intégrité du corps : `parseWebhook`
 * extrait l'identifiant, `verify` (API de statut, trois clés) fait foi. Champs à confirmer en sandbox.
 */
export class KKiaPayProvider implements PaymentProvider {
  readonly code = 'KKIAPAY' as const;
  constructor(
    private readonly bases: { SANDBOX: string; LIVE: string },
    private readonly timeoutMs: number,
  ) {}

  capabilities() {
    return {
      serverInitiated: false,
      clientWidget: true,
      refunds: false,
      payouts: false,
      listTransactions: false,
    };
  }

  private headers(creds: ProviderCredentials) {
    const publicKey = creds.publicKey;
    const privateKey = creds.secrets['privateKey'];
    const secret = creds.secrets['secret'];
    if (!publicKey || !privateKey || !secret)
      throw new ProviderError('AUTH', 'Clés KKiaPay incomplètes (publique, privée, secret)');
    return { 'x-api-key': publicKey, 'x-private-key': privateKey, 'x-secret-key': secret };
  }

  async initiate(creds: ProviderCredentials, input: InitiateInput): Promise<InitiateResult> {
    if (!creds.publicKey) throw new ProviderError('AUTH', 'Clé publique KKiaPay absente');
    return {
      externalId: null,
      checkout: {
        kind: 'WIDGET',
        publicKey: creds.publicKey,
        sandbox: creds.environment === 'SANDBOX',
        data: input.attemptId,
        amount: input.amount,
      },
    };
  }

  async verify(creds: ProviderCredentials, externalId: string): Promise<VerifyResult> {
    const res = await fetchJson(`${this.bases[creds.environment]}/transactions/status`, {
      method: 'POST',
      headers: this.headers(creds),
      timeoutMs: this.timeoutMs,
      body: { transactionId: externalId },
    });
    const body = (res.body ?? {}) as Record<string, unknown>;
    if (res.status === 404)
      return {
        status: 'NOT_FOUND',
        providerStatus: null,
        amount: null,
        fees: null,
        currency: null,
        method: null,
        attemptId: null,
        raw: body,
      };
    const providerStatus = str(body['status']);
    const source = String(body['source'] ?? body['paymentMethod'] ?? '').toLowerCase();
    return {
      status: mapKKiaPayStatus(providerStatus),
      providerStatus,
      amount: num(body['amount']),
      fees: num(body['fees']),
      currency: 'XOF',
      method: source.includes('card') ? 'CARD' : 'MOBILE_MONEY',
      attemptId: str(body['stateData'] ?? body['data'] ?? pick(body, ['state', 'data'])),
      raw: body,
    };
  }

  parseWebhook(
    creds: ProviderCredentials,
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ): ParsedWebhook | 'INVALID_SIGNATURE' | 'UNPARSEABLE' {
    const given = headers['x-kkiapay-secret'];
    const secret = creds.webhookSecret;
    if (!given || !secret) return 'INVALID_SIGNATURE';
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return 'INVALID_SIGNATURE';
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return 'UNPARSEABLE';
    }
    const externalTransactionId = str(body['transactionId']);
    const event =
      str(body['event']) ?? (body['isPaymentSucces'] === true ? 'transaction.success' : '');
    const ts = str(body['timestamp']) ?? '';
    return {
      externalEventId:
        str(body['eventId']) ??
        createHash('sha256')
          .update(`KKIAPAY|${externalTransactionId ?? ''}|${event}|${ts}`)
          .digest('hex')
          .slice(0, 40),
      externalTransactionId,
      hintStatus: event.endsWith('success')
        ? 'SUCCEEDED'
        : event.endsWith('failed')
          ? 'FAILED'
          : null,
      attemptId: str(body['stateData'] ?? body['data']),
      raw: body,
    };
  }

  async healthCheck(creds: ProviderCredentials) {
    try {
      // Une vérification sur un identifiant inexistant valide les clés sans créer de transaction.
      const res = await fetchJson(`${this.bases[creds.environment]}/transactions/status`, {
        method: 'POST',
        headers: this.headers(creds),
        timeoutMs: this.timeoutMs,
        body: { transactionId: 'polaris-healthcheck' },
      });
      return res.status < 500
        ? { ok: true, detail: `Connexion KKiaPay ${creds.environment} établie` }
        : { ok: false, detail: `KKiaPay a répondu ${res.status}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
