-- 0002_academique_eleves : modèle académique unifié (ADR-0004), élèves, inscriptions, tuteurs, imports.
-- Expand only.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Normalisation légère (accents, apostrophes, casse) pour la détection de doublons sans dépendre de l'extension unaccent.
CREATE OR REPLACE FUNCTION unaccent_lite(text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT btrim(regexp_replace(lower(translate($1,
    'àáâäãåçèéêëìíîïñòóôöõùúûüýÿÀÁÂÄÃÅÇÈÉÊËÌÍÎÏÑÒÓÔÖÕÙÚÛÜÝ''’-',
    'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy   ')), '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Structure académique : Programme → Niveau → Groupe (CLASS / SUBGROUP), matières
-- ---------------------------------------------------------------------------

CREATE TABLE programs (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  code        text NOT NULL,
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,      -- programme implicite des écoles
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER programs_updated_at BEFORE UPDATE ON programs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE levels (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  program_id  uuid NOT NULL,
  name        text NOT NULL,
  rank        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, program_id, name),
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs(tenant_id, id)
);
CREATE TRIGGER levels_updated_at BEFORE UPDATE ON levels FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE groups (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  academic_year_id  uuid NOT NULL,
  level_id          uuid NOT NULL,
  campus_id         uuid,
  parent_group_id   uuid,
  name              text NOT NULL,
  kind              text NOT NULL DEFAULT 'CLASS' CHECK (kind IN ('CLASS','SUBGROUP')),
  capacity          integer CHECK (capacity IS NULL OR capacity > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, academic_year_id, name),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years(tenant_id, id),
  FOREIGN KEY (tenant_id, level_id) REFERENCES levels(tenant_id, id),
  FOREIGN KEY (tenant_id, campus_id) REFERENCES campuses(tenant_id, id),
  FOREIGN KEY (tenant_id, parent_group_id) REFERENCES groups(tenant_id, id),
  CHECK (kind = 'CLASS' OR parent_group_id IS NOT NULL OR kind = 'SUBGROUP')
);
CREATE INDEX groups_year_idx ON groups (tenant_id, academic_year_id) WHERE deleted_at IS NULL;
CREATE TRIGGER groups_updated_at BEFORE UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subjects (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  code        text NOT NULL,
  name        text NOT NULL,
  level_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, level_id) REFERENCES levels(tenant_id, id)
);
CREATE TRIGGER subjects_updated_at BEFORE UPDATE ON subjects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Personnel enseignant, cours, emplois du temps, séances
-- ---------------------------------------------------------------------------

CREATE TABLE staff_profiles (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  membership_id    uuid NOT NULL,
  employee_number  text,
  title            text,
  is_teacher       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, membership_id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id, id)
);
CREATE UNIQUE INDEX staff_profiles_employee_number ON staff_profiles (tenant_id, employee_number) WHERE employee_number IS NOT NULL;
CREATE TRIGGER staff_profiles_updated_at BEFORE UPDATE ON staff_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Une matière enseignée à un groupe pendant une année (et éventuellement une période) : l'unité d'enseignement.
CREATE TABLE course_offerings (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  subject_id        uuid NOT NULL,
  group_id          uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  term_id           uuid,
  label             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects(tenant_id, id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years(tenant_id, id),
  FOREIGN KEY (tenant_id, term_id) REFERENCES terms(tenant_id, id)
);
CREATE UNIQUE INDEX course_offerings_unique ON course_offerings
  (tenant_id, subject_id, group_id, academic_year_id, COALESCE(term_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE deleted_at IS NULL;
CREATE INDEX course_offerings_group_idx ON course_offerings (tenant_id, group_id);
CREATE TRIGGER course_offerings_updated_at BEFORE UPDATE ON course_offerings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE course_teachers (
  tenant_id           uuid NOT NULL,
  course_offering_id  uuid NOT NULL,
  staff_profile_id    uuid NOT NULL,
  role                text NOT NULL DEFAULT 'MAIN' CHECK (role IN ('MAIN','ASSISTANT')),
  PRIMARY KEY (course_offering_id, staff_profile_id),
  FOREIGN KEY (tenant_id, course_offering_id) REFERENCES course_offerings(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, staff_profile_id) REFERENCES staff_profiles(tenant_id, id)
);
CREATE INDEX course_teachers_staff_idx ON course_teachers (tenant_id, staff_profile_id);

CREATE TABLE schedule_slots (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  course_offering_id  uuid NOT NULL,
  weekday             smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- 1 = lundi (ISO)
  start_time          time NOT NULL,
  end_time            time NOT NULL,
  room                text,
  valid_from          date,
  valid_to            date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, course_offering_id) REFERENCES course_offerings(tenant_id, id) ON DELETE CASCADE,
  CHECK (end_time > start_time),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX schedule_slots_course_idx ON schedule_slots (tenant_id, course_offering_id) WHERE deleted_at IS NULL;

-- La séance concrète : la seule unité sur laquelle on fait l'appel (ADR-0004).
CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  course_offering_id  uuid NOT NULL,
  schedule_slot_id    uuid,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','HELD','CANCELLED')),
  room                text,
  cancel_reason       text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, course_offering_id, starts_at),
  FOREIGN KEY (tenant_id, course_offering_id) REFERENCES course_offerings(tenant_id, id),
  FOREIGN KEY (tenant_id, schedule_slot_id) REFERENCES schedule_slots(tenant_id, id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX sessions_time_idx ON sessions (tenant_id, starts_at);
CREATE INDEX sessions_course_time_idx ON sessions (tenant_id, course_offering_id, starts_at);
CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Élèves, inscriptions, tuteurs, liens parent-enfant
-- ---------------------------------------------------------------------------

CREATE TABLE students (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  matricule   text NOT NULL,
  first_name  text NOT NULL,
  last_name   text NOT NULL,
  birth_date  date,
  gender      text CHECK (gender IS NULL OR gender IN ('F','M','X')),
  photo_key   text,
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEFT','GRADUATED')),
  left_at     date,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, matricule)
);
CREATE INDEX students_name_trgm ON students USING gin ((last_name || ' ' || first_name) gin_trgm_ops);
CREATE INDEX students_status_idx ON students (tenant_id, status) WHERE deleted_at IS NULL;
CREATE TRIGGER students_updated_at BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE enrollments (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  student_id        uuid NOT NULL,
  group_id          uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  is_primary        boolean NOT NULL,                 -- true = inscription dans un groupe CLASS
  enrolled_at       date NOT NULL DEFAULT current_date,
  left_at           date,
  left_reason       text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id),
  FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years(tenant_id, id),
  CHECK (left_at IS NULL OR left_at >= enrolled_at)
);
-- Une seule inscription CLASS active par élève et par année ; plusieurs sous-groupes autorisés.
CREATE UNIQUE INDEX enrollments_one_primary_active ON enrollments (tenant_id, student_id, academic_year_id)
  WHERE left_at IS NULL AND is_primary;
CREATE UNIQUE INDEX enrollments_one_per_group_active ON enrollments (tenant_id, student_id, group_id)
  WHERE left_at IS NULL;
CREATE INDEX enrollments_group_idx ON enrollments (tenant_id, group_id) WHERE left_at IS NULL;
CREATE INDEX enrollments_student_idx ON enrollments (tenant_id, student_id);

CREATE TABLE guardians (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  user_id            uuid REFERENCES users(id),
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  phone_e164         text NOT NULL CHECK (phone_e164 ~ '^\+[1-9]\d{6,14}$'),
  email              text CHECK (email IS NULL OR email = lower(email)),
  preferred_channel  text NOT NULL DEFAULT 'SMS' CHECK (preferred_channel IN ('SMS','PUSH','EMAIL','WHATSAPP')),
  locale             text NOT NULL DEFAULT 'fr',
  invited_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, phone_e164)
);
CREATE INDEX guardians_user_idx ON guardians (user_id);
CREATE INDEX guardians_name_trgm ON guardians USING gin ((last_name || ' ' || first_name) gin_trgm_ops);
CREATE TRIGGER guardians_updated_at BEFORE UPDATE ON guardians FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Le lien parent-enfant : pierre angulaire des droits du parent. Jamais supprimé, seulement délié.
CREATE TABLE student_guardians (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  student_id           uuid NOT NULL,
  guardian_id          uuid NOT NULL,
  relationship         text NOT NULL CHECK (relationship IN ('MOTHER','FATHER','TUTOR','OTHER')),
  is_primary           boolean NOT NULL DEFAULT false,
  can_view_attendance  boolean NOT NULL DEFAULT true,
  can_view_finance     boolean NOT NULL DEFAULT true,
  can_pay              boolean NOT NULL DEFAULT true,
  can_justify          boolean NOT NULL DEFAULT true,
  linked_by            uuid,
  linked_at            timestamptz NOT NULL DEFAULT now(),
  unlinked_at          timestamptz,
  unlinked_by          uuid,
  unlink_reason        text,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id),
  FOREIGN KEY (tenant_id, guardian_id) REFERENCES guardians(tenant_id, id)
);
CREATE UNIQUE INDEX student_guardians_active_unique ON student_guardians (tenant_id, student_id, guardian_id) WHERE unlinked_at IS NULL;
CREATE INDEX student_guardians_guardian_idx ON student_guardians (tenant_id, guardian_id) WHERE unlinked_at IS NULL;
CREATE INDEX student_guardians_student_idx ON student_guardians (tenant_id, student_id) WHERE unlinked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------------

CREATE TABLE import_jobs (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  kind         text NOT NULL CHECK (kind IN ('STUDENTS','GUARDIANS')),
  dry_run      boolean NOT NULL,
  status       text NOT NULL DEFAULT 'DONE' CHECK (status IN ('RUNNING','DONE','FAILED')),
  rows_total   integer NOT NULL DEFAULT 0,
  rows_ok      integer NOT NULL DEFAULT 0,
  rows_error   integer NOT NULL DEFAULT 0,
  report       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX import_jobs_tenant_idx ON import_jobs (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS sur toutes les nouvelles tables tenant
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['programs','levels','groups','subjects','staff_profiles','course_offerings','course_teachers',
                            'schedule_slots','sessions','students','enrollments','guardians','student_guardians','import_jobs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t, t);
  END LOOP;
END $$;
