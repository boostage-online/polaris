/**
 * Port `PaymentProvider` (Partie 10). Trois verbes : créer (initiate), vérifier (verify — la seule source
 * de vérité) et authentifier un webhook (parseWebhook — un signal, jamais une décision).
 * Aucune dépendance NestJS/HTTP ici : les adaptateurs vivent dans infrastructure/.
 */
export type ProviderCode = 'FEDAPAY' | 'KKIAPAY' | 'FAKE';

/** Statut interne normalisé d'une transaction provider. */
export type NormalizedStatus =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export interface ProviderCredentials {
  /** Clé publique (widget, identification) — non secrète. */
  publicKey?: string | null;
  /** Clés secrètes propres au provider (FedaPay : secretKey ; KKiaPay : privateKey, secret). */
  secrets: Record<string, string>;
  webhookSecret?: string | null;
  environment: 'SANDBOX' | 'LIVE';
}

export interface InitiateInput {
  attemptId: string;
  amount: number;
  currency: string;
  description: string;
  customer: { firstName: string; lastName: string; email?: string | null; phone?: string | null };
  /** Où renvoyer le parent après le provider. */
  callbackUrl: string;
  /** Où le provider doit poster ses webhooks (information ; configurée aussi côté provider). */
  webhookUrl: string;
}

export type Checkout =
  | { kind: 'REDIRECT'; url: string }
  | { kind: 'WIDGET'; publicKey: string; sandbox: boolean; data: string; amount: number };

export interface InitiateResult {
  /** Identifiant provider si déjà connu (FedaPay) ; absent pour un widget (KKiaPay). */
  externalId: string | null;
  checkout: Checkout;
  raw?: unknown;
}

export interface VerifyResult {
  status: NormalizedStatus;
  providerStatus: string | null;
  amount: number | null;
  fees: number | null;
  currency: string | null;
  /** Moyen effectif : MOBILE_MONEY | CARD (normalisé). */
  method: 'MOBILE_MONEY' | 'CARD' | null;
  /** Notre attempt_id si le provider le renvoie (métadonnée). */
  attemptId: string | null;
  raw: unknown;
}

export interface ParsedWebhook {
  externalEventId: string;
  externalTransactionId: string | null;
  /** Statut annoncé par le provider : indice seulement, `verify` fait foi. */
  hintStatus: NormalizedStatus | null;
  /** Notre attempt_id si transmis en donnée externe. */
  attemptId: string | null;
  raw: unknown;
}

export interface ProviderTransactionSummary {
  externalId: string;
  status: NormalizedStatus;
  amount: number;
  fees: number | null;
  occurredAt: string | null;
  attemptId: string | null;
}

export class ProviderError extends Error {
  constructor(
    readonly kind: 'UNAVAILABLE' | 'TIMEOUT' | 'REJECTED' | 'AUTH',
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export interface PaymentProvider {
  readonly code: ProviderCode;
  capabilities(): {
    serverInitiated: boolean;
    clientWidget: boolean;
    refunds: boolean;
    payouts: boolean;
    listTransactions: boolean;
  };
  initiate(creds: ProviderCredentials, input: InitiateInput): Promise<InitiateResult>;
  verify(creds: ProviderCredentials, externalId: string): Promise<VerifyResult>;
  parseWebhook(
    creds: ProviderCredentials,
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ): ParsedWebhook | 'INVALID_SIGNATURE' | 'UNPARSEABLE';
  /** Transactions côté provider pour une journée (réconciliation quotidienne) ; absent si non supporté. */
  listTransactions?(
    creds: ProviderCredentials,
    day: { from: Date; to: Date },
  ): Promise<ProviderTransactionSummary[]>;
  /** Transaction de test (onboarding) : doit réussir avec les clés fournies. */
  healthCheck(creds: ProviderCredentials): Promise<{ ok: boolean; detail: string }>;
}

/** Libellé de la mention portée sur le reçu (ADR-0010, Option A). */
export const PROVIDER_LABELS: Record<ProviderCode, string> = {
  FEDAPAY: 'FedaPay',
  KKIAPAY: 'KKiaPay',
  FAKE: 'Provider de démonstration',
};
