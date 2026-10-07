/**
 * Premier administrateur plateforme d'un environnement neuf (production, staging).
 *
 *   node dist/cli/bootstrap-admin.js <e-mail> [nom affiché]
 *
 * Le mot de passe est lu dans la variable BOOTSTRAP_PASSWORD (jamais en argument : il resterait dans
 * l'historique du shell) ; s'il est absent, un mot de passe de 20 caractères est généré et affiché une
 * seule fois. L'opération est idempotente : un compte existant voit son mot de passe remplacé et son
 * appartenance plateforme (ré)activée. La MFA est exigée à la première connexion sur toute route plateforme :
 * l'enrôlement se fait depuis « Sécurité du compte ».
 */
import argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  const displayName = process.argv[3]?.trim() || 'Administrateur plateforme';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(
      'Usage : bootstrap-admin <e-mail> [nom affiché]   (BOOTSTRAP_PASSWORD facultatif)',
    );
    process.exit(2);
  }
  const connectionString = process.env['DATABASE_URL_PLATFORM'] ?? process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL_PLATFORM manquante');
    process.exit(2);
  }
  const generated = !process.env['BOOTSTRAP_PASSWORD'];
  const password =
    process.env['BOOTSTRAP_PASSWORD'] ?? randomBytes(15).toString('base64url').slice(0, 20);
  if (password.length < 10) {
    console.error('BOOTSTRAP_PASSWORD : 10 caractères minimum');
    process.exit(2);
  }
  // Mêmes paramètres argon2id que PasswordService (ADR-0008 : m = 64 Mo, t = 3, p = 4).
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 4,
  });
  const client = new Client({ connectionString });
  await client.connect();
  let wasExisting = false;
  try {
    await client.query('begin');
    const existing = await client.query<{ id: string }>(
      'select id from users where lower(email) = $1',
      [email],
    );
    let userId = existing.rows[0]?.id;
    wasExisting = Boolean(userId);
    if (userId) {
      await client.query(
        `update users set password_hash = $2, status = 'ACTIVE', display_name = coalesce(display_name, $3), token_version = token_version + 1 where id = $1`,
        [userId, hash, displayName],
      );
    } else {
      userId = randomUUID();
      await client.query(
        `insert into users (id, email, password_hash, display_name, status) values ($1, $2, $3, $4, 'ACTIVE')`,
        [userId, email, hash, displayName],
      );
    }
    const membership = await client.query<{ id: string }>(
      `select id from memberships where user_id = $1 and kind = 'PLATFORM'`,
      [userId],
    );
    if (membership.rows[0]) {
      await client.query(`update memberships set status = 'ACTIVE' where id = $1`, [
        membership.rows[0].id,
      ]);
    } else {
      await client.query(
        `insert into memberships (id, user_id, tenant_id, kind, status, accepted_at) values ($1, $2, null, 'PLATFORM', 'ACTIVE', now())`,
        [randomUUID(), userId],
      );
    }
    await client.query(
      `insert into audit_logs (id, tenant_id, actor_user_id, action, entity_type, entity_id, after)
       values ($1, null, $2, 'platform.admin_bootstrapped', 'User', $2, $3::jsonb)`,
      [randomUUID(), userId, JSON.stringify({ email, existing: wasExisting })],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
  console.warn(
    `✔ administrateur plateforme ${email} prêt (${wasExisting ? 'compte existant mis à jour' : 'compte créé'})`,
  );
  if (generated) {
    console.warn(
      `  mot de passe (affiché une seule fois, à changer dès la première connexion) : ${password}`,
    );
  }
  console.warn(
    '  Première connexion : activer la MFA depuis « Sécurité du compte » avant toute action plateforme.',
  );
}

main().catch((e: unknown) => {
  console.error('échec :', (e as Error).message);
  process.exit(1);
});
