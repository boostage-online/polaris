import { z } from 'zod';
import { CursorQuerySchema, UuidSchema } from './common';
import { PaymentSchema } from './billing';

/** Paiements électroniques (ADR-0005 Partie 10, ADR-0010). */

const Amount = z.number().int().min(0).max(1_000_000_000_000);

export const PaymentProviderCodeSchema = z.enum(['FEDAPAY', 'KKIAPAY', 'FAKE']);
export const AttemptStatusSchema = z.enum([
  'CREATED',
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'UNKNOWN',
]);
export const CheckoutSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('REDIRECT'), url: z.string().url() }),
  z.object({
    kind: z.literal('WIDGET'),
    publicKey: z.string(),
    sandbox: z.boolean(),
    data: z.string(),
    amount: Amount,
  }),
]);

// --- Configuration du compte marchand (Option A) ---
export const PaymentConfigSchema = z.object({
  id: UuidSchema,
  provider: PaymentProviderCodeSchema,
  mode: z.enum(['OWN_ACCOUNT', 'PLATFORM_ACCOUNT']),
  environment: z.enum(['SANDBOX', 'LIVE']),
  publicKey: z.string().nullable(),
  /** Clés secrètes masquées (4 derniers caractères) : jamais la valeur complète. */
  credentialsMasked: z.record(z.string(), z.string()),
  webhookSecretSet: z.boolean(),
  webhookUrl: z.string(),
  status: z.enum(['PENDING_TEST', 'ACTIVE', 'DISABLED']),
  lastTestAt: z.string().datetime().nullable(),
  lastTestResult: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export const UpsertPaymentConfigSchema = z.object({
  provider: PaymentProviderCodeSchema,
  environment: z.enum(['SANDBOX', 'LIVE']).default('SANDBOX'),
  /** FedaPay : { secretKey } ; KKiaPay : { privateKey, secret } ; Fake : {} . */
  publicKey: z.string().max(200).nullable().optional(),
  credentials: z.record(z.string(), z.string().max(500)).default({}),
  webhookSecret: z.string().max(500).nullable().optional(),
});

// --- Tentatives ---
export const CreatePaymentAttemptSchema = z.object({
  amount: Amount.min(1),
  /** Échéances ciblées (ordre d'imputation) ; sinon les plus anciennes d'abord. */
  installmentIds: z.array(UuidSchema).max(50).default([]),
  /** Numéro de téléphone proposé au provider (Mobile Money). */
  payerPhone: z.string().max(20).optional(),
});
export const ConfirmPaymentAttemptSchema = z.object({
  /** Identifiant de transaction renvoyé par le widget / la redirection (KKiaPay). */
  externalId: z.string().max(120).optional(),
});
export const PaymentAttemptSchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  student: z
    .object({ firstName: z.string(), lastName: z.string(), matricule: z.string() })
    .optional(),
  amount: Amount,
  currency: z.string(),
  provider: PaymentProviderCodeSchema,
  status: AttemptStatusSchema,
  checkout: CheckoutSchema.nullable(),
  externalId: z.string().nullable(),
  expiresAt: z.string().datetime(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  verifiedAmount: Amount.nullable(),
  fees: Amount.nullable(),
  paymentId: UuidSchema.nullable(),
  receiptNumber: z.string().nullable().optional(),
  reviewStatus: z.enum(['NONE', 'OPEN', 'RESOLVED']),
  reviewNote: z.string().nullable(),
  payerName: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export const AttemptTimelineSchema = z.object({
  attempt: PaymentAttemptSchema,
  providerTransaction: z
    .object({
      externalId: z.string(),
      providerStatus: z.string().nullable(),
      normalizedStatus: z.string(),
      amount: Amount.nullable(),
      fees: Amount.nullable(),
      verifyCount: z.number().int(),
      lastVerifiedAt: z.string().datetime().nullable(),
    })
    .nullable(),
  webhooks: z.array(
    z.object({
      id: UuidSchema,
      receivedAt: z.string().datetime(),
      externalEventId: z.string(),
      hintStatus: z.string().nullable(),
      signatureValid: z.boolean(),
      processedAt: z.string().datetime().nullable(),
      processingError: z.string().nullable(),
    }),
  ),
  payment: PaymentSchema.nullable(),
  audit: z.array(
    z.object({ at: z.string().datetime(), action: z.string(), by: z.string().nullable() }),
  ),
});
export const AttemptsQuerySchema = CursorQuerySchema.extend({
  status: AttemptStatusSchema.optional(),
  studentId: UuidSchema.optional(),
  review: z.enum(['OPEN', 'RESOLVED']).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export const ResolveAttemptSchema = z.object({ note: z.string().min(3).max(500) });

// --- Réconciliation ---
export const ReconciliationRunSchema = z.object({
  id: UuidSchema,
  provider: PaymentProviderCodeSchema,
  day: z.string(),
  status: z.enum(['OK', 'DISCREPANCIES', 'UNSUPPORTED', 'ERROR']),
  checked: z.number().int(),
  matched: z.number().int(),
  orphans: z.array(
    z.object({
      externalId: z.string(),
      amount: Amount,
      occurredAt: z.string().nullable(),
      resolved: z.boolean(),
      note: z.string().optional(),
    }),
  ),
  mismatches: z.array(
    z.object({
      externalId: z.string(),
      attemptId: UuidSchema,
      expected: Amount,
      actual: Amount,
    }),
  ),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export const ResolveOrphanSchema = z.object({
  externalId: z.string().min(1).max(120),
  note: z.string().min(3).max(500),
});

/** Écran « transactions en attente » : ce qui demande un humain. */
export const PendingPaymentsSchema = z.object({
  unknown: z.array(PaymentAttemptSchema),
  stalePending: z.array(PaymentAttemptSchema),
  orphans: z.array(
    ReconciliationRunSchema.shape.orphans.element.extend({ runId: UuidSchema, day: z.string() }),
  ),
  counts: z.object({
    unknown: z.number().int(),
    stalePending: z.number().int(),
    orphans: z.number().int(),
  }),
  lastReconciliation: ReconciliationRunSchema.nullable(),
  providerHealth: z
    .object({
      provider: PaymentProviderCodeSchema,
      circuitOpen: z.boolean(),
      failuresLastMinute: z.number().int(),
    })
    .nullable(),
});

/** Ce que l'espace parent doit savoir pour proposer « Payer ». */
export const PaymentOptionsSchema = z.object({
  enabled: z.boolean(),
  provider: PaymentProviderCodeSchema.nullable(),
  environment: z.enum(['SANDBOX', 'LIVE']).nullable(),
  minAmount: Amount,
  maxAmount: Amount,
  reason: z.string().nullable(),
});

export type PaymentProviderCode = z.infer<typeof PaymentProviderCodeSchema>;
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>;
export type Checkout = z.infer<typeof CheckoutSchema>;
export type PaymentConfig = z.infer<typeof PaymentConfigSchema>;
export type UpsertPaymentConfigInput = z.input<typeof UpsertPaymentConfigSchema>;
export type PaymentAttempt = z.infer<typeof PaymentAttemptSchema>;
export type AttemptTimeline = z.infer<typeof AttemptTimelineSchema>;
export type ReconciliationRun = z.infer<typeof ReconciliationRunSchema>;
export type PendingPayments = z.infer<typeof PendingPaymentsSchema>;
export type PaymentOptions = z.infer<typeof PaymentOptionsSchema>;
export type CreatePaymentAttemptInput = z.input<typeof CreatePaymentAttemptSchema>;
