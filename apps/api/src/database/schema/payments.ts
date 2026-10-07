import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export type PaymentProviderCode = 'FEDAPAY' | 'KKIAPAY' | 'FAKE';
export type PaymentConfigMode = 'OWN_ACCOUNT' | 'PLATFORM_ACCOUNT';
export type PaymentConfigStatus = 'PENDING_TEST' | 'ACTIVE' | 'DISABLED';
export type AttemptStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN';
export type ReviewStatus = 'NONE' | 'OPEN' | 'RESOLVED';
export type Checkout =
  | { kind: 'REDIRECT'; url: string }
  | { kind: 'WIDGET'; publicKey: string; sandbox: boolean; data: string; amount: number };

const money = (name: string) => bigint(name, { mode: 'number' });

export const tenantPaymentConfigs = pgTable('tenant_payment_configs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  provider: text('provider').$type<PaymentProviderCode>().notNull(),
  mode: text('mode').$type<PaymentConfigMode>().notNull(),
  environment: text('environment').$type<'SANDBOX' | 'LIVE'>().notNull(),
  publicKey: text('public_key'),
  credentialsEncrypted: text('credentials_encrypted').notNull(),
  webhookSecretEncrypted: text('webhook_secret_encrypted'),
  webhookToken: text('webhook_token').notNull(),
  status: text('status').$type<PaymentConfigStatus>().notNull(),
  lastTestAt: timestamp('last_test_at', { withTimezone: true }),
  lastTestResult: text('last_test_result'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  studentId: uuid('student_id').notNull(),
  guardianId: uuid('guardian_id'),
  payerUserId: uuid('payer_user_id'),
  amount: money('amount').notNull(),
  currency: text('currency').notNull(),
  targetInstallmentIds: uuid('target_installment_ids').array().notNull(),
  provider: text('provider').$type<PaymentProviderCode>().notNull(),
  status: text('status').$type<AttemptStatus>().notNull(),
  externalId: text('external_id'),
  checkout: jsonb('checkout').$type<Checkout>(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  failureCode: text('failure_code'),
  failureMessage: text('failure_message'),
  verifiedAmount: money('verified_amount'),
  fees: money('fees'),
  paymentId: uuid('payment_id'),
  reviewStatus: text('review_status').$type<ReviewStatus>().notNull(),
  reviewNote: text('review_note'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
  checkCount: integer('check_count').notNull(),
  traceId: text('trace_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const providerTransactions = pgTable('provider_transactions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  attemptId: uuid('attempt_id').notNull(),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  providerStatus: text('provider_status'),
  normalizedStatus: text('normalized_status').notNull(),
  amount: money('amount'),
  fees: money('fees'),
  method: text('method'),
  raw: jsonb('raw').$type<unknown>(),
  verifyCount: integer('verify_count').notNull(),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  provider: text('provider').notNull(),
  externalEventId: text('external_event_id').notNull(),
  externalTransactionId: text('external_transaction_id'),
  hintStatus: text('hint_status'),
  attemptId: uuid('attempt_id'),
  signatureValid: boolean('signature_valid').notNull(),
  headers: jsonb('headers').$type<Record<string, string>>().notNull(),
  body: jsonb('body').$type<unknown>(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingError: text('processing_error'),
});

export interface ReconciliationOrphan {
  externalId: string;
  amount: number;
  occurredAt: string | null;
  resolved: boolean;
  note?: string;
}
export interface ReconciliationMismatch {
  externalId: string;
  attemptId: string;
  expected: number;
  actual: number;
}

export const paymentReconciliationRuns = pgTable('payment_reconciliation_runs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  provider: text('provider').notNull(),
  day: date('day').notNull(),
  status: text('status').$type<'OK' | 'DISCREPANCIES' | 'UNSUPPORTED' | 'ERROR'>().notNull(),
  checked: integer('checked').notNull(),
  matched: integer('matched').notNull(),
  orphans: jsonb('orphans').$type<ReconciliationOrphan[]>().notNull(),
  mismatches: jsonb('mismatches').$type<ReconciliationMismatch[]>().notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
