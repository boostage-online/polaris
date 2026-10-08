-- contract : rollback complet du socle (développement et CI uniquement).
DROP TABLE IF EXISTS rls_exemptions, idempotency_keys, processed_events, outbox_events, audit_logs,
  tenant_invitations, membership_roles, role_permissions, roles, permissions, otp_codes,
  refresh_tokens, memberships, users, terms, academic_years, campuses, tenants CASCADE;
DROP FUNCTION IF EXISTS notify_outbox(), set_updated_at(), forbid_mutation(), uuid_generate_v7(), app_current_tenant();
