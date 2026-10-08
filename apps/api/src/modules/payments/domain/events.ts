import type { DomainEvent } from '../../shared';

/** Événements du module Payments (les succès passent par `PaymentRecorded` du module Billing). */
export const PaymentEvents = {
  PaymentAttemptFailed: 'PaymentAttemptFailed',
  PaymentReviewNeeded: 'PaymentReviewNeeded',
  PaymentProviderConfigured: 'PaymentProviderConfigured',
} as const;

export const paymentAttemptFailed = (p: {
  tenantId: string;
  attemptId: string;
  studentId: string;
  payerUserId: string | null;
  amount: number;
  status: 'FAILED' | 'CANCELLED' | 'EXPIRED';
  failureCode: string | null;
}): DomainEvent => ({
  type: PaymentEvents.PaymentAttemptFailed,
  aggregateType: 'PaymentAttempt',
  aggregateId: p.attemptId,
  tenantId: p.tenantId,
  payload: p,
});

export const paymentReviewNeeded = (p: {
  tenantId: string;
  attemptId: string | null;
  reason: 'UNKNOWN_STATUS' | 'AMOUNT_MISMATCH' | 'ORPHAN_TRANSACTION' | 'PROVIDER_MUTE';
  amount: number | null;
  externalId: string | null;
}): DomainEvent => ({
  type: PaymentEvents.PaymentReviewNeeded,
  aggregateType: 'PaymentAttempt',
  aggregateId: p.attemptId ?? undefined,
  tenantId: p.tenantId,
  payload: p,
});

export const paymentProviderConfigured = (p: {
  tenantId: string;
  provider: string;
  environment: string;
  status: string;
}): DomainEvent => ({
  type: PaymentEvents.PaymentProviderConfigured,
  aggregateType: 'TenantPaymentConfig',
  tenantId: p.tenantId,
  payload: p,
});
