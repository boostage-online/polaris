/**
 * Seed déterministe (local, staging, tests) : une plateforme, un lycée, une université,
 * un utilisateur par rôle système dans chaque établissement.
 *
 *   tsx src/seed/seed.ts            — utilise DATABASE_URL_PLATFORM
 *
 * Mots de passe de démonstration : `Polaris-demo-2026` pour tous (jamais en production).
 */
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { PERMISSION_DEFINITIONS, SYSTEM_ROLES, type SystemRoleCode } from '@polaris/contracts';
import { LocalKeyWrapper, sealSecrets } from '../modules/payments/infrastructure/secrets';
import { buildZip } from '../modules/reporting/infrastructure/zip';

export const DEMO_PASSWORD = 'Polaris-demo-2026';

export interface SeededAcademic {
  yearId: string;
  programId: string;
  levelIds: { sixieme: string; cinquieme: string };
  groupIds: { sixA: string; sixB: string; sixA1: string };
  subjectIds: { math: string; fr: string };
  staffProfileIds: { TEACHER: string; ADMIN: string };
  courseIds: { math6a: string; fr6a: string };
  slotId: string;
  /** Une séance planifiée (lundi 12/10/2026 08:00, heure de Cotonou) et un import à blanc, pour les tests. */
  sessionId: string;
  importJobId: string;
  /** 3 élèves en 6e A (le 1er aussi dans le sous-groupe), 1 en 6e B, 1 parti. */
  studentIds: string[];
  enrollmentIds: { s1Class: string; s1Sub: string };
  guardianIds: { parent: string; other: string };
  linkIds: { parentS1: string; parentS2: string; otherS3: string };
  /** Assiduité (Phase 3) : la séance seedée a un appel soumis (S1 absent, S2 en retard), un justificatif en attente, une alerte. */
  attendance: {
    sheetId: string;
    recordIds: { s1: string; s2: string; s3: string };
    justificationId: string;
    alertId: string;
    notificationId: string;
  };
  /** Frais (Phase 4) : grille SCOL-6E affectée aux élèves actifs de 6e, S1 a payé 60 000 FCFA en espèces (reçu n° 1). */
  billing: {
    categoryId: string;
    structureId: string;
    feeIds: { s1: string; s2: string };
    installmentIds: { s1: string[]; s2: string[] };
    paymentId: string;
    receiptNumber: string;
  };
  /** Paiements en ligne (Phase 5) : provider de démonstration actif (sandbox), jeton et secret de webhook. */
  payments: {
    configId: string;
    webhookToken: string;
    webhookSecret: string;
    /** Tentative annulée par le parent (historique) et une réconciliation « OK » de la veille. */
    cancelledAttemptId: string;
    reconciliationRunId: string;
  };
  /** Reporting (Phase 6) : un rapport planifié hebdomadaire et un export complet terminé (archive minimale). */
  reporting: { scheduledReportId: string; exportId: string };
  /** Compte parent activé : connexion par e-mail + mot de passe de démo (OTP en réel). */
  parentUser: { userId: string; membershipId: string; email: string; phone: string };
}

export interface SeededTenant {
  id: string;
  code: string;
  roleIds: Record<SystemRoleCode, string>;
  users: Record<SystemRoleCode, { userId: string; membershipId: string; email: string }>;
  academic: SeededAcademic;
}
export interface SeedResult {
  platformAdmin: { userId: string; membershipId: string; email: string };
  tenants: Record<'lycee' | 'univ', SeededTenant>;
}

const ARGON = { type: argon2.argon2id, memoryCost: 8 * 1024, timeCost: 2, parallelism: 1 } as const; // léger : seed uniquement

export async function seedDatabase(
  connectionString: string,
  opts: { quiet?: boolean } = {},
): Promise<SeedResult> {
  const pool = new Pool({ connectionString, max: 2 });
  const client = await pool.connect();
  const log = (m: string) => (opts.quiet ? undefined : console.warn(m));
  try {
    await client.query('begin');
    const passwordHash = await argon2.hash(DEMO_PASSWORD, ARGON);
    await syncPermissions(client);

    const platformAdmin = await createUser(client, {
      email: 'admin@polaris.local',
      displayName: 'Super Admin',
      passwordHash,
    });
    const platformMembershipId = await createMembership(client, {
      userId: platformAdmin,
      tenantId: null,
      kind: 'PLATFORM',
    });

    const lycee = await createTenant(client, {
      code: 'lycee-demo',
      name: 'Lycée de démonstration',
      type: 'SCHOOL',
      passwordHash,
    });
    const univ = await createTenant(client, {
      code: 'univ-demo',
      name: 'Université de démonstration',
      type: 'UNIVERSITY',
      passwordHash,
    });
    await client.query('commit');
    log(
      `✔ seed : plateforme (admin@polaris.local), ${lycee.code}, ${univ.code} — mot de passe ${DEMO_PASSWORD}`,
    );
    return {
      platformAdmin: {
        userId: platformAdmin,
        membershipId: platformMembershipId,
        email: 'admin@polaris.local',
      },
      tenants: { lycee, univ },
    };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

/** Synchronise la table permissions depuis le catalogue code (ADR-0007). Idempotent. */
export async function syncPermissions(client: PoolClient) {
  for (const p of PERMISSION_DEFINITIONS) {
    await client.query(
      `insert into permissions (code, module, description, sensitive) values ($1, $2, $3, $4)
       on conflict (code) do update set module = excluded.module, description = excluded.description, sensitive = excluded.sensitive`,
      [p.code, p.module, p.description, 'sensitive' in p && p.sensitive === true],
    );
  }
}

async function createUser(
  client: PoolClient,
  u: { email: string; displayName: string; passwordHash: string; phone?: string },
) {
  const id = randomUUID();
  await client.query(
    `insert into users (id, email, phone_e164, password_hash, display_name) values ($1, $2, $3, $4, $5)`,
    [id, u.email, u.phone ?? null, u.passwordHash, u.displayName],
  );
  return id;
}
async function createMembership(
  client: PoolClient,
  m: { userId: string; tenantId: string | null; kind: string },
) {
  const id = randomUUID();
  await client.query(
    `insert into memberships (id, user_id, tenant_id, kind, status, accepted_at) values ($1, $2, $3, $4, 'ACTIVE', now())`,
    [id, m.userId, m.tenantId, m.kind],
  );
  return id;
}

async function createTenant(
  client: PoolClient,
  t: { code: string; name: string; type: string; passwordHash: string },
): Promise<SeededTenant> {
  const id = randomUUID();
  await client.query(
    `insert into tenants (id, code, name, type, status) values ($1, $2, $3, $4, 'ACTIVE')`,
    [id, t.code, t.name, t.type],
  );
  await client.query(`insert into campuses (id, tenant_id, name) values ($1, $2, $3)`, [
    randomUUID(),
    id,
    'Campus principal',
  ]);
  const yearId = randomUUID();
  await client.query(
    `insert into academic_years (id, tenant_id, label, start_date, end_date, is_current) values ($1, $2, '2026-2027', '2026-09-15', '2027-07-15', true)`,
    [yearId, id],
  );

  const roleIds = {} as Record<SystemRoleCode, string>;
  const users = {} as SeededTenant['users'];
  for (const [code, def] of Object.entries(SYSTEM_ROLES) as [
    SystemRoleCode,
    (typeof SYSTEM_ROLES)[SystemRoleCode],
  ][]) {
    const roleId = randomUUID();
    await client.query(
      `insert into roles (id, tenant_id, name, description, system_code, is_locked) values ($1, $2, $3, $4, $5, $6)`,
      [roleId, id, def.name, def.description, code, code === 'ADMIN'],
    );
    for (const p of def.permissions)
      await client.query(
        `insert into role_permissions (tenant_id, role_id, permission_code) values ($1, $2, $3)`,
        [id, roleId, p],
      );
    roleIds[code] = roleId;

    const email = `${code.toLowerCase().replace('_', '-')}@${t.code}.local`;
    const userId = await createUser(client, {
      email,
      displayName: `${def.name} (${t.code})`,
      passwordHash: t.passwordHash,
    });
    const membershipId = await createMembership(client, { userId, tenantId: id, kind: 'STAFF' });
    await client.query(
      `insert into membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`,
      [id, membershipId, roleId],
    );
    users[code] = { userId, membershipId, email };
  }
  const academic = await seedAcademic(client, {
    tenantId: id,
    code: t.code,
    yearId,
    teacherMembershipId: users.TEACHER.membershipId,
    adminMembershipId: users.ADMIN.membershipId,
    passwordHash: t.passwordHash,
    phonePrefix: t.type === 'SCHOOL' ? '+2299100' : '+2299200',
  });
  return { id, code: t.code, roleIds, users, academic };
}

/** Structure de démonstration (Phase 2) : une classe vivante, un cours planifié, des élèves et des parents. */
async function seedAcademic(
  client: PoolClient,
  a: {
    tenantId: string;
    code: string;
    yearId: string;
    teacherMembershipId: string;
    adminMembershipId: string;
    passwordHash: string;
    phonePrefix: string;
  },
): Promise<SeededAcademic> {
  const t = a.tenantId;
  const q = (text: string, values: unknown[]) => client.query(text, values);
  const ids = () => randomUUID();

  const programId = ids();
  await q(
    `insert into programs (id, tenant_id, code, name, is_default) values ($1, $2, 'GEN', 'Enseignement général', true)`,
    [programId, t],
  );
  const levelIds = { sixieme: ids(), cinquieme: ids() };
  await q(
    `insert into levels (id, tenant_id, program_id, name, rank) values ($1, $2, $3, '6e', 1), ($4, $2, $3, '5e', 2)`,
    [levelIds.sixieme, t, programId, levelIds.cinquieme],
  );
  const groupIds = { sixA: ids(), sixB: ids(), sixA1: ids() };
  await q(
    `insert into groups (id, tenant_id, academic_year_id, level_id, name, kind, capacity, parent_group_id) values
       ($1, $2, $3, $4, '6e A', 'CLASS', 40, null),
       ($5, $2, $3, $4, '6e B', 'CLASS', 40, null),
       ($6, $2, $3, $4, '6e A – Groupe 1', 'SUBGROUP', null, $1)`,
    [groupIds.sixA, t, a.yearId, levelIds.sixieme, groupIds.sixB, groupIds.sixA1],
  );
  const subjectIds = { math: ids(), fr: ids() };
  await q(
    `insert into subjects (id, tenant_id, code, name) values ($1, $2, 'MATH', 'Mathématiques'), ($3, $2, 'FR', 'Français')`,
    [subjectIds.math, t, subjectIds.fr],
  );
  const staffProfileIds = { TEACHER: ids(), ADMIN: ids() };
  await q(
    `insert into staff_profiles (id, tenant_id, membership_id, employee_number, is_teacher) values
       ($1, $2, $3, 'ENS-0001', true), ($4, $2, $5, 'ADM-0001', false)`,
    [staffProfileIds.TEACHER, t, a.teacherMembershipId, staffProfileIds.ADMIN, a.adminMembershipId],
  );
  const courseIds = { math6a: ids(), fr6a: ids() };
  await q(
    `insert into course_offerings (id, tenant_id, subject_id, group_id, academic_year_id) values
       ($1, $2, $3, $5, $6), ($4, $2, $7, $5, $6)`,
    [courseIds.math6a, t, subjectIds.math, courseIds.fr6a, groupIds.sixA, a.yearId, subjectIds.fr],
  );
  await q(
    `insert into course_teachers (tenant_id, course_offering_id, staff_profile_id, role) values ($1, $2, $3, 'MAIN')`,
    [t, courseIds.math6a, staffProfileIds.TEACHER],
  );
  const slotId = ids();
  await q(
    `insert into schedule_slots (id, tenant_id, course_offering_id, weekday, start_time, end_time, room) values ($1, $2, $3, 1, '08:00', '10:00', 'Salle A1')`,
    [slotId, t, courseIds.math6a],
  );
  const sessionId = ids();
  await q(
    `insert into sessions (id, tenant_id, course_offering_id, schedule_slot_id, starts_at, ends_at, room) values ($1, $2, $3, $4, '2026-10-12T07:00:00Z', '2026-10-12T09:00:00Z', 'Salle A1')`,
    [sessionId, t, courseIds.math6a, slotId],
  );
  const importJobId = ids();
  await q(
    `insert into import_jobs (id, tenant_id, kind, dry_run, status, rows_total, rows_ok, rows_error, report, finished_at) values ($1, $2, 'STUDENTS', true, 'DONE', 0, 0, 0, '[]', now())`,
    [importJobId, t],
  );

  const people = [
    ['Aïcha', 'ADJOVI', '2014-03-12', 'F'],
    ['Koffi', 'AGBODJAN', '2013-11-02', 'M'],
    ['Mariam', 'SOSSOU', '2014-06-25', 'F'],
    ['Sèdjro', 'HOUNKPATIN', '2013-09-18', 'M'],
    ['Nadège', 'DOSSOU', '2012-01-30', 'F'],
  ] as const;
  const studentIds: string[] = [];
  for (const [i, [first, last, birth, gender]] of people.entries()) {
    const sid = ids();
    studentIds.push(sid);
    const left = i === 4;
    await q(
      `insert into students (id, tenant_id, matricule, first_name, last_name, birth_date, gender, status, left_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        sid,
        t,
        `2026-${String(i + 1).padStart(5, '0')}`,
        first,
        last,
        birth,
        gender,
        left ? 'LEFT' : 'ACTIVE',
        left ? '2026-10-01' : null,
      ],
    );
  }
  const enrollmentIds = { s1Class: ids(), s1Sub: ids() };
  const enroll = (
    eid: string,
    sid: string,
    gid: string,
    primary: boolean,
    leftAt: string | null = null,
  ) =>
    q(
      `insert into enrollments (id, tenant_id, student_id, group_id, academic_year_id, is_primary, enrolled_at, left_at) values ($1, $2, $3, $4, $5, $6, '2026-09-15', $7)`,
      [eid, t, sid, gid, a.yearId, primary, leftAt],
    );
  await enroll(enrollmentIds.s1Class, studentIds[0]!, groupIds.sixA, true);
  await enroll(enrollmentIds.s1Sub, studentIds[0]!, groupIds.sixA1, false);
  await enroll(ids(), studentIds[1]!, groupIds.sixA, true);
  await enroll(ids(), studentIds[2]!, groupIds.sixA, true);
  await enroll(ids(), studentIds[3]!, groupIds.sixB, true);
  await enroll(ids(), studentIds[4]!, groupIds.sixB, true, '2026-10-01');

  const parentPhone = `${a.phonePrefix}0001`;
  const parentEmail = `parent@${a.code}.local`;
  const parentUserId = await createUser(client, {
    email: parentEmail,
    displayName: `Parent (${a.code})`,
    passwordHash: a.passwordHash,
    phone: parentPhone,
  });
  const parentMembershipId = await createMembership(client, {
    userId: parentUserId,
    tenantId: t,
    kind: 'GUARDIAN',
  });
  const guardianIds = { parent: ids(), other: ids() };
  await q(
    `insert into guardians (id, tenant_id, user_id, first_name, last_name, phone_e164, invited_at) values
       ($1, $2, $3, 'Rosine', 'ADJOVI', $4, now()),
       ($5, $2, null, 'Pascal', 'SOSSOU', $6, null)`,
    [guardianIds.parent, t, parentUserId, parentPhone, guardianIds.other, `${a.phonePrefix}0002`],
  );
  const linkIds = { parentS1: ids(), parentS2: ids(), otherS3: ids() };
  await q(
    `insert into student_guardians (id, tenant_id, student_id, guardian_id, relationship, is_primary, can_view_finance, can_pay) values
       ($1, $2, $3, $4, 'MOTHER', true, true, true),
       ($5, $2, $6, $4, 'TUTOR', true, false, false),
       ($7, $2, $8, $9, 'FATHER', true, true, true)`,
    [
      linkIds.parentS1,
      t,
      studentIds[0],
      guardianIds.parent,
      linkIds.parentS2,
      studentIds[1],
      linkIds.otherS3,
      studentIds[2],
      guardianIds.other,
    ],
  );

  // --- Phase 3 : appel soumis sur la séance seedée, justificatif, alerte, notification ---
  const sheetId = ids();
  await q(
    `insert into attendance_sheets (id, tenant_id, session_id, status, version, submitted_by, submitted_at) values ($1, $2, $3, 'SUBMITTED', 2, null, '2026-10-12T09:05:00Z')`,
    [sheetId, t, sessionId],
  );
  await q(`update sessions set status = 'HELD' where id = $1`, [sessionId]);
  const recordIds = { s1: ids(), s2: ids(), s3: ids() };
  await q(
    `insert into attendance_records (id, tenant_id, sheet_id, session_id, student_id, status, excuse_status, late_minutes) values
       ($1, $2, $3, $4, $5, 'ABSENT', 'PENDING', null),
       ($6, $2, $3, $4, $7, 'LATE', 'NONE', 10),
       ($8, $2, $3, $4, $9, 'PRESENT', 'NONE', null)`,
    [
      recordIds.s1,
      t,
      sheetId,
      sessionId,
      studentIds[0],
      recordIds.s2,
      studentIds[1],
      recordIds.s3,
      studentIds[2],
    ],
  );
  const justificationId = ids();
  await q(
    `insert into absence_justifications (id, tenant_id, student_id, from_date, to_date, reason, status, submitted_by, submitted_by_kind) values ($1, $2, $3, '2026-10-12', '2026-10-12', 'Rendez-vous médical', 'PENDING', $4, 'GUARDIAN')`,
    [justificationId, t, studentIds[0], parentUserId],
  );
  await q(
    `insert into justification_records (tenant_id, justification_id, record_id) values ($1, $2, $3)`,
    [t, justificationId, recordIds.s1],
  );
  await q(
    `insert into attendance_daily_stats (tenant_id, student_id, day, sessions, present, absent, late, excused, unjustified) values
       ($1, $2, '2026-10-12', 1, 0, 1, 0, 0, 1), ($1, $3, '2026-10-12', 1, 0, 0, 1, 0, 0), ($1, $4, '2026-10-12', 1, 1, 0, 0, 0, 0)`,
    [t, studentIds[0], studentIds[1], studentIds[2]],
  );
  const alertId = ids();
  await q(
    `insert into attendance_alerts (id, tenant_id, student_id, kind, window_from, window_to, count) values ($1, $2, $3, 'REPEATED_ABSENCES', '2026-09-15', '2026-10-12', 3)`,
    [alertId, t, studentIds[0]],
  );
  const notificationId = ids();
  await q(
    `insert into notifications (id, tenant_id, event_id, kind, channel, status, recipient_user_id, student_id, title, body, action_url, sent_at) values
       ($1, $2, 'seed:absent', 'STUDENT_ABSENT', 'INAPP', 'SENT', $3, $4, 'Absence signalée', 'Aïcha absente en Mathématiques le 12/10.', '/children', now())`,
    [notificationId, t, parentUserId, studentIds[0]],
  );

  // --- Phase 4 : catalogue, créances, un paiement manuel avec reçu ---
  const categoryId = ids();
  await q(
    `insert into fee_categories (id, tenant_id, code, name) values ($1, $2, 'SCOLARITE', 'Scolarité')`,
    [categoryId, t],
  );
  const structureId = ids();
  await q(
    `insert into fee_structures (id, tenant_id, academic_year_id, category_id, code, name, total_amount, applies_to) values ($1, $2, $3, $4, 'SCOL-6E', 'Scolarité 6e', 150000, $5)`,
    [
      structureId,
      t,
      a.yearId,
      categoryId,
      JSON.stringify({ programIds: [], levelIds: [levelIds.sixieme], groupIds: [] }),
    ],
  );
  const schedule = [
    ['Tranche 1', 50000, '2026-10-01'],
    ['Tranche 2', 50000, '2027-01-10'],
    ['Tranche 3', 50000, '2027-04-01'],
  ] as const;
  for (const [i, [label, amount, due]] of schedule.entries())
    await q(
      `insert into fee_schedule_items (id, tenant_id, fee_structure_id, seq, label, amount, due_date) values ($1, $2, $3, $4, $5, $6, $7)`,
      [ids(), t, structureId, i + 1, label, amount, due],
    );
  const assignmentId = ids();
  await q(
    `insert into fee_assignments (id, tenant_id, fee_structure_id, target, targeted_count, created_count) values ($1, $2, $3, '{"seed":true}', 4, 4)`,
    [assignmentId, t, structureId],
  );
  const feeIds = { s1: ids(), s2: ids() };
  const installmentIds: { s1: string[]; s2: string[] } = { s1: [], s2: [] };
  for (const [idx, sid] of studentIds.slice(0, 4).entries()) {
    const feeId = idx === 0 ? feeIds.s1 : idx === 1 ? feeIds.s2 : ids();
    const paidFirst = idx === 0;
    await q(
      `insert into student_fees (id, tenant_id, student_id, fee_structure_id, academic_year_id, assignment_id, total_amount, amount_allocated, status) values ($1, $2, $3, $4, $5, $6, 150000, $7, $8)`,
      [
        feeId,
        t,
        sid,
        structureId,
        a.yearId,
        assignmentId,
        paidFirst ? 60000 : 0,
        paidFirst ? 'PARTIALLY_PAID' : 'OPEN',
      ],
    );
    for (const [i, [label, amount, due]] of schedule.entries()) {
      const instId = ids();
      if (idx === 0) installmentIds.s1.push(instId);
      if (idx === 1) installmentIds.s2.push(instId);
      const allocated = paidFirst ? (i === 0 ? 50000 : i === 1 ? 10000 : 0) : 0;
      const status =
        allocated === 50000
          ? 'PAID'
          : allocated > 0
            ? 'PARTIALLY_PAID'
            : i === 0
              ? 'OVERDUE'
              : 'PENDING';
      await q(
        `insert into installments (id, tenant_id, student_fee_id, student_id, seq, label, amount_due, amount_allocated, due_date, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [instId, t, feeId, sid, i + 1, label, amount, allocated, due, status],
      );
    }
  }
  const paymentId = ids();
  await q(
    `insert into payments (id, tenant_id, student_id, amount, source, method, payer_name, value_date, reference, recorded_by) values ($1, $2, $3, 60000, 'MANUAL', 'CASH', 'Rosine ADJOVI', '2026-10-02', 'BRD-0001', $4)`,
    [paymentId, t, studentIds[0], null],
  );
  await q(
    `insert into payment_allocations (id, tenant_id, payment_id, installment_id, amount) values ($1, $2, $3, $4, 50000), ($5, $2, $3, $6, 10000)`,
    [ids(), t, paymentId, installmentIds.s1[0], ids(), installmentIds.s1[1]],
  );
  const receiptNumber = `${a.code.toUpperCase()}-2026-000001`;
  await q(`insert into receipt_sequences (tenant_id, year, last_seq) values ($1, 2026, 1)`, [t]);
  await q(
    `insert into receipts (id, tenant_id, payment_id, kind, number, amount, currency, snapshot, verify_hash) values ($1, $2, $3, 'PAYMENT', $4, 60000, 'XOF', $5, 'seed')`,
    [
      ids(),
      t,
      paymentId,
      receiptNumber,
      JSON.stringify({
        tenant: { name: '', code: a.code },
        student: { firstName: 'Aïcha', lastName: 'ADJOVI', matricule: '2026-00001' },
        payment: {
          id: paymentId,
          amount: 60000,
          currency: 'XOF',
          method: 'CASH',
          valueDate: '2026-10-02',
          reference: 'BRD-0001',
          payerName: 'Rosine ADJOVI',
          recordedBy: null,
        },
        lines: [
          { feeName: 'Scolarité 6e', label: 'Tranche 1', amount: 50000 },
          { feeName: 'Scolarité 6e', label: 'Tranche 2', amount: 10000 },
        ],
        credit: 0,
      }),
    ],
  );

  // --- Phase 5 : compte marchand de démonstration (Option A), actif en sandbox ---
  const wrapper = new LocalKeyWrapper(
    process.env['PAYMENT_MASTER_KEY'] ?? 'dev-master-key-change-me-0123456789abcdef',
  );
  const configId = ids();
  const webhookToken = `seed-${a.code.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const webhookSecret = `whsec-${a.code.toLowerCase()}-demo`;
  await q(
    `insert into tenant_payment_configs (id, tenant_id, provider, mode, environment, public_key, credentials_encrypted, webhook_secret_encrypted, webhook_token, status, last_test_at, last_test_result)
     values ($1, $2, 'FAKE', 'OWN_ACCOUNT', 'SANDBOX', 'pk_fake_demo', $3, $4, $5, 'ACTIVE', now(), 'Provider de démonstration prêt')`,
    [
      configId,
      t,
      sealSecrets(wrapper, { secrets: {} }),
      sealSecrets(wrapper, { value: webhookSecret }),
      webhookToken,
    ],
  );

  const cancelledAttemptId = ids();
  await q(
    `insert into payment_attempts (id, tenant_id, student_id, guardian_id, payer_user_id, amount, currency, target_installment_ids, provider, status, external_id, checkout, expires_at, failure_code, failure_message, completed_at, metadata)
     values ($1, $2, $3, $4, $5, 40000, 'XOF', $6, 'FAKE', 'CANCELLED', $7, $8, now() - interval '1 day', 'CANCELLED', 'Vous avez annulé le paiement.', now() - interval '1 day', '{}')`,
    [
      cancelledAttemptId,
      t,
      studentIds[0],
      guardianIds.parent,
      parentUserId,
      [installmentIds.s1[1]],
      `fake_seed_${a.code.toLowerCase()}`,
      JSON.stringify({ kind: 'REDIRECT', url: 'http://localhost:3000/pay/fake/seed' }),
    ],
  );
  const reconciliationRunId = ids();
  await q(
    `insert into payment_reconciliation_runs (id, tenant_id, provider, day, status, checked, matched, orphans, mismatches)
     values ($1, $2, 'FAKE', (now() - interval '1 day')::date, 'OK', 0, 0, '[]', '[]')`,
    [reconciliationRunId, t],
  );

  // --- Phase 6 : rapport planifié et export de démonstration ---
  const scheduledReportId = ids();
  await q(
    `insert into scheduled_reports (id, tenant_id, report_key, cadence, day_of_period, recipients, filters, enabled, created_by)
     values ($1, $2, 'attendance-by-group', 'WEEKLY', 1, $3, '{}', true, $4)`,
    [scheduledReportId, t, [`direction@${a.code.toLowerCase()}.local`], parentUserId],
  );
  const exportId = ids();
  const demoZip = buildZip([{ name: 'README.txt', data: 'Export de démonstration Polaris\n' }]);
  await q(
    `insert into tenant_exports (id, tenant_id, status, started_at, finished_at, size_bytes, entries, file)
     values ($1, $2, 'DONE', now() - interval '2 days', now() - interval '2 days', $3, '[{"name":"README","rows":1}]', $4)`,
    [exportId, t, demoZip.length, demoZip],
  );

  return {
    yearId: a.yearId,
    programId,
    levelIds,
    groupIds,
    subjectIds,
    staffProfileIds,
    courseIds,
    slotId,
    sessionId,
    importJobId,
    studentIds,
    enrollmentIds,
    guardianIds,
    linkIds,
    parentUser: {
      userId: parentUserId,
      membershipId: parentMembershipId,
      email: parentEmail,
      phone: parentPhone,
    },
    attendance: { sheetId, recordIds, justificationId, alertId, notificationId },
    billing: { categoryId, structureId, feeIds, installmentIds, paymentId, receiptNumber },
    payments: { configId, webhookToken, webhookSecret, cancelledAttemptId, reconciliationRunId },
    reporting: { scheduledReportId, exportId },
  };
}

if (require.main === module) {
  const cs = process.env['DATABASE_URL_PLATFORM'];
  if (!cs) {
    console.error('DATABASE_URL_PLATFORM requis');
    process.exit(1);
  }
  seedDatabase(cs).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
