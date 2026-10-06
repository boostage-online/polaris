import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { SYSTEM_ROLE_CODES, type SystemRoleCode } from '@polaris/contracts';
import { collectRoutes } from '../src/openapi/build';
import {
  bearer,
  loginAs,
  loginPlatform,
  seed,
  startApp,
  type Session,
  type TestContext,
} from './helpers';

interface MatrixEntry {
  scope?: 'identity' | 'platform';
  allow?: SystemRoleCode[];
}
const matrix = (
  parse(readFileSync(resolve(__dirname, 'permissions-matrix.yaml'), 'utf8')) as {
    routes: Record<string, MatrixEntry>;
  }
).routes;

/** Paramètres et corps valides pour le tenant « univ » (les mutations y sont sans conséquence sur les autres tests). */
const T = () => seed.tenants.univ;
const params: Record<string, () => string> = {
  id: () => T().roleIds.TEACHER,
  membershipId: () => T().users.TEACHER.membershipId,
  familyId: () => '00000000-0000-0000-0000-000000000000',
};
const bodies: Record<string, () => unknown> = {
  'PATCH /api/v1/tenant/settings': () => ({ attendance: { lateToAbsentMinutes: 30 } }),
  'PATCH /api/v1/roles/:id/permissions': () => ({
    permissions: ['VIEW_ATTENDANCE', 'TAKE_ATTENDANCE', 'EDIT_ATTENDANCE', 'VIEW_STUDENTS'],
  }),
  'POST /api/v1/roles/:id/duplicate': () => ({
    name: `Matrice ${Math.random().toString(36).slice(2, 8)}`,
  }),
  'PUT /api/v1/members/:membershipId/roles': () => ({ roleIds: [T().roleIds.TEACHER] }),
  'POST /api/v1/members/invitations': () => ({
    email: `m-${Math.random().toString(36).slice(2, 8)}@univ-demo.local`,
    displayName: 'Matrice',
    roleIds: [T().roleIds.TEACHER],
  }),
  'POST /api/v1/auth/switch-membership': () => ({
    membershipId: '00000000-0000-0000-0000-000000000000',
  }),
  'POST /api/v1/platform/tenants': () => ({
    code: `mx-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Matrice',
    type: 'SCHOOL',
  }),
  'PATCH /api/v1/platform/tenants/:id/status': () => ({ status: 'ACTIVE' }),
  'POST /api/v1/platform/tenants/:id/admin-invitations': () => ({ email: 'mx@example.com' }),
};

describe('Matrice de permissions', () => {
  let ctx: TestContext;
  const sessions = {} as Record<SystemRoleCode, Session>;
  let platform: Session;
  beforeAll(async () => {
    ctx = await startApp();
    for (const role of SYSTEM_ROLE_CODES) sessions[role] = await loginAs(ctx, 'univ', role);
    platform = await loginPlatform(ctx);
  });
  afterAll(() => ctx.close());

  it('chaque route non publique a une entrée dans permissions-matrix.yaml', () => {
    const routes = collectRoutes(ctx.app).filter((r) => !r.isPublic);
    const missing = routes
      .map((r) => `${r.method.toUpperCase()} ${r.path}`)
      .filter((k) => !matrix[k]);
    expect(missing, `routes absentes de la matrice :\n${missing.join('\n')}`).toEqual([]);
    const stale = Object.keys(matrix).filter(
      (k) => !routes.some((r) => `${r.method.toUpperCase()} ${r.path}` === k),
    );
    expect(stale, `entrées obsolètes : ${stale.join(', ')}`).toEqual([]);
  });

  it('les routes répondent conformément à la matrice pour chaque rôle système', async () => {
    const routes = collectRoutes(ctx.app).filter((r) => !r.isPublic);
    const failures: string[] = [];
    for (const r of routes) {
      const key = `${r.method.toUpperCase()} ${r.path}`;
      const entry = matrix[key]!;
      const path = r.path.replace(/:([A-Za-z0-9_]+)/g, (_m, n: string) => {
        const f = params[n];
        if (!f) throw new Error(`fixture manquante pour :${n}`);
        return f();
      });
      // Routes de déconnexion : on ne les joue qu'avec un rôle (elles invalident la session).
      const roles = key.includes('logout-all')
        ? (['DIRECTION'] as SystemRoleCode[])
        : SYSTEM_ROLE_CODES;
      for (const role of roles) {
        const req = ctx.http[r.method](path).set(bearer(sessions[role]));
        const res = bodies[key] ? await req.send(bodies[key]!()) : await req.send();
        const expectedDeny =
          entry.scope === 'platform'
            ? 404
            : entry.scope === 'identity'
              ? null
              : entry.allow?.includes(role)
                ? null
                : 403;
        if (expectedDeny === null) {
          if (res.status === 401 || res.status === 403)
            failures.push(`${key} [${role}] attendu autorisé, reçu ${res.status}`);
        } else if (res.status !== expectedDeny) {
          failures.push(`${key} [${role}] attendu ${expectedDeny}, reçu ${res.status}`);
        }
      }
      if (entry.scope === 'platform') {
        const req = ctx.http[r.method](path).set(bearer(platform));
        const res = bodies[key] ? await req.send(bodies[key]!()) : await req.send();
        if (res.status === 401 || res.status === 403 || res.status === 404)
          failures.push(`${key} [PLATFORM] attendu autorisé, reçu ${res.status}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('sans jeton, toute route non publique répond 401', async () => {
    const routes = collectRoutes(ctx.app).filter((r) => !r.isPublic);
    for (const r of routes) {
      const path = r.path.replace(
        /:([A-Za-z0-9_]+)/g,
        () => '00000000-0000-0000-0000-000000000000',
      );
      const res = await ctx.http[r.method](path).send({});
      expect(res.status, `${r.method.toUpperCase()} ${path}`).toBe(401);
    }
  });
});
