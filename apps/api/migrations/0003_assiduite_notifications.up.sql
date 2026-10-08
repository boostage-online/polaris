-- 0003_assiduite_notifications : feuilles d'appel, enregistrements et révisions (ADR-0006), justificatifs,
-- statistiques quotidiennes, alertes, notifications et préférences (ADR-0003 pour le flux événementiel).
-- Expand only.

-- ---------------------------------------------------------------------------
-- Feuilles d'appel : une par séance, DRAFT → SUBMITTED → LOCKED, version pour le verrouillage optimiste
-- ---------------------------------------------------------------------------

CREATE TABLE attendance_sheets (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  session_id    uuid NOT NULL,
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','LOCKED')),
  version       integer NOT NULL DEFAULT 1,
  retroactive   boolean NOT NULL DEFAULT false,      -- ouverte bien après la fin de la séance
  opened_by     uuid,
  submitted_by  uuid,
  submitted_at  timestamptz,
  locked_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id)
);
CREATE INDEX attendance_sheets_status_idx ON attendance_sheets (tenant_id, status);
CREATE TRIGGER attendance_sheets_updated_at BEFORE UPDATE ON attendance_sheets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Le fait (status) et la décision (excuse_status) sont deux axes ; EXCUSED n'est pas une présence.
CREATE TABLE attendance_records (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  sheet_id       uuid NOT NULL,
  session_id     uuid NOT NULL,
  student_id     uuid NOT NULL,
  status         text NOT NULL DEFAULT 'PRESENT' CHECK (status IN ('PRESENT','ABSENT','LATE')),
  excuse_status  text NOT NULL DEFAULT 'NONE' CHECK (excuse_status IN ('NONE','PENDING','EXCUSED','REJECTED')),
  late_minutes   integer CHECK (late_minutes IS NULL OR late_minutes > 0),
  left_early_at  timestamptz,
  note           text,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, student_id),
  FOREIGN KEY (tenant_id, sheet_id) REFERENCES attendance_sheets(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id),
  CHECK (status <> 'LATE' OR late_minutes IS NOT NULL)
);
CREATE INDEX attendance_records_student_idx ON attendance_records (tenant_id, student_id, session_id);
CREATE INDEX attendance_records_sheet_idx ON attendance_records (tenant_id, sheet_id);
CREATE INDEX attendance_records_status_idx ON attendance_records (tenant_id, status) WHERE status <> 'PRESENT';
CREATE TRIGGER attendance_records_updated_at BEFORE UPDATE ON attendance_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Chaque correction après soumission laisse une ligne ; jamais modifiée ni supprimée.
CREATE TABLE attendance_record_revisions (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  record_id            uuid NOT NULL,
  before_status        text NOT NULL,
  after_status         text NOT NULL,
  before_late_minutes  integer,
  after_late_minutes   integer,
  reason               text NOT NULL,
  out_of_window        boolean NOT NULL DEFAULT false,
  author_id            uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, record_id) REFERENCES attendance_records(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX attendance_record_revisions_record_idx ON attendance_record_revisions (tenant_id, record_id);
CREATE INDEX attendance_record_revisions_author_idx ON attendance_record_revisions (tenant_id, author_id, created_at);
CREATE TRIGGER attendance_record_revisions_append_only BEFORE UPDATE OR DELETE ON attendance_record_revisions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Justificatifs : un intervalle par élève, rattaché aux enregistrements ABSENT/LATE qu'il couvre
-- ---------------------------------------------------------------------------

CREATE TABLE absence_justifications (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  student_id         uuid NOT NULL,
  from_date          date NOT NULL,
  to_date            date NOT NULL,
  reason             text NOT NULL,
  document_key       text,                         -- clé de stockage objet (à venir) ou nom du document
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','INFO_REQUESTED')),
  submitted_by       uuid,
  submitted_by_kind  text NOT NULL CHECK (submitted_by_kind IN ('STAFF','GUARDIAN')),
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  review_comment     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id),
  CHECK (to_date >= from_date)
);
CREATE INDEX absence_justifications_status_idx ON absence_justifications (tenant_id, status, created_at);
CREATE INDEX absence_justifications_student_idx ON absence_justifications (tenant_id, student_id);
CREATE TRIGGER absence_justifications_updated_at BEFORE UPDATE ON absence_justifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE justification_records (
  tenant_id         uuid NOT NULL,
  justification_id  uuid NOT NULL,
  record_id         uuid NOT NULL,
  PRIMARY KEY (justification_id, record_id),
  FOREIGN KEY (tenant_id, justification_id) REFERENCES absence_justifications(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, record_id) REFERENCES attendance_records(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX justification_records_record_idx ON justification_records (tenant_id, record_id);

-- ---------------------------------------------------------------------------
-- Statistiques quotidiennes par élève (recalculées pour les élèves touchés) et alertes de seuil
-- ---------------------------------------------------------------------------

CREATE TABLE attendance_daily_stats (
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  student_id   uuid NOT NULL,
  day          date NOT NULL,
  sessions     integer NOT NULL DEFAULT 0,
  present      integer NOT NULL DEFAULT 0,
  absent       integer NOT NULL DEFAULT 0,
  late         integer NOT NULL DEFAULT 0,
  excused      integer NOT NULL DEFAULT 0,      -- absences ou retards EXCUSED
  unjustified  integer NOT NULL DEFAULT 0,      -- absences non EXCUSED
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, student_id, day),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id)
);
CREATE INDEX attendance_daily_stats_day_idx ON attendance_daily_stats (tenant_id, day);

CREATE TABLE attendance_alerts (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  student_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('REPEATED_ABSENCES')),
  window_from  date NOT NULL,
  window_to    date NOT NULL,
  count        integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id)
);
-- Une alerte ouverte par élève et par type : la fenêtre glisse, l'alerte est mise à jour, pas dupliquée.
CREATE UNIQUE INDEX attendance_alerts_open_unique ON attendance_alerts (tenant_id, student_id, kind) WHERE resolved_at IS NULL;
CREATE INDEX attendance_alerts_open_idx ON attendance_alerts (tenant_id, created_at) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Notifications : une ligne par (événement, destinataire, canal) ; in-app = boîte de réception
-- ---------------------------------------------------------------------------

CREATE TABLE notifications (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  event_id             text NOT NULL,                    -- id outbox ou clé synthétique (ex. missing:<session>)
  kind                 text NOT NULL,
  channel              text NOT NULL CHECK (channel IN ('SMS','EMAIL','PUSH','INAPP')),
  status               text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED','SUPPRESSED')),
  recipient_user_id    uuid NOT NULL REFERENCES users(id),
  recipient_address    text,                             -- téléphone ou e-mail au moment de l'envoi
  student_id           uuid,
  title                text NOT NULL,
  body                 text NOT NULL,
  action_url           text,
  payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_message_id  text,
  error                text,
  attempts             integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  delivered_at         timestamptz,
  read_at              timestamptz,
  UNIQUE (tenant_id, event_id, recipient_user_id, channel),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id)
);
CREATE INDEX notifications_recipient_idx ON notifications (tenant_id, recipient_user_id, created_at DESC);
CREATE INDEX notifications_student_idx ON notifications (tenant_id, student_id, created_at DESC);
CREATE INDEX notifications_status_idx ON notifications (tenant_id, status) WHERE status = 'QUEUED';
CREATE INDEX notifications_month_sms_idx ON notifications (tenant_id, channel, created_at) WHERE channel = 'SMS';

CREATE TABLE notification_preferences (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL,
  channels    text[] NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, kind)
);

-- ---------------------------------------------------------------------------
-- RLS sur toutes les nouvelles tables tenant
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_sheets','attendance_records','attendance_record_revisions','absence_justifications',
                            'justification_records','attendance_daily_stats','attendance_alerts','notifications','notification_preferences']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t, t);
  END LOOP;
END $$;
