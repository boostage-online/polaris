/**
 * Prépare la base de test : schéma vide → migrations → seed. Exécuté une fois par run vitest.
 * Variables :
 *   DATABASE_URL_TEST      (propriétaire, migrations)          défaut postgres://polaris_owner:polaris@localhost:5432/polaris_test
 *   DATABASE_URL_TEST_APP  (rôle applicatif sans BYPASSRLS)   défaut postgres://polaris_app:polaris_app@localhost:5432/polaris_test
 *   REDIS_URL                                                   défaut redis://localhost:6379
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { migrateUp } from '../src/database/migrate';
import { seedDatabase } from '../src/seed/seed';

export const TEST_OWNER_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://polaris_owner:polaris@localhost:5432/polaris_test';
export const TEST_APP_URL =
  process.env['DATABASE_URL_TEST_APP'] ??
  'postgres://polaris_app:polaris_app@localhost:5432/polaris_test';
export const SEED_FILE = resolve(__dirname, '../.test-seed.json');

export default async function setup() {
  const client = new Client({ connectionString: TEST_OWNER_URL });
  await client.connect();
  await client.query('drop schema public cascade; create schema public;');
  await client.query(`do $$ begin
    if exists (select 1 from pg_roles where rolname = 'polaris_app') then grant all on schema public to polaris_app; end if;
    if exists (select 1 from pg_roles where rolname = 'polaris_platform') then grant all on schema public to polaris_platform; end if;
  end $$;`);
  await client.end();
  await migrateUp({ connectionString: TEST_OWNER_URL });
  const seed = await seedDatabase(TEST_OWNER_URL, { quiet: true });
  mkdirSync(resolve(__dirname, '..'), { recursive: true });
  writeFileSync(SEED_FILE, JSON.stringify(seed));
}
