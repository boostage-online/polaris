-- contract : rollback (développement et CI uniquement).
DROP TABLE IF EXISTS ledger_integrity_checks, payment_reminders, receipts, receipt_sequences, student_credits, payment_allocations,
  refunds, payments, fee_adjustments, installments, student_fees, fee_assignments, fee_schedule_items, fee_structures, fee_categories CASCADE;
DROP FUNCTION IF EXISTS payments_guard();
