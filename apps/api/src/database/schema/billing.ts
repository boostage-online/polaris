import {
  bigint,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export type InstallmentStatus =
  | 'PENDING'
  | 'DUE'
  | 'OVERDUE'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';
export type StudentFeeStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
export type PaymentMethod =
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'CHEQUE'
  | 'MOBILE_MONEY_OFFLINE'
  | 'MOBILE_MONEY'
  | 'CARD';
export type AdjustmentKind = 'DISCOUNT' | 'SCHOLARSHIP' | 'WAIVER' | 'PENALTY' | 'CORRECTION';
export interface FeeTarget {
  programIds: string[];
  levelIds: string[];
  groupIds: string[];
}

/** Montants : BIGINT lus en `number` (XOF entiers, bien en deçà de 2^53). */
const money = (name: string) => bigint(name, { mode: 'number' });

export const feeCategories = pgTable('fee_categories', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const feeStructures = pgTable('fee_structures', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  academicYearId: uuid('academic_year_id').notNull(),
  categoryId: uuid('category_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  totalAmount: money('total_amount').notNull(),
  currency: text('currency').notNull(),
  appliesTo: jsonb('applies_to').$type<FeeTarget>().notNull(),
  status: text('status').$type<'ACTIVE' | 'ARCHIVED'>().notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const feeScheduleItems = pgTable('fee_schedule_items', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  feeStructureId: uuid('fee_structure_id').notNull(),
  seq: integer('seq').notNull(),
  label: text('label').notNull(),
  amount: money('amount').notNull(),
  dueDate: date('due_date').notNull(),
});

export const feeAssignments = pgTable('fee_assignments', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  feeStructureId: uuid('fee_structure_id').notNull(),
  target: jsonb('target').$type<Record<string, unknown>>().notNull(),
  targetedCount: integer('targeted_count').notNull(),
  createdCount: integer('created_count').notNull(),
  skippedCount: integer('skipped_count').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const studentFees = pgTable('student_fees', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  studentId: uuid('student_id').notNull(),
  feeStructureId: uuid('fee_structure_id').notNull(),
  academicYearId: uuid('academic_year_id').notNull(),
  assignmentId: uuid('assignment_id'),
  totalAmount: money('total_amount').notNull(),
  adjustmentsTotal: money('adjustments_total').notNull(),
  amountAllocated: money('amount_allocated').notNull(),
  status: text('status').$type<StudentFeeStatus>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const installments = pgTable('installments', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  studentFeeId: uuid('student_fee_id').notNull(),
  studentId: uuid('student_id').notNull(),
  seq: integer('seq').notNull(),
  label: text('label').notNull(),
  amountDue: money('amount_due').notNull(),
  adjustmentsTotal: money('adjustments_total').notNull(),
  amountAllocated: money('amount_allocated').notNull(),
  dueDate: date('due_date').notNull(),
  status: text('status').$type<InstallmentStatus>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const feeAdjustments = pgTable('fee_adjustments', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  studentFeeId: uuid('student_fee_id').notNull(),
  installmentId: uuid('installment_id'),
  amount: money('amount').notNull(),
  kind: text('kind').$type<AdjustmentKind>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  studentId: uuid('student_id').notNull(),
  amount: money('amount').notNull(),
  currency: text('currency').notNull(),
  source: text('source').$type<'MANUAL' | 'ELECTRONIC'>().notNull(),
  method: text('method').$type<PaymentMethod>().notNull(),
  status: text('status').$type<'COMPLETED' | 'REVERSED'>().notNull(),
  payerName: text('payer_name'),
  payerUserId: uuid('payer_user_id'),
  valueDate: date('value_date').notNull(),
  reference: text('reference'),
  comment: text('comment'),
  attemptId: uuid('attempt_id'),
  recordedBy: uuid('recorded_by'),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  reversedBy: uuid('reversed_by'),
  reversalReason: text('reversal_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  paymentId: uuid('payment_id').notNull(),
  kind: text('kind').$type<'INTERNAL_REVERSAL' | 'PROVIDER_REFUND'>().notNull(),
  amount: money('amount').notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const paymentAllocations = pgTable('payment_allocations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  paymentId: uuid('payment_id').notNull(),
  installmentId: uuid('installment_id').notNull(),
  amount: money('amount').notNull(),
  refundId: uuid('refund_id'),
  creditId: uuid('credit_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const studentCredits = pgTable('student_credits', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  studentId: uuid('student_id').notNull(),
  paymentId: uuid('payment_id').notNull(),
  amount: money('amount').notNull(),
  remaining: money('remaining').notNull(),
  status: text('status').$type<'OPEN' | 'APPLIED' | 'REFUNDED'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const receiptSequences = pgTable(
  'receipt_sequences',
  {
    tenantId: uuid('tenant_id').notNull(),
    year: integer('year').notNull(),
    lastSeq: integer('last_seq').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year] })],
);

export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  paymentId: uuid('payment_id').notNull(),
  kind: text('kind').$type<'PAYMENT' | 'CANCELLATION'>().notNull(),
  number: text('number').notNull(),
  amount: money('amount').notNull(),
  currency: text('currency').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  verifyHash: text('verify_hash').notNull(),
  pdfKey: text('pdf_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const paymentReminders = pgTable('payment_reminders', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  installmentId: uuid('installment_id').notNull(),
  kind: text('kind').$type<'DUE_SOON' | 'OVERDUE' | 'MANUAL'>().notNull(),
  scheduledFor: date('scheduled_for').notNull(),
  sentBy: uuid('sent_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const ledgerIntegrityChecks = pgTable('ledger_integrity_checks', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
  mismatches: integer('mismatches').notNull(),
  details: jsonb('details').$type<unknown[]>().notNull(),
});
