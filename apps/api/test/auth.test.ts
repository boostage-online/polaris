import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, loginAs, seed, startApp, type TestContext } from './helpers';
import { DEMO_PASSWORD } from '../src/seed/seed';

describe('Authentification (ADR-0008)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(() => ctx.close());

  it('connexion par mot de passe → access + refresh, membership unique sélectionné', async () => {
    const s = await loginAs(ctx, 'lycee', 'ADMIN');
    expect(s.accessToken.split('.')).toHaveLength(3);
    expect(s.refreshToken.length).toBeGreaterThan(32);
    expect(s.membershipId).toBe(seed.tenants.lycee.users.ADMIN.membershipId);
  });

  it('même réponse pour un compte inconnu et un mauvais mot de passe (anti-énumération)', async () => {
    const a = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: 'nobody@nowhere.local', password: 'wrong-password-123' });
    const b = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: seed.tenants.lycee.users.TEACHER.email, password: 'wrong-password-123' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.code).toBe('INVALID_CREDENTIALS');
    expect(a.body.code).toBe(b.body.code);
    expect(a.headers['content-type']).toContain('application/problem+json');
  });

  it('mode web : le refresh est posé en cookie HttpOnly/SameSite=Strict, jamais dans le corps', async () => {
    const res = await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Client', 'web/0.1.0')
      .send({ identifier: seed.tenants.lycee.users.ADMIN.email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeUndefined();
    const cookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
      c.startsWith('polaris_rt='),
    );
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('refresh : rotation, puis réutilisation de l’ancien token = révocation de toute la famille', async () => {
    const s = await loginAs(ctx, 'lycee', 'TEACHER');
    const r1 = await ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    const second = r1.body.data.refreshToken as string;
    expect(second).not.toBe(s.refreshToken);

    const reuse = await ctx.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('TOKEN_REVOKED');

    const afterReuse = await ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: second });
    expect(afterReuse.status).toBe(401);

    const { rows } = await ctx.owner.query(
      `select count(*)::int as n from outbox_events where event_type = 'RefreshTokenReuseDetected'`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('GET /me renvoie le profil, les appartenances et les permissions effectives', async () => {
    const s = await loginAs(ctx, 'lycee', 'TEACHER');
    const res = await ctx.http.get('/api/v1/me').set(bearer(s));
    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toEqual(expect.arrayContaining(['TAKE_ATTENDANCE']));
    expect(res.body.data.permissions).not.toContain('MANAGE_ROLES');
    expect(res.body.data.tenantTimezone).toBe('Africa/Porto-Novo');
  });

  it('logout-all invalide immédiatement les access tokens existants (token_version)', async () => {
    const s = await loginAs(ctx, 'lycee', 'REGISTRAR');
    expect((await ctx.http.get('/api/v1/me').set(bearer(s))).status).toBe(200);
    expect((await ctx.http.post('/api/v1/auth/logout-all').set(bearer(s))).status).toBe(204);
    const after = await ctx.http.get('/api/v1/me').set(bearer(s));
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('TOKEN_REVOKED');
    expect(
      (await ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status,
    ).toBe(401);
  });

  it('un utilisateur présent dans deux établissements doit choisir, puis bascule', async () => {
    // On rattache l’admin du lycée à l’université comme enseignant.
    const { rows } = await ctx.owner.query<{ id: string }>(
      `insert into memberships (user_id, tenant_id, kind, status, accepted_at) values ($1, $2, 'STAFF', 'ACTIVE', now()) returning id`,
      [seed.tenants.lycee.users.ADMIN.userId, seed.tenants.univ.id],
    );
    await ctx.owner.query(
      `insert into membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`,
      [seed.tenants.univ.id, rows[0].id, seed.tenants.univ.roleIds.TEACHER],
    );

    const s = await login(ctx, seed.tenants.lycee.users.ADMIN.email);
    expect(s.membershipId).toBeNull();
    const denied = await ctx.http.get('/api/v1/tenant').set(bearer(s));
    expect(denied.status).toBe(403);

    const sw = await ctx.http
      .post('/api/v1/auth/switch-membership')
      .set(bearer(s))
      .send({ membershipId: rows[0].id, refreshToken: s.refreshToken });
    expect(sw.status).toBe(200);
    const tenant = await ctx.http
      .get('/api/v1/tenant')
      .set('Authorization', `Bearer ${sw.body.data.accessToken}`);
    expect(tenant.status).toBe(200);
    expect(tenant.body.data.code).toBe('univ-demo');

    await ctx.owner.query('delete from membership_roles where membership_id = $1', [rows[0].id]);
    await ctx.owner.query('delete from refresh_tokens where membership_id = $1', [rows[0].id]);
    await ctx.owner.query('delete from memberships where id = $1', [rows[0].id]);
  });

  it('OTP : demande → SMS via la passerelle → connexion ; code faux refusé', async () => {
    const phone = '+22961000001';
    await ctx.owner.query(`update users set phone_e164 = $1 where id = $2`, [
      phone,
      seed.tenants.univ.users.TEACHER.userId,
    ]);
    const before = ctx.sms.sent.length;
    expect((await ctx.http.post('/api/v1/auth/otp/request').send({ phone })).status).toBe(202);
    expect(ctx.sms.sent.length).toBe(before + 1);
    const code = /(\d{6})/.exec(ctx.sms.sent.at(-1)!.body)![1];

    const bad = await ctx.http
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: code === '000000' ? '111111' : '000000' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('OTP_INVALID');

    const ok = await ctx.http.post('/api/v1/auth/otp/verify').send({ phone, code });
    expect(ok.status).toBe(200);
    expect(ok.body.data.membership.id).toBe(seed.tenants.univ.users.TEACHER.membershipId);

    const replay = await ctx.http.post('/api/v1/auth/otp/verify').send({ phone, code });
    expect(replay.status).toBe(401);

    // Numéro inconnu : même 202, aucun SMS.
    const n = ctx.sms.sent.length;
    expect(
      (await ctx.http.post('/api/v1/auth/otp/request').send({ phone: '+22961999999' })).status,
    ).toBe(202);
    expect(ctx.sms.sent.length).toBe(n);
  });

  it('verrouillage progressif après 5 échecs sur un compte', async () => {
    const email = seed.tenants.univ.users.FINANCE.email;
    for (let i = 0; i < 5; i++) {
      await ctx.http
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: 'definitely-wrong-pass' });
    }
    const locked = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: DEMO_PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(Number(locked.headers['retry-after'] ?? 0)).toBeGreaterThanOrEqual(0);
  });

  it('établissement suspendu : connexion possible mais accès tenant refusé', async () => {
    await ctx.owner.query(`update tenants set status = 'SUSPENDED' where id = $1`, [
      seed.tenants.univ.id,
    ]);
    const s = await login(ctx, seed.tenants.univ.users.DIRECTION.email);
    expect(s.membershipId).toBeNull();
    await ctx.owner.query(`update tenants set status = 'ACTIVE' where id = $1`, [
      seed.tenants.univ.id,
    ]);
  });

  it('expose les clés publiques JWKS', async () => {
    const res = await ctx.http.get('/api/v1/auth/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.body.data.keys[0].kty).toBe('EC');
  });
});
