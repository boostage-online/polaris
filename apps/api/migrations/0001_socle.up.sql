-- 0001_socle : socle multi-tenant (ADR-0002), identité (ADR-0008), RBAC (ADR-0007), audit, outbox (ADR-0003).
-- Convention : expand only. Aucun DROP/RENAME ici.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------------

-- Tenant courant, posé par l'application via SET LOCAL app.tenant_id (NULL si absent → RLS renvoie 0 ligne).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- UUID v7 (ordre temporel) — implémentation SQL portable en attendant uuidv7() natif.
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  unix_ms bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  rnd bytea := gen_random_bytes(10);
  b bytea;
BEGIN
  b := set_byte(set_byte(set_byte(set_byte(set_byte(set_byte('\x00000000000000000000000000000000'::bytea,
        0, ((unix_ms >> 40) & 255)::int), 1, ((unix_ms >> 32) & 255)::int), 2, ((unix_ms >> 24) & 255)::int),
        3, ((unix_ms >> 16) & 255)::int), 4, ((unix_ms >> 8) & 255)::int), 5, (unix_ms & 255)::int);
  b := set_byte(b, 6, (112 | (get_byte(rnd, 0) & 15)));          -- version 7
  b := set_byte(b, 7, get_byte(rnd, 1));
  b := set_byte(b, 8, (128 | (get_byte(rnd, 2) & 63)));          -- variant RFC 4122
  b := set_byte(b, 9, get_byte(rnd, 3));
  b := set_byte(b, 10, get_byte(rnd, 4));
  b := set_byte(b, 11, get_byte(rnd, 5));
  b := set_byte(b, 12, get_byte(rnd, 6));
  b := set_byte(b, 13, get_byte(rnd, 7));
  b := set_byte(b, 14, get_byte(rnd, 8));
  b := set_byte(b, 15, get_byte(rnd, 9));
  RETURN encode(b, 'hex')::uuid;
END $$;

-- Interdit UPDATE/DELETE : tables append-only (audit, finance plus tard).
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % est append-only (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Notification du relais outbox (ADR-0003).
CREATE OR REPLACE FUNCTION notify_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox', NEW.id::text);
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Tenants et référentiels de socle
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code              text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'),
  name              text NOT NULL,
  type              text NOT NULL CHECK (type IN ('SCHOOL','UNIVERSITY','TRAINING_CENTER')),
  status            text NOT NULL DEFAULT 'TRIAL' CHECK (status IN ('TRIAL','ACTIVE','SUSPENDED')),
  timezone          text NOT NULL DEFAULT 'Africa/Porto-Novo',
  country           char(2) NOT NULL DEFAULT 'BJ',
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  suspended_at      timestamptz,
  suspension_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE campuses (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  address     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER campuses_updated_at BEFORE UPDATE ON campuses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE academic_years (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  label       text NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, label),
  CHECK (end_date > start_date)
);
CREATE UNIQUE INDEX academic_years_one_current ON academic_years (tenant_id) WHERE is_current;
CREATE TRIGGER academic_years_updated_at BEFORE UPDATE ON academic_years FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE terms (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  academic_year_id  uuid NOT NULL,
  label             text NOT NULL,
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, academic_year_id, label),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years(tenant_id, id),
  CHECK (end_date > start_date)
);

-- ---------------------------------------------------------------------------
-- Identité (globale : un compte peut appartenir à plusieurs tenants)
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email                 text,
  phone_e164            text,
  password_hash         text,
  display_name          text,
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  mfa_enabled           boolean NOT NULL DEFAULT false,
  mfa_secret_encrypted  text,
  token_version         integer NOT NULL DEFAULT 0,
  locale                text NOT NULL DEFAULT 'fr',
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL),
  CHECK (email IS NULL OR email = lower(email)),
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9]\d{6,14}$')
);
CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_phone_unique ON users (phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE memberships (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id              uuid NOT NULL REFERENCES users(id),
  tenant_id            uuid REFERENCES tenants(id),           -- NULL pour kind = PLATFORM
  kind                 text NOT NULL CHECK (kind IN ('STAFF','GUARDIAN','PLATFORM')),
  status               text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING','ACTIVE','DISABLED')),
  permissions_version  integer NOT NULL DEFAULT 1,
  invited_by           uuid REFERENCES users(id),
  accepted_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (user_id, tenant_id),
  UNIQUE (tenant_id, id),
  CHECK ((kind = 'PLATFORM') = (tenant_id IS NULL))
);
CREATE INDEX memberships_tenant_idx ON memberships (tenant_id, kind);
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE refresh_tokens (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id        uuid NOT NULL REFERENCES users(id),
  membership_id  uuid REFERENCES memberships(id),
  family_id      uuid NOT NULL,
  token_hash     text NOT NULL UNIQUE,
  device_id      text,
  device_label   text,
  ip             inet,
  user_agent     text,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  replaced_by    uuid REFERENCES refresh_tokens(id)
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE otp_codes (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone_e164   text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('LOGIN','ACTIVATION')),
  code_hash    text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone_e164, created_at DESC);

-- ---------------------------------------------------------------------------
-- RBAC
-- ---------------------------------------------------------------------------

CREATE TABLE permissions (
  code         text PRIMARY KEY CHECK (code ~ '^[A-Z]+(_[A-Z]+)+$'),
  module       text NOT NULL,
  description  text NOT NULL,
  sensitive    boolean NOT NULL DEFAULT false
);

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  name         text NOT NULL,
  description  text,
  system_code  text,                                        -- ADMIN, TEACHER… pour les rôles copiés
  is_locked    boolean NOT NULL DEFAULT false,              -- true pour ADMIN : permissions non modifiables
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE UNIQUE INDEX roles_system_code_unique ON roles (tenant_id, system_code) WHERE system_code IS NOT NULL;
CREATE TRIGGER roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE role_permissions (
  tenant_id        uuid NOT NULL,
  role_id          uuid NOT NULL,
  permission_code  text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_id, permission_code),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX role_permissions_tenant_idx ON role_permissions (tenant_id, role_id);

CREATE TABLE membership_roles (
  tenant_id      uuid NOT NULL,
  membership_id  uuid NOT NULL,
  role_id        uuid NOT NULL,
  scope          jsonb,
  granted_by     uuid REFERENCES users(id),
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, role_id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX membership_roles_tenant_role_idx ON membership_roles (tenant_id, role_id);

CREATE TABLE tenant_invitations (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  email         text NOT NULL,
  display_name  text NOT NULL,
  role_ids      uuid[] NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  invited_by    uuid REFERENCES users(id),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_invitations_tenant_idx ON tenant_invitations (tenant_id, email);

-- ---------------------------------------------------------------------------
-- Audit (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid REFERENCES tenants(id),          -- NULL pour les actions plateforme
  actor_user_id        uuid,
  actor_membership_id  uuid,
  impersonated_by      uuid,
  action               text NOT NULL,
  entity_type          text NOT NULL,
  entity_id            text,
  before               jsonb,
  after                jsonb,
  metadata             jsonb,
  ip                   inet,
  user_agent           text,
  request_id           text,
  occurred_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (tenant_id, entity_type, entity_id);
CREATE INDEX audit_logs_time_idx ON audit_logs (tenant_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (tenant_id, actor_user_id, occurred_at DESC);
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Outbox, idempotence, technique
-- ---------------------------------------------------------------------------

CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid REFERENCES tenants(id),
  event_type      text NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    text,
  payload         jsonb NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (occurred_at) WHERE published_at IS NULL;
CREATE TRIGGER outbox_events_notify AFTER INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION notify_outbox();

CREATE TABLE processed_events (
  handler       text NOT NULL,
  event_id      uuid NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (handler, event_id)
);

CREATE TABLE idempotency_keys (
  scope            text NOT NULL,         -- "{tenant_id|platform}:{user_id}"
  key              text NOT NULL,
  request_hash     text NOT NULL,
  status           text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security (ADR-0002)
-- Tables scopées tenant : policy `tenant_id = app_current_tenant()`.
-- Hors RLS (identité globale ou technique) : tenants, users, memberships, membership_roles,
-- refresh_tokens, otp_codes, permissions, processed_events, idempotency_keys, schema_migrations.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campuses','academic_years','terms','roles','role_permissions','tenant_invitations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t, t);
  END LOOP;

  -- Journaux (audit, outbox) : lecture strictement scopée ; écriture autorisée aussi depuis le contexte
  -- identité (login, OTP, révocation) qui n'a pas de tenant courant. Jamais d'UPDATE/DELETE via RLS.
  FOREACH t IN ARRAY ARRAY['audit_logs','outbox_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant_read ON %I FOR SELECT USING (tenant_id = app_current_tenant())', t, t);
    EXECUTE format('CREATE POLICY %I_tenant_write ON %I FOR INSERT WITH CHECK (tenant_id = app_current_tenant() OR app_current_tenant() IS NULL)', t, t);
  END LOOP;
END $$;

-- Liste blanche des tables portant tenant_id sans policy (vérifiée par un test CI).
CREATE TABLE rls_exemptions (
  table_name text PRIMARY KEY,
  reason     text NOT NULL
);
INSERT INTO rls_exemptions VALUES
  ('memberships', 'Identité globale : un utilisateur liste ses appartenances avant tout contexte tenant'),
  ('membership_roles', 'Lu avec memberships au login ; protégé par FK composites et policies applicatives');

-- ---------------------------------------------------------------------------
-- Droits des rôles de connexion
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'polaris_app') THEN
    GRANT USAGE ON SCHEMA public TO polaris_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO polaris_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO polaris_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO polaris_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO polaris_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'polaris_platform') THEN
    GRANT USAGE ON SCHEMA public TO polaris_platform;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO polaris_platform;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO polaris_platform;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO polaris_platform;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO polaris_platform;
  END IF;
END $$;
