-- 0008_launch : lancement production et hypercare (Phase 8). Mise en production d'un établissement (offre,
-- date de bascule, fin d'hypercare, checklist humaine), revues quotidiennes de la plateforme, disponibilité
-- mesurée, consommation mensuelle par établissement, permission RESET_USER_MFA. Expand only.

-- ---------------------------------------------------------------------------
-- Établissements : offre et mise en production
-- ---------------------------------------------------------------------------

ALTER TABLE tenants
  ADD COLUMN plan             text NOT NULL DEFAULT 'PILOT' CHECK (plan IN ('PILOT','STANDARD','PREMIUM')),
  ADD COLUMN live_at          timestamptz,
  ADD COLUMN hypercare_until  timestamptz,
  ADD COLUMN launch_checklist jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Revue quotidienne (hypercare) : une ligne par jour, générée à 07:00 par le worker, acquittée par un humain
-- ---------------------------------------------------------------------------

CREATE TABLE platform_daily_reviews (
  day           date PRIMARY KEY,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,
  tenants       jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES users(id),
  notes         text
);

-- ---------------------------------------------------------------------------
-- Disponibilité mesurée : une sonde par minute (worker → /health/ready), conservée 90 jours
-- ---------------------------------------------------------------------------

CREATE TABLE availability_checks (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  checked_at  timestamptz NOT NULL DEFAULT now(),
  ok          boolean NOT NULL,
  latency_ms  integer NOT NULL,
  detail      text
);
CREATE INDEX availability_checks_time_idx ON availability_checks (checked_at DESC);

INSERT INTO rls_exemptions VALUES
  ('platform_daily_reviews', 'Plateforme : revue quotidienne inter-tenant (hypercare), écrite par le worker'),
  ('availability_checks', 'Plateforme : sondes de disponibilité, aucune donnée tenant')
ON CONFLICT (table_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Consommation mensuelle par établissement (mesure, pas facturation) : table tenant sous RLS forcée
-- ---------------------------------------------------------------------------

CREATE TABLE tenant_usage_monthly (
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  month                date NOT NULL,                    -- premier jour du mois
  active_students      integer NOT NULL DEFAULT 0,
  guardians            integer NOT NULL DEFAULT 0,
  guardians_activated  integer NOT NULL DEFAULT 0,
  staff_active         integer NOT NULL DEFAULT 0,
  sheets_submitted     integer NOT NULL DEFAULT 0,
  sms_sent             integer NOT NULL DEFAULT 0,
  emails_sent          integer NOT NULL DEFAULT 0,
  online_payments      integer NOT NULL DEFAULT 0,
  online_amount        bigint  NOT NULL DEFAULT 0,
  manual_payments      integer NOT NULL DEFAULT 0,
  manual_amount        bigint  NOT NULL DEFAULT 0,
  computed_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, month)
);

DO $$
BEGIN
  ALTER TABLE tenant_usage_monthly ENABLE ROW LEVEL SECURITY;
  ALTER TABLE tenant_usage_monthly FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_usage_monthly_tenant_isolation ON tenant_usage_monthly
    USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
END $$;

-- ---------------------------------------------------------------------------
-- Permission RESET_USER_MFA (sensible : exige une session MFA) : catalogue + rôle Administrateur
-- ---------------------------------------------------------------------------

INSERT INTO permissions (code, module, description, sensitive)
VALUES ('RESET_USER_MFA', 'identity', 'Réinitialiser la double authentification d''un membre (identité vérifiée)', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'RESET_USER_MFA' FROM roles r
WHERE r.system_code = 'ADMIN' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
