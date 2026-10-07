-- contract : rollback (développement et CI uniquement).
DELETE FROM role_permissions WHERE permission_code = 'MANAGE_PRIVACY';
DELETE FROM permissions WHERE code = 'MANAGE_PRIVACY';
DROP TABLE IF EXISTS privacy_requests, platform_alerts, impersonation_sessions, mfa_recovery_codes CASCADE;
ALTER TABLE users DROP COLUMN IF EXISTS anonymized_at, DROP COLUMN IF EXISTS mfa_enrolled_at;
ALTER TABLE guardians DROP COLUMN IF EXISTS anonymized_at;
ALTER TABLE students DROP COLUMN IF EXISTS anonymized_at;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS mfa_verified;
