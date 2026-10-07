-- 0007_hardening : durcissement (Phase 7). MFA TOTP (codes de récupération, session MFA), impersonation
-- Super Admin tracée, alertes de supervision plateforme, procédures RGPD (anonymisation, demandes),
-- permission MANAGE_PRIVACY. Expand only.

-- ---------------------------------------------------------------------------
-- MFA TOTP (ADR-0008) : codes de récupération hachés, session marquée « MFA vérifiée »
-- ---------------------------------------------------------------------------

CREATE TABLE mfa_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES users(id),
  code_hash   text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_codes_user_idx ON mfa_recovery_codes (user_id) WHERE used_at IS NULL;

ALTER TABLE refresh_tokens ADD COLUMN mfa_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN mfa_enrolled_at timestamptz;

-- ---------------------------------------------------------------------------
-- Impersonation Super Admin (30 min, tracée, interdite sur les actions financières)
-- ---------------------------------------------------------------------------

CREATE TABLE impersonation_sessions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  platform_user_id  uuid NOT NULL REFERENCES users(id),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  reason            text NOT NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  ip                inet,
  user_agent        text
);
CREATE INDEX impersonation_sessions_tenant_idx ON impersonation_sessions (tenant_id, started_at DESC);
CREATE INDEX impersonation_sessions_user_idx ON impersonation_sessions (platform_user_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- Alertes de supervision (plateforme, hors tenant) : une ligne par alerte ouverte, dédoublonnée par clé
-- ---------------------------------------------------------------------------

CREATE TABLE platform_alerts (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  key              text NOT NULL,                       -- ex. dlq:payments, outbox:lag, tenant:<id>:stale-reports
  severity         text NOT NULL CHECK (severity IN ('WARNING','CRITICAL')),
  title            text NOT NULL,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  tenant_id        uuid REFERENCES tenants(id),
  opened_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  notified_at      timestamptz,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX platform_alerts_open_key ON platform_alerts (key) WHERE resolved_at IS NULL;
CREATE INDEX platform_alerts_opened_idx ON platform_alerts (opened_at DESC);

-- ---------------------------------------------------------------------------
-- Données personnelles : anonymisation et registre des demandes (export, effacement)
-- ---------------------------------------------------------------------------

ALTER TABLE students  ADD COLUMN anonymized_at timestamptz;
ALTER TABLE guardians ADD COLUMN anonymized_at timestamptz;
ALTER TABLE users     ADD COLUMN anonymized_at timestamptz;

CREATE TABLE privacy_requests (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  kind          text NOT NULL CHECK (kind IN ('EXPORT','ERASURE')),
  subject_type  text NOT NULL CHECK (subject_type IN ('STUDENT','GUARDIAN')),
  subject_id    uuid NOT NULL,
  requested_by  uuid REFERENCES users(id),
  reason        text,
  source        text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','RETENTION','SELF_SERVICE')),
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX privacy_requests_subject_idx ON privacy_requests (tenant_id, subject_type, subject_id);
CREATE INDEX privacy_requests_time_idx ON privacy_requests (tenant_id, created_at DESC);

DO $$
BEGIN
  ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
  ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
  CREATE POLICY privacy_requests_tenant_isolation ON privacy_requests
    USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
END $$;

-- ---------------------------------------------------------------------------
-- Permission MANAGE_PRIVACY (export et anonymisation) : catalogue + rôle Administrateur de chaque tenant
-- ---------------------------------------------------------------------------

INSERT INTO permissions (code, module, description, sensitive)
VALUES ('MANAGE_PRIVACY', 'students-guardians', 'Exporter ou anonymiser les données personnelles (RGPD)', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'MANAGE_PRIVACY' FROM roles r
WHERE r.system_code = 'ADMIN' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
