/**
 * Règles pures des tentatives de paiement : machine d'états, mappings de statuts provider, calendrier de
 * réconciliation. Testées unitairement ; aucune dépendance d'infrastructure.
 */
import type { NormalizedStatus } from './provider';

export type AttemptStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN';

export const TERMINAL: ReadonlySet<AttemptStatus> = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);
export const isTerminal = (s: AttemptStatus) => TERMINAL.has(s);

/** Durée de vie d'une tentative (le parent a 30 min pour payer) et fenêtre de réconciliation après expiration. */
export const ATTEMPT_TTL_MINUTES = 30;
export const RECONCILE_GRACE_HOURS = 24;

export interface PaymentRules {
  /** Montant minimal d'un paiement en ligne (frais fixes des providers). */
  minAmount: number;
  /** Autoriser un paiement supérieur au solde (le surplus devient crédit). */
  allowOverpayment: boolean;
}
export const DEFAULT_PAYMENT_RULES: PaymentRules = { minAmount: 100, allowOverpayment: false };
export function paymentRulesFrom(
  settings: Record<string, unknown> | null | undefined,
): PaymentRules {
  const p = (settings?.['payments'] ?? {}) as Partial<PaymentRules>;
  const defined = Object.fromEntries(
    Object.entries(p).filter(([, v]) => v !== undefined),
  ) as Partial<PaymentRules>;
  return { ...DEFAULT_PAYMENT_RULES, ...defined };
}

/** Validation du montant demandé : `min ≤ montant ≤ solde` (ou crédit autorisé). */
export function validateAmount(
  amount: number,
  balance: number,
  rules: PaymentRules,
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'Montant invalide' };
  if (amount < rules.minAmount)
    return {
      ok: false,
      reason: `Montant minimal : ${rules.minAmount.toLocaleString('fr-FR')} FCFA`,
    };
  if (balance <= 0) return { ok: false, reason: 'Aucun solde à régler' };
  if (amount > balance && !rules.allowOverpayment)
    return {
      ok: false,
      reason: `Le montant dépasse le solde (${balance.toLocaleString('fr-FR')} FCFA)`,
    };
  return { ok: true };
}

/**
 * Transition d'une tentative à partir d'un résultat `verify`. Retourne le nouveau statut ou `null` si rien
 * ne change. Un statut terminal n'est jamais quitté (idempotence des confirmations concurrentes).
 */
export function nextStatus(
  current: AttemptStatus,
  verified: NormalizedStatus,
  now: Date,
  expiresAt: Date,
): AttemptStatus | null {
  if (isTerminal(current)) return null;
  switch (verified) {
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'PENDING':
      return current === 'PROCESSING' ? null : 'PROCESSING';
    case 'NOT_FOUND':
      // Pas encore visible chez le provider : on attend jusqu'à expiration + grâce.
      return now.getTime() > expiresAt.getTime() + RECONCILE_GRACE_HOURS * 3_600_000
        ? 'EXPIRED'
        : null;
    case 'UNKNOWN':
      return 'UNKNOWN';
  }
}

/** Backoff de la réconciliation : 2, 5, 10, 20, 40 min puis toutes les heures. */
export function nextCheckDelayMs(checkCount: number): number {
  const steps = [2, 5, 10, 20, 40];
  return (
    (steps[Math.min(checkCount, steps.length - 1)] ?? 60) *
    60_000 *
    (checkCount >= steps.length ? 1.5 : 1)
  );
}

/** Statut FedaPay → statut interne (table Partie 10 ; inconnu → UNKNOWN, jamais d'exception silencieuse). */
export function mapFedaPayStatus(status: string | null | undefined): NormalizedStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'pending':
      return 'PENDING';
    case 'approved':
    case 'transferred':
      return 'SUCCEEDED';
    case 'declined':
      return 'FAILED';
    case 'canceled':
    case 'cancelled':
      return 'CANCELLED';
    case 'expired':
      return 'EXPIRED';
    case 'refunded':
      // Un remboursement provider n'efface pas le paiement : SUCCEEDED + Refund (V1).
      return 'SUCCEEDED';
    default:
      return 'UNKNOWN';
  }
}

/** Statut KKiaPay → statut interne. */
export function mapKKiaPayStatus(status: string | null | undefined): NormalizedStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    case 'PENDING':
      return 'PENDING';
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    default:
      return 'UNKNOWN';
  }
}

/** Code d'échec lisible par le parent (jamais le corps provider brut). */
export const FAILURE_MESSAGES: Record<string, string> = {
  PROVIDER_UNAVAILABLE:
    'Le service de paiement est momentanément indisponible. Réessayez dans quelques minutes.',
  DECLINED: 'Le paiement a été refusé (solde insuffisant ou opération annulée).',
  CANCELLED: 'Vous avez annulé le paiement.',
  EXPIRED: 'Le délai de paiement est dépassé. Vous pouvez relancer un paiement.',
  AMOUNT_MISMATCH:
    'Le montant confirmé par le provider diffère du montant demandé : vérification en cours.',
};
