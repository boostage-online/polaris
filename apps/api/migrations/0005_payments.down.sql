-- contract : rollback (développement et CI uniquement).
DROP TABLE IF EXISTS payment_reconciliation_runs, webhook_events, provider_transactions, payment_attempts, tenant_payment_configs CASCADE;
