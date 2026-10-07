-- 0004_billing : sous-grand-livre de créances (ADR-0005) — catalogue de frais, créances et échéances,
-- ajustements, paiements et allocations (append-only), crédits, reçus numérotés, rappels.
-- Expand only. Montants entiers (BIGINT) en XOF, colonne currency pour l'avenir.

-- ---------------------------------------------------------------------------
-- Catalogue : catégories, grilles, échéanciers types
-- ---------------------------------------------------------------------------

CREATE TABLE fee_categories (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  code        text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER fee_categories_updated_at BEFORE UPDATE ON fee_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fee_structures (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  academic_year_id  uuid NOT NULL,
  category_id       uuid NOT NULL,
  code              text NOT NULL,
  name              text NOT NULL,
  total_amount      bigint NOT NULL CHECK (total_amount >= 0),
  currency          text NOT NULL DEFAULT 'XOF',
  applies_to        jsonb NOT NULL DEFAULT '{"programIds":[],"levelIds":[],"groupIds":[]}'::jsonb,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, academic_year_id, code),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES fee_categories(tenant_id, id)
);
CREATE INDEX fee_structures_year_idx ON fee_structures (tenant_id, academic_year_id) WHERE deleted_at IS NULL;
CREATE TRIGGER fee_structures_updated_at BEFORE UPDATE ON fee_structures FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fee_schedule_items (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  fee_structure_id  uuid NOT NULL,
  seq               integer NOT NULL CHECK (seq > 0),
  label             text NOT NULL,
  amount            bigint NOT NULL CHECK (amount >= 0),
  due_date          date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (fee_structure_id, seq),
  FOREIGN KEY (tenant_id, fee_structure_id) REFERENCES fee_structures(tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Affectation → créances (figées) → échéances (unité d'allocation)
-- ---------------------------------------------------------------------------

CREATE TABLE fee_assignments (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  fee_structure_id  uuid NOT NULL,
  target            jsonb NOT NULL,
  targeted_count    integer NOT NULL DEFAULT 0,
  created_count     integer NOT NULL DEFAULT 0,
  skipped_count     integer NOT NULL DEFAULT 0,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, fee_structure_id) REFERENCES fee_structures(tenant_id, id)
);

CREATE TABLE student_fees (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  student_id         uuid NOT NULL,
  fee_structure_id   uuid NOT NULL,
  academic_year_id   uuid NOT NULL,
  assignment_id      uuid,
  total_amount       bigint NOT NULL CHECK (total_amount >= 0),
  adjustments_total  bigint NOT NULL DEFAULT 0,
  amount_allocated   bigint NOT NULL DEFAULT 0 CHECK (amount_allocated >= 0),
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIALLY_PAID','PAID','CANCELLED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, student_id, fee_structure_id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id),
  FOREIGN KEY (tenant_id, fee_structure_id) REFERENCES fee_structures(tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years(tenant_id, id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES fee_assignments(tenant_id, id)
);
CREATE INDEX student_fees_student_idx ON student_fees (tenant_id, student_id);
CREATE INDEX student_fees_status_idx ON student_fees (tenant_id, status);
CREATE TRIGGER student_fees_updated_at BEFORE UPDATE ON student_fees FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE installments (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  student_fee_id     uuid NOT NULL,
  student_id         uuid NOT NULL,
  seq                integer NOT NULL,
  label              text NOT NULL,
  amount_due         bigint NOT NULL CHECK (amount_due >= 0),
  adjustments_total  bigint NOT NULL DEFAULT 0,
  amount_allocated   bigint NOT NULL DEFAULT 0 CHECK (amount_allocated >= 0),
  due_date           date NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DUE','OVERDUE','PARTIALLY_PAID','PAID','CANCELLED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (student_fee_id, seq),
  FOREIGN KEY (tenant_id, student_fee_id) REFERENCES student_fees(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id)
);
CREATE INDEX installments_student_idx ON installments (tenant_id, student_id, due_date);
CREATE INDEX installments_open_idx ON installments (tenant_id, due_date) WHERE status NOT IN ('PAID','CANCELLED');
CREATE TRIGGER installments_updated_at BEFORE UPDATE ON installments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Une créance partiellement allouée ne se modifie jamais : on ajuste (montant signé, motif, auteur).
CREATE TABLE fee_adjustments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  student_fee_id  uuid NOT NULL,
  installment_id  uuid,
  amount          bigint NOT NULL CHECK (amount <> 0),
  kind            text NOT NULL CHECK (kind IN ('DISCOUNT','SCHOLARSHIP','WAIVER','PENALTY','CORRECTION')),
  reason          text NOT NULL,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_fee_id) REFERENCES student_fees(tenant_id, id),
  FOREIGN KEY (tenant_id, installment_id) REFERENCES installments(tenant_id, id)
);
CREATE INDEX fee_adjustments_fee_idx ON fee_adjustments (tenant_id, student_fee_id);
CREATE TRIGGER fee_adjustments_append_only BEFORE UPDATE OR DELETE ON fee_adjustments FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Argent reçu : paiements (immuables, sauf passage REVERSED), allocations, crédits, reçus
-- ---------------------------------------------------------------------------

CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  student_id       uuid NOT NULL,
  amount           bigint NOT NULL CHECK (amount > 0),
  currency         text NOT NULL DEFAULT 'XOF',
  source           text NOT NULL CHECK (source IN ('MANUAL','ELECTRONIC')),
  method           text NOT NULL CHECK (method IN ('CASH','BANK_TRANSFER','CHEQUE','MOBILE_MONEY_OFFLINE','MOBILE_MONEY','CARD')),
  status           text NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','REVERSED')),
  payer_name       text,
  payer_user_id    uuid,
  value_date       date NOT NULL,
  reference        text,
  comment          text,
  attempt_id       uuid,                       -- Phase 5 : UNIQUE, seule une tentative SUCCEEDED vérifiée crée un paiement
  recorded_by      uuid,
  reversed_at      timestamptz,
  reversed_by      uuid,
  reversal_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (attempt_id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id)
);
CREATE INDEX payments_student_idx ON payments (tenant_id, student_id, created_at DESC);
CREATE INDEX payments_date_idx ON payments (tenant_id, value_date);
CREATE INDEX payments_recorded_by_idx ON payments (tenant_id, recorded_by, created_at);

-- Un paiement ne change jamais, sauf pour passer COMPLETED → REVERSED (champs d'annulation uniquement).
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments est en ajout seul (ADR-0005)';
  END IF;
  IF OLD.status = 'COMPLETED' AND NEW.status = 'REVERSED'
     AND NEW.id = OLD.id AND NEW.tenant_id = OLD.tenant_id AND NEW.student_id = OLD.student_id
     AND NEW.amount = OLD.amount AND NEW.currency = OLD.currency AND NEW.source = OLD.source
     AND NEW.method = OLD.method AND NEW.value_date = OLD.value_date
     AND NEW.payer_name IS NOT DISTINCT FROM OLD.payer_name AND NEW.reference IS NOT DISTINCT FROM OLD.reference
     AND NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id AND NEW.recorded_by IS NOT DISTINCT FROM OLD.recorded_by
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payments est immuable : seule l''annulation compensatoire est permise (ADR-0005)';
END $$;
CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- Annulation compensatoire d'un paiement : trace du motif ; les allocations négatives s'y rattachent.
CREATE TABLE refunds (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  payment_id  uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('INTERNAL_REVERSAL','PROVIDER_REFUND')),
  amount      bigint NOT NULL CHECK (amount > 0),
  reason      text NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id)
);
CREATE TRIGGER refunds_append_only BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE payment_allocations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  payment_id      uuid NOT NULL,
  installment_id  uuid NOT NULL,
  amount          bigint NOT NULL CHECK (amount <> 0),   -- négatif = contre-passation (refund_id renseigné)
  refund_id       uuid,
  credit_id       uuid,                                  -- allocation issue d'un trop-perçu
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id),
  FOREIGN KEY (tenant_id, installment_id) REFERENCES installments(tenant_id, id),
  FOREIGN KEY (tenant_id, refund_id) REFERENCES refunds(tenant_id, id),
  CHECK ((amount > 0) OR (refund_id IS NOT NULL))
);
CREATE INDEX payment_allocations_payment_idx ON payment_allocations (tenant_id, payment_id);
CREATE INDEX payment_allocations_installment_idx ON payment_allocations (tenant_id, installment_id);
CREATE TRIGGER payment_allocations_append_only BEFORE UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE student_credits (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  student_id  uuid NOT NULL,
  payment_id  uuid NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  remaining   bigint NOT NULL CHECK (remaining >= 0),
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPLIED','REFUNDED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id)
);
CREATE INDEX student_credits_open_idx ON student_credits (tenant_id, student_id) WHERE status = 'OPEN';
CREATE TRIGGER student_credits_updated_at BEFORE UPDATE ON student_credits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE receipt_sequences (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  year       integer NOT NULL,
  last_seq   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);

CREATE TABLE receipts (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  payment_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('PAYMENT','CANCELLATION')),
  number       text NOT NULL,
  amount       bigint NOT NULL,
  currency     text NOT NULL,
  snapshot     jsonb NOT NULL,
  verify_hash  text NOT NULL,
  pdf_key      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number),
  UNIQUE (payment_id, kind),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id)
);
CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Rappels d'impayés (dédoublonnage) et contrôle d'intégrité
-- ---------------------------------------------------------------------------

CREATE TABLE payment_reminders (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  installment_id  uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('DUE_SOON','OVERDUE','MANUAL')),
  scheduled_for   date NOT NULL,
  sent_by         uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installment_id, kind, scheduled_for),
  FOREIGN KEY (tenant_id, installment_id) REFERENCES installments(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE ledger_integrity_checks (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  checked_at  timestamptz NOT NULL DEFAULT now(),
  mismatches  integer NOT NULL,
  details     jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX ledger_integrity_checks_idx ON ledger_integrity_checks (tenant_id, checked_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_categories','fee_structures','fee_schedule_items','fee_assignments','student_fees','installments',
                            'fee_adjustments','payments','refunds','payment_allocations','student_credits','receipt_sequences','receipts',
                            'payment_reminders','ledger_integrity_checks']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t, t);
  END LOOP;
END $$;
