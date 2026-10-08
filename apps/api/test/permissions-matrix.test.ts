import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
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
  tenantId: () => T().id,
  membershipId: () => T().users.TEACHER.membershipId,
  studentId: () => T().academic.studentIds[0]!,
  paymentId: () => T().academic.billing.paymentId,
  attemptId: () => T().academic.payments.cancelledAttemptId,
  provider: () => 'FAKE',
  key: () => 'attendance-by-group',
  familyId: () => '00000000-0000-0000-0000-000000000000',
  impersonationId: () => seed.platform.impersonationSessionId,
  alertId: () => seed.platform.alertId,
  day: () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
  // Réinitialisation de MFA : un compte jetable, pour ne révoquer les sessions de personne d'autre.
  throwawayUserId: () => throwaway.userId,
  throwawayMembershipId: () => throwaway.membershipId,
};
const throwaway = { userId: '', membershipId: '' };
const bodies: Record<string, () => object> = {
  'POST /api/v1/platform/tenants/:id/impersonate': () => ({
    reason: 'Matrice de permissions : vérification',
  }),
  'POST /api/v1/privacy/students/:id/anonymize': () => ({ reason: 'Matrice de permissions' }),
  'POST /api/v1/privacy/guardians/:id/anonymize': () => ({ reason: 'Matrice de permissions' }),
  'PATCH /api/v1/onboarding': () => ({ dismissed: false }),
  'PATCH /api/v1/platform/tenants/:id/launch/checklist': () => ({}),
  'POST /api/v1/platform/tenants/:id/launch/go-live': () => ({ plan: 'PILOT', checklist: {} }),
  'POST /api/v1/platform/reviews/:day/ack': () => ({ notes: 'Matrice de permissions' }),
  'POST /api/v1/platform/support/unlock': () => ({ identifier: 'matrice@example.com' }),
  'POST /api/v1/platform/support/users/:id/mfa-reset': () => ({ reason: 'Matrice de permissions' }),
  'POST /api/v1/members/:membershipId/mfa-reset': () => ({ reason: 'Matrice de permissions' }),
  'POST /api/v1/me/mfa/enable': () => ({ code: '000000' }),
  'POST /api/v1/me/mfa/disable': () => ({ code: '000000' }),
  'POST /api/v1/me/mfa/recovery-codes': () => ({ code: '000000' }),
  'POST /api/v1/scheduled-reports': () => ({
    reportKey: 'attendance-by-group',
    cadence: 'WEEKLY',
    dayOfPeriod: 1,
    recipients: ['direction@example.com'],
  }),
  'PATCH /api/v1/scheduled-reports/:id': () => ({ enabled: true }),
  'POST /api/v1/reports/refresh': () => ({}),
  'PUT /api/v1/payment-config': () => ({
    provider: 'FAKE',
    environment: 'SANDBOX',
    credentials: {},
  }),
  'PATCH /api/v1/payment-config/:provider/status': () => ({ status: 'ACTIVE' }),
  'POST /api/v1/payment-attempts/:id/resolve': () => ({ note: 'Matrice de permissions' }),
  'POST /api/v1/payment-reconciliation/run': () => ({}),
  'POST /api/v1/payment-reconciliation/:id/orphans/resolve': () => ({
    externalId: 'x',
    note: 'Matrice',
  }),
  'POST /api/v1/dev/fake-provider/outage': () => ({ on: false }),
  'POST /api/v1/me/children/:studentId/payment-attempts': () => ({ amount: 1000 }),
  'POST /api/v1/me/children/:studentId/payment-attempts/:attemptId/confirm': () => ({}),
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
    throwaway.userId = randomUUID();
    throwaway.membershipId = randomUUID();
    await ctx.owner.query(
      `insert into users (id, email, display_name, mfa_enabled) values ($1, $2, 'Compte jetable (matrice)', false)`,
      [throwaway.userId, `matrice-${throwaway.userId.slice(0, 8)}@${T().code}.local`],
    );
    await ctx.owner.query(
      `insert into memberships (id, user_id, tenant_id, kind, status, accepted_at) values ($1, $2, $3, 'STAFF', 'ACTIVE', now())`,
      [throwaway.membershipId, throwaway.userId, T().id],
    );
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
    // logout-all invalide toutes les sessions de l'utilisateur (token_version) : joué en dernier, séparément.
    const routes = collectRoutes(ctx.app).filter(
      (r) => !r.isPublic && !r.path.includes('logout-all'),
    );
    const failures: string[] = [];
    for (const r of routes) {
      const key = `${r.method.toUpperCase()} ${r.path}`;
      const entry = matrix[key]!;
      const path = r.path.replace(/:([A-Za-z0-9_]+)/g, (_m, n: string) => {
        const f =
          params[
            n === 'id' && r.path.startsWith('/api/v1/platform/tenants')
              ? 'tenantId'
              : n === 'id' && r.path.startsWith('/api/v1/platform/impersonations')
                ? 'impersonationId'
                : n === 'id' && r.path.startsWith('/api/v1/platform/alerts')
                  ? 'alertId'
                  : n === 'id' && r.path.startsWith('/api/v1/platform/support/users')
                    ? 'throwawayUserId'
                    : n === 'membershipId' && r.path.endsWith('mfa-reset')
                      ? 'throwawayMembershipId'
                      : n
          ];
        if (!f) throw new Error(`fixture manquante pour :${n}`);
        return f();
      });
      for (const role of SYSTEM_ROLE_CODES) {
        const req = ctx.http[r.method](path).set(bearer(sessions[role]));
        const body = bodies[key];
        const res = body ? await req.send(body()) : await req.send();
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
        const body = bodies[key];
        const res = body ? await req.send(body()) : await req.send();
        if (res.status === 401 || res.status === 403 || res.status === 404)
          failures.push(`${key} [PLATFORM] attendu autorisé, reçu ${res.status}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
    const fresh = await loginAs(ctx, 'univ', 'DIRECTION');
    expect((await ctx.http.post('/api/v1/auth/logout-all').set(bearer(fresh))).status).toBe(204);
  }, 120_000);

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
