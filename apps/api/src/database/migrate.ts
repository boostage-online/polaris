/**
 * Exécuteur de migrations SQL (expand → migrate → contract, Partie 14).
 *
 *   tsx src/database/migrate.ts up      — applique les migrations manquantes
 *   tsx src/database/migrate.ts down    — annule la dernière migration appliquée
 *   tsx src/database/migrate.ts status  — liste l'état
 *
 * Fichiers : migrations/NNNN_nom.up.sql et NNNN_nom.down.sql. Chaque migration tourne dans une
 * transaction, sauf si le fichier commence par `-- no-transaction` (index CONCURRENTLY).
 * Verrou pg_advisory_lock pour qu'une seule instance migre à la fois.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

const LOCK_KEY = 7_419_201;

export interface MigrateOptions {
  connectionString: string;
  dir?: string;
  log?: (msg: string) => void;
}

function migrationsDir(dir?: string) {
  if (dir) return dir;
  const candidates = [resolve(__dirname, '../../migrations'), resolve(__dirname, '../migrations')];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`Dossier migrations introuvable (${candidates.join(', ')})`);
  return found;
}

function listMigrations(dir: string) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.replace(/\.up\.sql$/, ''))
    .sort();
}

async function withClient<T>(connectionString: string, fn: (c: Client) => Promise<T>) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    return await fn(client);
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

async function runSql(client: Client, sqlText: string) {
  const noTx = /^--\s*no-transaction\b/m.test(sqlText);
  if (noTx) {
    await client.query(sqlText);
    return;
  }
  await client.query('begin');
  try {
    await client.query(sqlText);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

export async function migrateUp(opts: MigrateOptions): Promise<string[]> {
  const dir = migrationsDir(opts.dir);
  const log = opts.log ?? (() => undefined);
  return withClient(opts.connectionString, async (client) => {
    const applied = new Set(
      (await client.query<{ name: string }>('select name from schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    const done: string[] = [];
    for (const name of listMigrations(dir)) {
      if (applied.has(name)) continue;
      const sqlText = readFileSync(join(dir, `${name}.up.sql`), 'utf8');
      log(`↑ ${name}`);
      await runSql(client, sqlText);
      await client.query('insert into schema_migrations (name) values ($1)', [name]);
      done.push(name);
    }
    return done;
  });
}

export async function migrateDown(opts: MigrateOptions, steps = 1): Promise<string[]> {
  const dir = migrationsDir(opts.dir);
  const log = opts.log ?? (() => undefined);
  return withClient(opts.connectionString, async (client) => {
    const rows = (
      await client.query<{ name: string }>(
        'select name from schema_migrations order by name desc limit $1',
        [steps],
      )
    ).rows;
    const done: string[] = [];
    for (const { name } of rows) {
      const file = join(dir, `${name}.down.sql`);
      if (!existsSync(file)) throw new Error(`${name} : pas de .down.sql (migration irréversible)`);
      log(`↓ ${name}`);
      await runSql(client, readFileSync(file, 'utf8'));
      await client.query('delete from schema_migrations where name = $1', [name]);
      done.push(name);
    }
    return done;
  });
}

export async function migrateStatus(opts: MigrateOptions) {
  const dir = migrationsDir(opts.dir);
  return withClient(opts.connectionString, async (client) => {
    const applied = new Map(
      (
        await client.query<{ name: string; applied_at: Date }>(
          'select name, applied_at from schema_migrations',
        )
      ).rows.map((r) => [r.name, r.applied_at]),
    );
    return listMigrations(dir).map((name) => ({ name, appliedAt: applied.get(name) ?? null }));
  });
}

if (require.main === module) {
  const cmd = process.argv[2] ?? 'up';
  const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL_PLATFORM;
  if (!connectionString) {
    console.error('DATABASE_URL_PLATFORM (ou MIGRATION_DATABASE_URL) est requis pour migrer');
    process.exit(1);
  }
  const log = (m: string) => console.warn(m);
  const run = async () => {
    if (cmd === 'up') {
      const done = await migrateUp({ connectionString, log });
      log(done.length ? `✔ ${done.length} migration(s) appliquée(s)` : '✔ base à jour');
    } else if (cmd === 'down') {
      const done = await migrateDown({ connectionString, log }, Number(process.argv[3] ?? 1));
      log(`✔ ${done.length} migration(s) annulée(s)`);
    } else if (cmd === 'status') {
      for (const s of await migrateStatus({ connectionString })) {
        log(
          `${s.appliedAt ? '✔' : '·'} ${s.name}${s.appliedAt ? `  (${s.appliedAt.toISOString()})` : ''}`,
        );
      }
    } else {
      throw new Error(`commande inconnue : ${cmd}`);
    }
  };
  run().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
