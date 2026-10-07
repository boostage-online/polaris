-- 0006_reporting : reporting et tableaux de bord (Phase 6). Agrégats quotidiens rafraîchis par le worker
-- (PostgreSQL n'applique pas de RLS aux vues matérialisées : on matérialise dans des tables tenant sous RLS),
-- rapports planifiés par e-mail, exports complets par établissement. Expand only.

-- ---------------------------------------------------------------------------
-- Agrégats quotidiens (« vues matérialisées » sous RLS)
-- ---------------------------------------------------------------------------

CREATE TABLE report_attendance_daily (
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  day               date NOT NULL,
  group_id          uuid NOT NULL,
  sessions_planned  integer NOT NULL DEFAULT 0,
  sessions_held     integer NOT NULL DEFAULT 0,
  sheets_submitted  integer NOT NULL DEFAULT 0,
  sheets_missing    integer NOT NULL DEFAULT 0,
  records           integer NOT NULL DEFAULT 0,
  present           integer NOT NULL DEFAULT 0,
  absent            integer NOT NULL DEFAULT 0,
  late              integer NOT NULL DEFAULT 0,
  excused           integer NOT NULL DEFAULT 0,
  unjustified       integer NOT NULL DEFAULT 0,
  refreshed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day, group_id)
);
CREATE INDEX report_attendance_daily_day_idx ON report_attendance_daily (tenant_id, day DESC);

CREATE TABLE report_finance_daily (
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  day              date NOT NULL,
  -- Canal : CASH, BANK_TRANSFER, CHEQUE, MOBILE_MONEY_OFFLINE (caisse) ; FEDAPAY, KKIAPAY, FAKE (en ligne).
  channel          text NOT NULL,
  payments         integer NOT NULL DEFAULT 0,
  amount           bigint NOT NULL DEFAULT 0,
  reversed_count   integer NOT NULL DEFAULT 0,
  reversed_amount  bigint NOT NULL DEFAULT 0,
  fees             bigint NOT NULL DEFAULT 0,
  refreshed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day, channel)
);
CREATE INDEX report_finance_daily_day_idx ON report_finance_daily (tenant_id, day DESC);

CREATE TABLE report_refreshes (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  from_day     date NOT NULL,
  to_day       date NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  attendance_rows integer NOT NULL DEFAULT 0,
  finance_rows    integer NOT NULL DEFAULT 0,
  error        text
);
CREATE INDEX report_refreshes_idx ON report_refreshes (tenant_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- Rapports planifiés par e-mail
-- ---------------------------------------------------------------------------

CREATE TABLE scheduled_reports (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  report_key    text NOT NULL,
  cadence       text NOT NULL CHECK (cadence IN ('WEEKLY','MONTHLY')),
  -- Hebdomadaire : jour ISO (1 = lundi) ; mensuel : jour du mois (1–28).
  day_of_period integer NOT NULL DEFAULT 1 CHECK (day_of_period BETWEEN 1 AND 28),
  recipients    text[] NOT NULL,
  filters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled       boolean NOT NULL DEFAULT true,
  last_sent_at  timestamptz,
  last_error    text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER scheduled_reports_updated_at BEFORE UPDATE ON scheduled_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Exports complets par établissement (archive ZIP de CSV, générée par le worker)
-- ---------------------------------------------------------------------------

CREATE TABLE tenant_exports (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  status        text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','DONE','FAILED')),
  requested_by  uuid,
  started_at    timestamptz,
  finished_at   timestamptz,
  size_bytes    bigint,
  entries       jsonb NOT NULL DEFAULT '[]'::jsonb,
  file          bytea,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX tenant_exports_idx ON tenant_exports (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['report_attendance_daily','report_finance_daily','report_refreshes','scheduled_reports','tenant_exports']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t, t);
  END LOOP;
END $$;
