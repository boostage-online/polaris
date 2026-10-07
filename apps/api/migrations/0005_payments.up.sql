-- 0005_payments : paiements électroniques (ADR-0005 Partie 10, ADR-0010 Option A) — configuration provider
-- par établissement (secrets chiffrés par enveloppe), tentatives de paiement, transactions provider,
-- événements webhook, réconciliations. Expand only.
--
-- Règle d'or : un webhook n'est qu'un signal ; la vérité vient de `verify()` ; un paiement n'est créé que par
-- ce chemin, protégé par UNIQUE(attempt_id) sur payments et UNIQUE(provider, external_id) ici.

-- ---------------------------------------------------------------------------
-- Comptes marchands par établissement (Option A ; `mode` prêt pour l'Option C)
-- ---------------------------------------------------------------------------

CREATE TABLE tenant_payment_configs (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  provider                  text NOT NULL CHECK (provider IN ('FEDAPAY','KKIAPAY','FAKE')),
  mode                      text NOT NULL DEFAULT 'OWN_ACCOUNT' CHECK (mode IN ('OWN_ACCOUNT','PLATFORM_ACCOUNT')),
  environment               text NOT NULL DEFAULT 'SANDBOX' CHECK (environment IN ('SANDBOX','LIVE')),
  -- Clé publique (widget / identification) : non secrète, affichable.
  public_key                text,
  -- Enveloppe JSON {v, kid, wrappedKey, iv, tag, data} : clés secrètes du provider, déchiffrées uniquement dans le module Payments.
  credentials_encrypted     text NOT NULL,
  webhook_secret_encrypted  text,
  -- Jeton aléatoire de l'URL de webhook : /webhooks/payments/{provider}/{token}.
  webhook_token             text NOT NULL UNIQUE,
  status                    text NOT NULL DEFAULT 'PENDING_TEST' CHECK (status IN ('PENDING_TEST','ACTIVE','DISABLED')),
  last_test_at              timestamptz,
  last_test_result          text,
  created_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider)
);
CREATE TRIGGER tenant_payment_configs_updated_at BEFORE UPDATE ON tenant_payment_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Tentatives : une par essai du parent ; jamais réutilisée ; ≠ paiement
-- ---------------------------------------------------------------------------

CREATE TABLE payment_attempts (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id),
  student_id              uuid NOT NULL,
  guardian_id             uuid,
  payer_user_id           uuid,
  amount                  bigint NOT NULL CHECK (amount > 0),
  currency                text NOT NULL DEFAULT 'XOF',
  target_installment_ids  uuid[] NOT NULL DEFAULT '{}',
  provider                text NOT NULL CHECK (provider IN ('FEDAPAY','KKIAPAY','FAKE')),
  status                  text NOT NULL DEFAULT 'CREATED'
                          CHECK (status IN ('CREATED','PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED','EXPIRED','UNKNOWN')),
  external_id             text,
  -- Ce que le frontend doit afficher : {kind:'REDIRECT', url} | {kind:'WIDGET', publicKey, sandbox, data}.
  checkout                jsonb,
  expires_at              timestamptz NOT NULL,
  failure_code            text,
  failure_message         text,
  verified_amount         bigint,
  fees                    bigint,
  payment_id              uuid,
  -- Revue humaine (UNKNOWN, écart de montant) : écran « transactions en attente ».
  review_status           text NOT NULL DEFAULT 'NONE' CHECK (review_status IN ('NONE','OPEN','RESOLVED')),
  review_note             text,
  reviewed_by             uuid,
  reviewed_at             timestamptz,
  -- Réconciliation : prochain contrôle et compteur (backoff par tentative).
  next_check_at           timestamptz,
  check_count             integer NOT NULL DEFAULT 0,
  trace_id                text,
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id)
);
CREATE INDEX payment_attempts_student_idx ON payment_attempts (tenant_id, student_id, created_at DESC);
CREATE INDEX payment_attempts_status_idx ON payment_attempts (tenant_id, status, created_at DESC);
CREATE INDEX payment_attempts_pending_idx ON payment_attempts (next_check_at) WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX payment_attempts_review_idx ON payment_attempts (tenant_id, review_status) WHERE review_status = 'OPEN';
CREATE INDEX payment_attempts_external_idx ON payment_attempts (provider, external_id) WHERE external_id IS NOT NULL;
CREATE TRIGGER payment_attempts_updated_at BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Transactions côté provider : une transaction provider appartient à une seule tentative
-- ---------------------------------------------------------------------------

CREATE TABLE provider_transactions (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  attempt_id         uuid NOT NULL,
  provider           text NOT NULL,
  external_id        text NOT NULL,
  provider_status    text,
  normalized_status  text NOT NULL DEFAULT 'PENDING',
  amount             bigint,
  fees               bigint,
  method             text,
  raw                jsonb,
  verify_count       integer NOT NULL DEFAULT 0,
  last_verified_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (provider, external_id),
  UNIQUE (attempt_id),
  FOREIGN KEY (tenant_id, attempt_id) REFERENCES payment_attempts(tenant_id, id)
);
CREATE TRIGGER provider_transactions_updated_at BEFORE UPDATE ON provider_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Webhooks reçus : trace brute (en-têtes expurgés), unicité par événement provider
-- ---------------------------------------------------------------------------

CREATE TABLE webhook_events (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id),
  provider                 text NOT NULL,
  external_event_id        text NOT NULL,
  external_transaction_id  text,
  hint_status              text,
  attempt_id               uuid,
  signature_valid          boolean NOT NULL,
  headers                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  body                     jsonb,
  received_at              timestamptz NOT NULL DEFAULT now(),
  processed_at             timestamptz,
  processing_error         text,
  UNIQUE (tenant_id, id),
  UNIQUE (provider, external_event_id)
);
CREATE INDEX webhook_events_attempt_idx ON webhook_events (tenant_id, attempt_id, received_at);
CREATE INDEX webhook_events_tx_idx ON webhook_events (provider, external_transaction_id);

-- ---------------------------------------------------------------------------
-- Réconciliation quotidienne provider ↔ nous
-- ---------------------------------------------------------------------------

CREATE TABLE payment_reconciliation_runs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  provider      text NOT NULL,
  day           date NOT NULL,
  status        text NOT NULL CHECK (status IN ('OK','DISCREPANCIES','UNSUPPORTED','ERROR')),
  checked       integer NOT NULL DEFAULT 0,
  matched       integer NOT NULL DEFAULT 0,
  -- Transactions réussies côté provider inconnues chez nous : [{externalId, amount, occurredAt, resolved, note}]
  orphans       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Écarts de montant/frais : [{externalId, attemptId, expected, actual}]
  mismatches    jsonb NOT NULL DEFAULT '[]'::jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX payment_reconciliation_runs_idx ON payment_reconciliation_runs (tenant_id, day DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_payment_configs','payment_attempts','provider_transactions','webhook_events','payment_reconciliation_runs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t, t);
  END LOOP;
END $$;
