import type { DomainEvent } from '../../shared';

/** Événements financiers (ADR-0003/0005) consommés par le moteur de notifications. */
export const BillingEvents = {
  FeesAssigned: 'FeesAssigned',
  PaymentRecorded: 'PaymentRecorded',
  PaymentReversed: 'PaymentReversed',
  OverpaymentRecorded: 'OverpaymentRecorded',
  InstallmentsDueSoon: 'InstallmentsDueSoon',
  InstallmentsOverdue: 'InstallmentsOverdue',
  LedgerIntegrityMismatch: 'LedgerIntegrityMismatch',
} as const;

export interface ReminderItem {
  studentId: string;
  installmentId: string;
  feeName: string;
  label: string;
  amount: number;
  dueDate: string;
}

export const feesAssigned = (p: {
  tenantId: string;
  assignmentId: string;
  feeStructureId: string;
  created: number;
}): DomainEvent => ({
  type: BillingEvents.FeesAssigned,
  aggregateType: 'FeeAssignment',
  aggregateId: p.assignmentId,
  tenantId: p.tenantId,
  payload: p,
});
export const paymentRecorded = (p: {
  tenantId: string;
  paymentId: string;
  studentId: string;
  amount: number;
  currency: string;
  method: string;
  receiptNumber: string;
  allocated: number;
  credit: number;
}): DomainEvent => ({
  type: BillingEvents.PaymentRecorded,
  aggregateType: 'Payment',
  aggregateId: p.paymentId,
  tenantId: p.tenantId,
  payload: p,
});
export const paymentReversed = (p: {
  tenantId: string;
  paymentId: string;
  studentId: string;
  amount: number;
  reason: string;
  receiptNumber: string;
}): DomainEvent => ({
  type: BillingEvents.PaymentReversed,
  aggregateType: 'Payment',
  aggregateId: p.paymentId,
  tenantId: p.tenantId,
  payload: p,
});
export const overpaymentRecorded = (p: {
  tenantId: string;
  creditId: string;
  paymentId: string;
  studentId: string;
  amount: number;
}): DomainEvent => ({
  type: BillingEvents.OverpaymentRecorded,
  aggregateType: 'StudentCredit',
  aggregateId: p.creditId,
  tenantId: p.tenantId,
  payload: p,
});
export const installmentsReminder = (
  kind: 'DUE_SOON' | 'OVERDUE',
  p: { tenantId: string; date: string; items: ReminderItem[]; manual?: boolean; message?: string },
): DomainEvent => ({
  type: kind === 'DUE_SOON' ? BillingEvents.InstallmentsDueSoon : BillingEvents.InstallmentsOverdue,
  aggregateType: 'PaymentReminder',
  aggregateId: `${p.date}:${kind}${p.manual ? ':manual' : ''}`,
  tenantId: p.tenantId,
  payload: p,
});
export const ledgerIntegrityMismatch = (p: {
  tenantId: string;
  checkId: string;
  mismatches: number;
}): DomainEvent => ({
  type: BillingEvents.LedgerIntegrityMismatch,
  aggregateType: 'LedgerIntegrityCheck',
  aggregateId: p.checkId,
  tenantId: p.tenantId,
  payload: p,
});
