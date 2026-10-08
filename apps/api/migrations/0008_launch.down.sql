-- contract : rollback (développement et CI uniquement).
DELETE FROM rls_exemptions WHERE table_name IN ('platform_daily_reviews', 'availability_checks');
DELETE FROM role_permissions WHERE permission_code = 'RESET_USER_MFA';
DELETE FROM permissions WHERE code = 'RESET_USER_MFA';
DROP TABLE IF EXISTS tenant_usage_monthly, availability_checks, platform_daily_reviews CASCADE;
ALTER TABLE tenants
  DROP COLUMN IF EXISTS launch_checklist,
  DROP COLUMN IF EXISTS hypercare_until,
  DROP COLUMN IF EXISTS live_at,
  DROP COLUMN IF EXISTS plan;
