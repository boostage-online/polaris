import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { seed } from './helpers';
import { TEST_APP_URL, TEST_OWNER_URL } from './global-setup';

/** Garanties ADR-0002 vérifiées directement en SQL, sans passer par l'API. */
describe('Row-Level Security', () => {
  let app: Pool;
  let owner: Pool;
  beforeAll(() => {
    app = new Pool({ connectionString: TEST_APP_URL, max: 2 });
    owner = new Pool({ connectionString: TEST_OWNER_URL, max: 2 });
  });
  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  it('toute table portant tenant_id a RLS activée et une policy, sauf exemptions déclarées', async () => {
    const { rows } = await owner.query<{
      table_name: string;
      rowsecurity: boolean;
      policies: number;
      exempt: boolean;
    }>(`
      select c.table_name,
             t.rowsecurity,
             (select count(*)::int from pg_policies p where p.tablename = c.table_name) as policies,
             exists (select 1 from rls_exemptions e where e.table_name = c.table_name) as exempt
      from information_schema.columns c
      join pg_tables t on t.tablename = c.table_name and t.schemaname = 'public'
      where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> 'tenants'`);
    const violations = rows
      .filter((r) => !r.exempt && (!r.rowsecurity || r.policies === 0))
      .map((r) => r.table_name);
    expect(violations, `tables sans RLS : ${violations.join(', ')}`).toEqual([]);
    expect(rows.length).toBeGreaterThan(5);
  });

  it('le rôle applicatif ne peut pas contourner RLS', async () => {
    const { rows } = await app.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      `select rolbypassrls, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('sans contexte tenant, une requête renvoie zéro ligne (pas une erreur, pas les voisins)', async () => {
    const { rows } = await app.query('select count(*)::int as n from roles');
    expect(rows[0].n).toBe(0);
  });

  it('avec SET LOCAL app.tenant_id, seules les lignes du tenant sont visibles', async () => {
    const c = await app.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [seed.tenants.lycee.id]);
      const { rows } = await c.query<{ tenant_id: string }>('select distinct tenant_id from roles');
      expect(rows).toEqual([{ tenant_id: seed.tenants.lycee.id }]);
      const other = await c.query('select count(*)::int as n from roles where tenant_id = $1', [
        seed.tenants.univ.id,
      ]);
      expect(other.rows[0].n).toBe(0);
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  it('une insertion pour un autre tenant est refusée par la policy WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [seed.tenants.lycee.id]);
      await expect(
        c.query(`insert into campuses (tenant_id, name) values ($1, 'intrus')`, [
          seed.tenants.univ.id,
        ]),
      ).rejects.toThrow(/row-level security/);
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  it('les clés étrangères composites empêchent de rattacher un rôle du tenant B à un membre du tenant A', async () => {
    await expect(
      owner.query(
        `insert into membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`,
        [
          seed.tenants.lycee.id,
          seed.tenants.lycee.users.TEACHER.membershipId,
          seed.tenants.univ.roleIds.TEACHER,
        ],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('audit_logs est append-only', async () => {
    const { rows } = await owner.query<{ id: string }>('select id from audit_logs limit 1');
    if (rows.length === 0) {
      await owner.query(
        `insert into audit_logs (tenant_id, action, entity_type) values ($1, 'test', 'Test')`,
        [seed.tenants.lycee.id],
      );
    }
    const id = (await owner.query<{ id: string }>('select id from audit_logs limit 1')).rows[0].id;
    await expect(
      owner.query(`update audit_logs set action = 'x' where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(owner.query(`delete from audit_logs where id = $1`, [id])).rejects.toThrow(
      /append-only/,
    );
  });
});
