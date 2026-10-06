import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectRoutes } from '../src/openapi/build';
import { bearer, loginAs, seed, startApp, type Session, type TestContext } from './helpers';

/**
 * Test générique d'isolation (ADR-0002, Partie 13) : pour CHAQUE route tenant portant un identifiant,
 * un administrateur du tenant B appelle la route avec un identifiant du tenant A et doit recevoir 404
 * (jamais 200, jamais 403). Une route nouvelle sans entrée dans `fixtures` fait échouer le test.
 */
describe('Isolation inter-tenant', () => {
  let ctx: TestContext;
  let admB: Session;
  beforeAll(async () => {
    ctx = await startApp();
    admB = await loginAs(ctx, 'univ', 'ADMIN');
  });
  afterAll(() => ctx.close());

  const A = () => seed.tenants.lycee;

  /** Identifiants du tenant A et corps minimal valide, par nom de paramètre. */
  const params: Record<string, () => string> = {
    id: () => A().roleIds.TEACHER,
    membershipId: () => A().users.TEACHER.membershipId,
  };
  const bodies: Record<string, () => object> = {
    'PATCH /api/v1/roles/:id/permissions': () => ({ permissions: ['VIEW_STUDENTS'] }),
    'POST /api/v1/roles/:id/duplicate': () => ({ name: `Copie ${Date.now()}` }),
    'PUT /api/v1/members/:membershipId/roles': () => ({ roleIds: [A().roleIds.TEACHER] }),
  };

  it('toutes les routes tenant avec identifiant répondent 404 pour une ressource du tenant A', async () => {
    const routes = collectRoutes(ctx.app).filter(
      (r) => !r.isPublic && r.scope === 'tenant' && r.path.includes(':'),
    );
    expect(routes.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const r of routes) {
      const key = `${r.method.toUpperCase()} ${r.path}`;
      const path = r.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
        const f = params[name];
        if (!f) throw new Error(`Aucune fixture pour le paramètre :${name} (${key})`);
        return f();
      });
      const req = ctx.http[r.method](path).set(bearer(admB));
      const res = bodies[key] ? await req.send(bodies[key]!()) : await req.send();
      if (res.status !== 404) failures.push(`${key} → ${res.status}`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('GET /tenant renvoie uniquement son propre établissement', async () => {
    const res = await ctx.http.get('/api/v1/tenant').set(bearer(admB));
    expect(res.body.data.id).toBe(seed.tenants.univ.id);
  });

  it('les listes ne contiennent que des objets du tenant courant', async () => {
    const roles = await ctx.http.get('/api/v1/roles').set(bearer(admB));
    expect(roles.status).toBe(200);
    const ids = new Set((roles.body.data as { id: string }[]).map((r) => r.id));
    for (const id of Object.values(seed.tenants.lycee.roleIds)) expect(ids.has(id)).toBe(false);
    for (const id of Object.values(seed.tenants.univ.roleIds)) expect(ids.has(id)).toBe(true);

    const members = await ctx.http.get('/api/v1/members').set(bearer(admB));
    const emails = (members.body.data as { email: string }[]).map((m) => m.email);
    expect(emails.every((e) => e.endsWith('@univ-demo.local'))).toBe(true);
  });

  it("le journal d'audit ne montre pas les actions des autres tenants", async () => {
    await ctx.owner.query(
      `insert into audit_logs (tenant_id, action, entity_type, entity_id) values ($1, 'isolation.probe', 'Probe', 'A')`,
      [seed.tenants.lycee.id],
    );
    const res = await ctx.http.get('/api/v1/audit-logs?limit=200').set(bearer(admB));
    expect(res.status).toBe(200);
    expect(
      (res.body.data as { action: string }[]).some((l) => l.action === 'isolation.probe'),
    ).toBe(false);
  });
});
