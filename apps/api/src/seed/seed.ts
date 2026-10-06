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

export interface SeededTenant {
  id: string;
  code: string;
  roleIds: Record<SystemRoleCode, string>;
  users: Record<SystemRoleCode, { userId: string; membershipId: string; email: string }>;
}
export interface SeedResult {
  platformAdmin: { userId: string; membershipId: string; email: string };
  tenants: Record<'lycee' | 'univ', SeededTenant>;
}

const ARGON = { type: argon2.argon2id, memoryCost: 8 * 1024, timeCost: 1, parallelism: 1 } as const; // léger : seed uniquement

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
  await client.query(
    `insert into academic_years (id, tenant_id, label, start_date, end_date, is_current) values ($1, $2, '2026-2027', '2026-09-15', '2027-07-15', true)`,
    [randomUUID(), id],
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
  return { id, code: t.code, roleIds, users };
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
