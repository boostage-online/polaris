import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, loginAs, seed, startApp, type TestContext } from './helpers';

describe('RBAC (ADR-0007)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(() => ctx.close());

  it("un enseignant n'a pas MANAGE_ROLES → 403 avec code FORBIDDEN", async () => {
    const t = await loginAs(ctx, 'lycee', 'TEACHER');
    const res = await ctx.http
      .patch(`/api/v1/roles/${seed.tenants.lycee.roleIds.TEACHER}/permissions`)
      .set(bearer(t))
      .send({ permissions: ['VIEW_STUDENTS'] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('le rôle Administrateur est verrouillé', async () => {
    const a = await loginAs(ctx, 'lycee', 'ADMIN');
    const res = await ctx.http
      .patch(`/api/v1/roles/${seed.tenants.lycee.roleIds.ADMIN}/permissions`)
      .set(bearer(a))
      .send({ permissions: ['VIEW_STUDENTS'] });
    expect(res.status).toBe(409);
  });

  it('une permission plateforme ne peut pas être donnée à un rôle tenant', async () => {
    const a = await loginAs(ctx, 'lycee', 'ADMIN');
    const res = await ctx.http
      .patch(`/api/v1/roles/${seed.tenants.lycee.roleIds.TEACHER}/permissions`)
      .set(bearer(a))
      .send({ permissions: ['PLATFORM_MANAGE_TENANTS'] });
    expect(res.status).toBe(422);
  });

  it('on ne peut pas retirer MANAGE_ROLES au dernier détenteur', async () => {
    const a = await loginAs(ctx, 'lycee', 'ADMIN');
    const res = await ctx.http
      .put(`/api/v1/members/${seed.tenants.lycee.users.ADMIN.membershipId}/roles`)
      .set(bearer(a))
      .send({ roleIds: [seed.tenants.lycee.roleIds.TEACHER] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_ROLE_HOLDER');
  });

  it("un changement de permissions d'un rôle est effectif immédiatement, sans nouveau token (cache versionné)", async () => {
    const admin = await loginAs(ctx, 'lycee', 'ADMIN');
    const teacher = await loginAs(ctx, 'lycee', 'TEACHER');
    const roleId = seed.tenants.lycee.roleIds.TEACHER;

    expect((await ctx.http.get('/api/v1/audit-logs').set(bearer(teacher))).status).toBe(403);
    const grant = await ctx.http
      .patch(`/api/v1/roles/${roleId}/permissions`)
      .set(bearer(admin))
      .send({
        permissions: [
          'VIEW_ATTENDANCE',
          'TAKE_ATTENDANCE',
          'EDIT_ATTENDANCE',
          'VIEW_STUDENTS',
          'VIEW_AUDIT_LOG',
        ],
      });
    expect(grant.status).toBe(200);
    expect((await ctx.http.get('/api/v1/audit-logs').set(bearer(teacher))).status).toBe(200);

    const revoke = await ctx.http
      .patch(`/api/v1/roles/${roleId}/permissions`)
      .set(bearer(admin))
      .send({
        permissions: ['VIEW_ATTENDANCE', 'TAKE_ATTENDANCE', 'EDIT_ATTENDANCE', 'VIEW_STUDENTS'],
      });
    expect(revoke.status).toBe(200);
    expect((await ctx.http.get('/api/v1/audit-logs').set(bearer(teacher))).status).toBe(403);

    const audit = await ctx.http.get('/api/v1/audit-logs?entityType=Role').set(bearer(admin));
    const entry = (
      audit.body.data as {
        action: string;
        before: { permissions: string[] };
        after: { permissions: string[] };
      }[]
    ).find((l) => l.action === 'role.permissions_updated');
    expect(entry?.before.permissions).toContain('VIEW_AUDIT_LOG');
    expect(entry?.after.permissions).not.toContain('VIEW_AUDIT_LOG');
  });

  it("attribuer des rôles à un membre : audit before/after et événement RoleChanged dans l'outbox", async () => {
    const admin = await loginAs(ctx, 'lycee', 'ADMIN');
    const m = seed.tenants.lycee.users.REGISTRAR.membershipId;
    const res = await ctx.http
      .put(`/api/v1/members/${m}/roles`)
      .set(bearer(admin))
      .send({
        roleIds: [seed.tenants.lycee.roleIds.REGISTRAR, seed.tenants.lycee.roleIds.STUDENT_LIFE],
      });
    expect(res.status).toBe(200);
    const reg = await loginAs(ctx, 'lycee', 'REGISTRAR');
    const me = await ctx.http.get('/api/v1/me').set(bearer(reg));
    expect(me.body.data.permissions).toContain('REVIEW_JUSTIFICATION');
    const { rows } = await ctx.owner.query(
      `select count(*)::int as n from outbox_events where event_type = 'RoleChanged' and aggregate_id = $1`,
      [m],
    );
    expect(rows[0].n).toBe(1);
  });

  it('dupliquer un rôle crée un rôle modifiable avec les mêmes permissions', async () => {
    const admin = await loginAs(ctx, 'lycee', 'ADMIN');
    const res = await ctx.http
      .post(`/api/v1/roles/${seed.tenants.lycee.roleIds.ADMIN}/duplicate`)
      .set(bearer(admin))
      .send({ name: 'Adjoint de direction' });
    expect(res.status).toBe(201);
    expect(res.body.data.systemCode).toBeNull();
    expect(res.body.data.permissions).toContain('MANAGE_ROLES');
    const dup = await ctx.http
      .post(`/api/v1/roles/${seed.tenants.lycee.roleIds.ADMIN}/duplicate`)
      .set(bearer(admin))
      .send({ name: 'Adjoint de direction' });
    expect(dup.status).toBe(409);
  });

  it('invitation : création, e-mail via le worker (événement outbox), acceptation et connexion', async () => {
    const admin = await loginAs(ctx, 'lycee', 'ADMIN');
    const res = await ctx.http
      .post('/api/v1/members/invitations')
      .set(bearer(admin))
      .send({
        email: 'nouveau.prof@lycee-demo.local',
        displayName: 'Nouveau Prof',
        roleIds: [seed.tenants.lycee.roleIds.TEACHER],
      });
    expect(res.status).toBe(201);
    const token = res.body.data.token as string;
    expect(token).toBeTruthy();
    const { rows } = await ctx.owner.query(
      `select count(*)::int as n from outbox_events where event_type = 'UserInvited'`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(1);

    const accept = await ctx.http
      .post('/api/v1/auth/invitations/accept')
      .send({ token, password: 'Mot-de-passe-solide-42' });
    expect(accept.status).toBe(200);
    const again = await ctx.http
      .post('/api/v1/auth/invitations/accept')
      .send({ token, password: 'Mot-de-passe-solide-42' });
    expect(again.status).toBe(404);

    const s = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: 'nouveau.prof@lycee-demo.local', password: 'Mot-de-passe-solide-42' });
    expect(s.status).toBe(200);
    const me = await ctx.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${s.body.data.accessToken}`);
    expect(me.body.data.permissions).toContain('TAKE_ATTENDANCE');
  });
});
