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
