import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { base32Decode, hotp, totp, totpCounter } from '../src/modules/identity/domain/totp';
import { PlatformAlertsService } from '../src/modules/reporting';
import { PrivacyService } from '../src/modules/students-guardians';
import { DEMO_PASSWORD } from '../src/seed/seed';
import {
  bearer,
  login,
  loginAs,
  loginPlatform,
  seed,
  solveMfa,
  startApp,
  type TestContext,
} from './helpers';

/**
 * Durcissement (Phase 7) : MFA TOTP (enrôlement, défi, codes de récupération, exigence sur les actions sensibles
 * et pour le super admin), impersonation Super Admin (tracée, sans action financière, clôturable), alertes de
 * supervision, données personnelles (export, anonymisation, rétention), assistant de démarrage.
 */
describe('Durcissement (Phase 7)', () => {
  let ctx: TestContext;
  const U = () => seed.tenants.univ;
  const L = () => seed.tenants.lycee;

  /** Crée un compte dans l'établissement avec le même mot de passe de démo que les comptes seedés. */
  async function createStaff(tenant: 'lycee' | 'univ', role: 'TEACHER' | 'FINANCE' | 'ADMIN') {
    const t = seed.tenants[tenant];
    const hash = (
      await ctx.owner.query<{ password_hash: string }>(
        `select password_hash from users where id = $1`,
        [t.users.TEACHER.userId],
      )
    ).rows[0]!.password_hash;
    const userId = randomUUID();
    const email = `p7-${role.toLowerCase()}-${userId.slice(0, 8)}@${t.code}.local`;
    await ctx.owner.query(
      `insert into users (id, email, password_hash, display_name) values ($1, $2, $3, 'Phase 7')`,
      [userId, email, hash],
    );
    const membershipId = randomUUID();
    await ctx.owner.query(
      `insert into memberships (id, user_id, tenant_id, kind, status, accepted_at) values ($1, $2, $3, 'STAFF', 'ACTIVE', now())`,
      [membershipId, userId, t.id],
    );
    await ctx.owner.query(
      `insert into membership_roles (tenant_id, membership_id, role_id) values ($1, $2, $3)`,
      [t.id, membershipId, t.roleIds[role]],
    );
    return { userId, email, membershipId };
  }

  beforeAll(async () => {
    ctx = await startApp();
  }, 60_000);
  afterAll(() => ctx.close());

  it('MFA : enrôlement en deux temps, défi à la connexion, anti-rejeu, code de récupération, désactivation', async () => {
    const u = await createStaff('univ', 'TEACHER');
    const s = await login(ctx, u.email);
    const status0 = await ctx.http.get('/api/v1/me/mfa').set(bearer(s));
    expect(status0.status).toBe(200);
    expect(status0.body.data).toMatchObject({
      enabled: false,
      required: false,
      sessionVerified: false,
    });

    // Enrôlement : un mauvais code ne l'active pas, un bon code l'active et renvoie 8 codes de récupération.
    const setup = await ctx.http.post('/api/v1/me/mfa/setup').set(bearer(s));
    expect(setup.status).toBe(200);
    const secret = setup.body.data.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.data.otpauthUrl).toContain('otpauth://totp/');
    const bad = await ctx.http
      .post('/api/v1/me/mfa/enable')
      .set(bearer(s))
      .send({ code: '000000' });
    expect(bad.status).toBe(422);
    const enable = await ctx.http
      .post('/api/v1/me/mfa/enable')
      .set(bearer(s))
      .send({ code: totp(secret) });
    expect(enable.status, JSON.stringify(enable.body)).toBe(200);
    const recovery = enable.body.data.recoveryCodes as string[];
    expect(recovery).toHaveLength(8);
    expect((await ctx.http.get('/api/v1/me/mfa').set(bearer(s))).body.data).toMatchObject({
      enabled: true,
      recoveryCodesLeft: 8,
    });

    // Connexion : plus de session directe, un défi. Mauvais code → 401 ; bon code → session marquée MFA.
    const first = await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Client', 'test/1.0')
      .send({ identifier: u.email, password: DEMO_PASSWORD, deviceId: 'test-device-mfa' });
    expect(first.status).toBe(200);
    expect(first.body.data.mfaRequired).toBe(true);
    expect(first.body.data.accessToken).toBeUndefined();
    const challenge = first.body.data.challenge as string;
    const wrong = await ctx.http
      .post('/api/v1/auth/mfa/verify')
      .set('X-Client', 'test/1.0')
      .send({ challenge, code: '123456' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('MFA_REQUIRED');
    // Le code de l'enrôlement (fenêtre courante) est déjà consommé : on prend la fenêtre suivante (tolérance ±1).
    const code = hotp(base32Decode(secret), totpCounter() + 1);
    const ok = await ctx.http
      .post('/api/v1/auth/mfa/verify')
      .set('X-Client', 'test/1.0')
      .send({ challenge, code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.mfa).toBe(true);
    const me = await ctx.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${ok.body.data.accessToken}`);
    expect(me.body.data.mfa).toBe(true);
    // Le défi est à usage unique.
    expect(
      (
        await ctx.http
          .post('/api/v1/auth/mfa/verify')
          .set('X-Client', 'test/1.0')
          .send({ challenge, code })
      ).status,
    ).toBe(401);
    // Anti-rejeu : le même code TOTP ne passe pas deux fois (nouveau défi, même fenêtre de 30 s).
    const second = await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Client', 'test/1.0')
      .send({ identifier: u.email, password: DEMO_PASSWORD });
    const replay = await ctx.http
      .post('/api/v1/auth/mfa/verify')
      .set('X-Client', 'test/1.0')
      .send({ challenge: second.body.data.challenge, code });
    expect(replay.status).toBe(401);
    // Code de récupération : accepté une fois.
    const third = await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Client', 'test/1.0')
      .send({ identifier: u.email, password: DEMO_PASSWORD });
    const rec = await ctx.http
      .post('/api/v1/auth/mfa/verify')
      .set('X-Client', 'test/1.0')
      .send({ challenge: third.body.data.challenge, recoveryCode: recovery[0] });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    const fourth = await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Client', 'test/1.0')
      .send({ identifier: u.email, password: DEMO_PASSWORD });
    expect(
      (
        await ctx.http
          .post('/api/v1/auth/mfa/verify')
          .set('X-Client', 'test/1.0')
          .send({ challenge: fourth.body.data.challenge, recoveryCode: recovery[0] })
      ).status,
    ).toBe(401);
    const left = await ctx.http
      .get('/api/v1/me/mfa')
      .set('Authorization', `Bearer ${rec.body.data.accessToken}`);
    expect(left.body.data.recoveryCodesLeft).toBe(7);
    // Le refresh conserve le marquage MFA ; la désactivation exige une preuve.
    const refreshed = await ctx.http
      .post('/api/v1/auth/refresh')
      .set('X-Client', 'test/1.0')
      .send({ refreshToken: rec.body.data.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.mfa).toBe(true);
    const auth = { Authorization: `Bearer ${refreshed.body.data.accessToken}` };
    expect(
      (await ctx.http.post('/api/v1/me/mfa/disable').set(auth).send({ code: '000000' })).status,
    ).toBe(422);
    const disable = await ctx.http
      .post('/api/v1/me/mfa/disable')
      .set(auth)
      .send({ recoveryCode: recovery[1] });
    expect(disable.status, JSON.stringify(disable.body)).toBe(200);
    const plain = await login(ctx, u.email);
    expect(plain.accessToken).toBeTruthy();
  });

  it('MFA exigée : action sensible refusée sans session MFA (403 MFA_REQUIRED), super admin bloqué hors /me', async () => {
    // Un comptable sans MFA enrôlée : lecture possible, encaissement refusé avec le code MFA_REQUIRED.
    const fin = await createStaff('univ', 'FINANCE');
    const s = await login(ctx, fin.email);
    expect((await ctx.http.get('/api/v1/me/mfa').set(bearer(s))).body.data).toMatchObject({
      enabled: false,
      required: true,
      sessionVerified: false,
    });
    expect((await ctx.http.get('/api/v1/payments').set(bearer(s))).status).toBe(200);
    const pay = await ctx.http
      .post(`/api/v1/students/${U().academic.studentIds[0]}/payments/manual`)
      .set(bearer(s))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 1000, method: 'CASH' });
    expect(pay.status).toBe(403);
    expect(pay.body.code).toBe('MFA_REQUIRED');
    // Le comptable seedé (MFA de démonstration) passe.
    const finance = await loginAs(ctx, 'univ', 'FINANCE');
    expect((await ctx.http.get('/api/v1/me').set(bearer(finance))).body.data.mfa).toBe(true);

    // Super admin sans MFA : refusé sur toute route plateforme, mais peut enrôler la MFA depuis /me.
    const userId = randomUUID();
    const email = `p7-platform-${userId.slice(0, 8)}@polaris.local`;
    const hash = (
      await ctx.owner.query<{ password_hash: string }>(
        `select password_hash from users where id = $1`,
        [seed.platformAdmin.userId],
      )
    ).rows[0]!.password_hash;
    await ctx.owner.query(
      `insert into users (id, email, password_hash, display_name) values ($1, $2, $3, 'Super Admin sans MFA')`,
      [userId, email, hash],
    );
    await ctx.owner.query(
      `insert into memberships (id, user_id, tenant_id, kind, status, accepted_at) values ($1, $2, null, 'PLATFORM', 'ACTIVE', now())`,
      [randomUUID(), userId],
    );
    const p = await login(ctx, email);
    const denied = await ctx.http.get('/api/v1/platform/tenants').set(bearer(p));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('MFA_REQUIRED');
    expect((await ctx.http.get('/api/v1/me/mfa').set(bearer(p))).body.data.required).toBe(true);
    expect((await ctx.http.post('/api/v1/me/mfa/setup').set(bearer(p))).status).toBe(200);
    // Le super admin seedé (MFA) voit la plateforme.
    const platform = await loginPlatform(ctx);
    expect((await ctx.http.get('/api/v1/platform/tenants').set(bearer(platform))).status).toBe(200);
  });

  it('impersonation : 30 min, tracée, permissions sans action financière, jamais plateforme, clôturable', async () => {
    const platform = await loginPlatform(ctx);
    const start = await ctx.http
      .post(`/api/v1/platform/tenants/${L().id}/impersonate`)
      .set(bearer(platform))
      .send({ reason: 'Support : vérifier la structure académique' });
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    const grant = start.body.data as {
      sessionId: string;
      accessToken: string;
      permissions: string[];
      expiresAt: string;
    };
    expect(grant.permissions).toContain('VIEW_STUDENTS');
    expect(grant.permissions).not.toContain('RECORD_MANUAL_PAYMENT');
    expect(new Date(grant.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(31 * 60_000);
    const imp = { Authorization: `Bearer ${grant.accessToken}` };

    const me = await ctx.http.get('/api/v1/me').set(imp);
    expect(me.status).toBe(200);
    expect(me.body.data.impersonation).toMatchObject({
      sessionId: grant.sessionId,
      tenantId: L().id,
    });
    expect(me.body.data.membership.tenant.id).toBe(L().id);
    expect(me.body.data.permissions).not.toContain('CANCEL_PAYMENT');

    const students = await ctx.http.get('/api/v1/students').set(imp);
    expect(students.status).toBe(200);
    expect((students.body.data as unknown[]).length).toBeGreaterThan(0);
    const pay = await ctx.http
      .post(`/api/v1/students/${L().academic.studentIds[0]}/payments/manual`)
      .set(imp)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 1000, method: 'CASH' });
    expect(pay.status).toBe(403);
    expect((await ctx.http.get('/api/v1/platform/overview').set(imp)).status).toBe(404);
    // Une action de configuration est possible et auditée au nom du support.
    const settings = await ctx.http
      .patch('/api/v1/tenant/settings')
      .set(imp)
      .send({ notifications: { smsMonthlyCap: 2000 } });
    expect(settings.status, JSON.stringify(settings.body)).toBe(200);
    const audit = await ctx.owner.query<{ impersonated_by: string | null; actor_user_id: string }>(
      `select impersonated_by, actor_user_id from audit_logs where tenant_id = $1 and action = 'tenant.settings_updated' order by occurred_at desc limit 1`,
      [L().id],
    );
    expect(audit.rows[0]?.impersonated_by).toBe(seed.platformAdmin.userId);

    const list = await ctx.http.get('/api/v1/platform/impersonations').set(bearer(platform));
    expect(list.status).toBe(200);
    expect(
      (list.body.data as { id: string; active: boolean }[]).find((s) => s.id === grant.sessionId)
        ?.active,
    ).toBe(true);
    const end = await ctx.http
      .post(`/api/v1/platform/impersonations/${grant.sessionId}/end`)
      .set(bearer(platform));
    expect(end.status).toBe(200);
    expect(end.body.data.active).toBe(false);
    expect((await ctx.http.get('/api/v1/students').set(imp)).status).toBe(401);
    // Un rôle tenant ne voit pas les sessions de support.
    const admin = await loginAs(ctx, 'lycee', 'ADMIN');
    expect((await ctx.http.get('/api/v1/platform/impersonations').set(bearer(admin))).status).toBe(
      404,
    );
  });

  it('alertes de supervision : ouverture, e-mail aux administrateurs plateforme, acquittement, résolution automatique', async () => {
    const platform = await loginPlatform(ctx);
    const svc = ctx.app.get(PlatformAlertsService);
    await ctx.owner.query(
      `insert into ledger_integrity_checks (tenant_id, mismatches, details) values ($1, 2, '[{"demo":true}]'::jsonb)`,
      [U().id],
    );
    const before = ctx.email.sent.length;
    const r1 = await svc.evaluate();
    expect(r1.opened).toBeGreaterThanOrEqual(1);
    const key = `tenant:${U().id}:ledger-integrity`;
    const open = await ctx.http.get('/api/v1/platform/alerts').set(bearer(platform));
    expect(open.status).toBe(200);
    const alert = (open.body.data as { id: string; key: string; severity: string }[]).find(
      (a) => a.key === key,
    )!;
    expect(alert?.severity).toBe('CRITICAL');
    const mails = ctx.email.sent.slice(before);
    expect(
      mails.some((m) => m.to === seed.platformAdmin.email && m.subject.includes('alerte')),
    ).toBe(true);

    // Une seconde évaluation ne rouvre ni ne renotifie ; l'acquittement est tracé.
    const r2 = await svc.evaluate();
    expect(r2.opened).toBe(0);
    const ack = await ctx.http
      .post(`/api/v1/platform/alerts/${alert.id}/ack`)
      .set(bearer(platform));
    expect(ack.status).toBe(200);
    expect(ack.body.data.acknowledgedAt).toBeTruthy();

    // La condition disparaît (nouveau contrôle sans écart) → résolue.
    await ctx.owner.query(
      `insert into ledger_integrity_checks (tenant_id, mismatches, details) values ($1, 0, '[]'::jsonb)`,
      [U().id],
    );
    const r3 = await svc.evaluate();
    expect(r3.resolved).toBeGreaterThanOrEqual(1);
    const resolved = await ctx.http
      .get('/api/v1/platform/alerts?status=resolved')
      .set(bearer(platform));
    expect((resolved.body.data as { key: string }[]).some((a) => a.key === key)).toBe(true);
    expect(
      (await ctx.http.get('/api/v1/platform/alerts').set(bearer(platform))).body.data.some(
        (a: { key: string }) => a.key === key,
      ),
    ).toBe(false);
    // L'évaluation à la demande est réservée à la plateforme.
    const admin = await loginAs(ctx, 'univ', 'ADMIN');
    expect(
      (await ctx.http.post('/api/v1/platform/alerts/evaluate').set(bearer(admin))).status,
    ).toBe(404);
  });

  it('données personnelles : export, anonymisation (refus élève actif, délai, force), registre, rétention, parent', async () => {
    const admin = await loginAs(ctx, 'univ', 'ADMIN');
    const ac = U().academic;
    const exp = await ctx.http
      .get(`/api/v1/privacy/students/${ac.studentIds[0]}`)
      .set(bearer(admin));
    expect(exp.status, JSON.stringify(exp.body)).toBe(200);
    expect(exp.body.data.sections.identite).toHaveLength(1);
    expect(exp.body.data.counts.inscriptions).toBeGreaterThanOrEqual(1);
    expect(Object.keys(exp.body.data.sections)).toEqual(
      expect.arrayContaining(['tuteurs', 'assiduite', 'creances', 'paiements', 'notifications']),
    );

    // Élève actif : refus. Élève parti : délai de conservation non écoulé → refus, sauf force.
    expect(
      (
        await ctx.http
          .post(`/api/v1/privacy/students/${ac.studentIds[0]}/anonymize`)
          .set(bearer(admin))
          .send({ reason: 'Test' })
      ).status,
    ).toBe(409);
    const leftId = ac.studentIds[4]!;
    const tooEarly = await ctx.http
      .post(`/api/v1/privacy/students/${leftId}/anonymize`)
      .set(bearer(admin))
      .send({ reason: 'Demande de la famille' });
    expect(tooEarly.status).toBe(409);
    const forced = await ctx.http
      .post(`/api/v1/privacy/students/${leftId}/anonymize`)
      .set(bearer(admin))
      .send({ reason: 'Demande écrite de la famille du 1er octobre', force: true });
    expect(forced.status, JSON.stringify(forced.body)).toBe(200);
    expect(forced.body.data.touched.students).toBe(1);
    const after = await ctx.http.get(`/api/v1/students/${leftId}`).set(bearer(admin));
    expect(after.status).toBe(200);
    expect(after.body.data.lastName).toMatch(/^ANONYMISÉ-/);
    expect(after.body.data.matricule).toMatch(/^ANON-/);
    expect(
      (
        await ctx.http
          .post(`/api/v1/privacy/students/${leftId}/anonymize`)
          .set(bearer(admin))
          .send({ reason: 'Encore', force: true })
      ).status,
    ).toBe(409);
    // Tuteur avec un enfant rattaché : refus.
    expect(
      (
        await ctx.http
          .post(`/api/v1/privacy/guardians/${ac.guardianIds.parent}/anonymize`)
          .set(bearer(admin))
          .send({ reason: 'Test' })
      ).status,
    ).toBe(409);
    const reg = await ctx.http.get('/api/v1/privacy/requests').set(bearer(admin));
    expect(reg.status).toBe(200);
    const kinds = (reg.body.data as { kind: string; subjectId: string }[]).filter(
      (r) => r.subjectId === leftId || r.subjectId === ac.studentIds[0],
    );
    expect(kinds.some((r) => r.kind === 'EXPORT')).toBe(true);
    expect(kinds.some((r) => r.kind === 'ERASURE')).toBe(true);
    // Un rôle sans MANAGE_PRIVACY est refusé.
    const registrar = await loginAs(ctx, 'univ', 'REGISTRAR');
    expect((await ctx.http.get('/api/v1/privacy/requests').set(bearer(registrar))).status).toBe(
      403,
    );

    // Rétention automatique : un élève parti il y a 6 ans est anonymisé par le worker.
    const oldId = randomUUID();
    await ctx.owner.query(
      `insert into students (id, tenant_id, matricule, first_name, last_name, status, left_at) values ($1, $2, 'P7-OLD', 'Ancien', 'ÉLÈVE', 'LEFT', (current_date - interval '6 years')::date)`,
      [oldId, U().id],
    );
    const run = await ctx.app.get(PrivacyService).retention(U().id);
    expect(run.studentsAnonymized).toBeGreaterThanOrEqual(1);
    const old = await ctx.owner.query<{ anonymized_at: Date | null; last_name: string }>(
      `select anonymized_at, last_name from students where id = $1`,
      [oldId],
    );
    expect(old.rows[0]?.anonymized_at).toBeTruthy();
    expect(old.rows[0]?.last_name).toMatch(/^ANONYMISÉ-/);

    // Parent : « mes données » sans passer par le support.
    const parent = await login(ctx, ac.parentUser.email);
    const mine = await ctx.http.get('/api/v1/me/personal-data').set(bearer(parent));
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.data.subject.type).toBe('GUARDIAN');
    expect(mine.body.data.counts.enfants).toBeGreaterThanOrEqual(1);
    expect((await ctx.http.get('/api/v1/me/personal-data').set(bearer(admin))).status).toBe(404);
  });

  it('assistant de démarrage : étapes calculées depuis les données, masquage, permissions', async () => {
    const admin = await loginAs(ctx, 'lycee', 'ADMIN');
    const st = await ctx.http.get('/api/v1/onboarding').set(bearer(admin));
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    const steps = st.body.data.steps as { key: string; done: boolean; optional: boolean }[];
    expect(steps.length).toBe(12);
    const by = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(by['year']?.done).toBe(true);
    expect(by['structure']?.done).toBe(true);
    expect(by['students']?.done).toBe(true);
    expect(by['mfa']?.done).toBe(true);
    expect(by['payments']?.done).toBe(true);
    expect(st.body.data.required).toBe(steps.filter((s) => !s.optional).length);
    expect(st.body.data.dismissedAt).toBeNull();
    const dismissed = await ctx.http
      .patch('/api/v1/onboarding')
      .set(bearer(admin))
      .send({ dismissed: true });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data.dismissedAt).toBeTruthy();
    await ctx.http.patch('/api/v1/onboarding').set(bearer(admin)).send({ dismissed: false });
    const registrar = await loginAs(ctx, 'lycee', 'REGISTRAR');
    expect((await ctx.http.get('/api/v1/onboarding').set(bearer(registrar))).status).toBe(200);
    const teacher = await loginAs(ctx, 'lycee', 'TEACHER');
    expect((await ctx.http.get('/api/v1/onboarding').set(bearer(teacher))).status).toBe(403);
  });

  it('secret TOTP de démonstration : le code courant ouvre bien la session du super admin seedé', async () => {
    const first = await ctx.http
      .post('/api/v1/auth/login')
      .set('X-Client', 'test/1.0')
      .send({ identifier: seed.platformAdmin.email, password: DEMO_PASSWORD });
    expect(first.body.data.mfaRequired).toBe(true);
    const ok = await solveMfa(ctx, seed.platformAdmin.email, first.body.data.challenge as string);
    expect(ok.status).toBe(200);
    expect(ok.body.data.mfa).toBe(true);
  });
});
