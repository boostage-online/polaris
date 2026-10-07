import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AvailabilityService, HypercareService, UsageService } from '../src/modules/launch';
import { DEMO_PASSWORD } from '../src/seed/seed';
import { bearer, login, loginAs, loginPlatform, seed, startApp, type TestContext } from './helpers';

/**
 * Lancement production et hypercare (Phase 8) : préparation et bascule d'un établissement, adoption du parc,
 * revue quotidienne, disponibilité mesurée et page publique d'état, consommation mensuelle, outils du support
 * niveau 1 (recherche, déverrouillage, réinitialisation MFA) et réinitialisation MFA par l'administrateur.
 */
describe('Lancement et hypercare (Phase 8)', () => {
  let ctx: TestContext;
  const U = () => seed.tenants.univ;
  const L = () => seed.tenants.lycee;

  beforeAll(async () => {
    ctx = await startApp();
  }, 60_000);
  afterAll(() => ctx.close());

  it('mise en production : préparation (points bloquants), checklist, refus 409, bascule, e-mail, déjà en production', async () => {
    const sa = await loginPlatform(ctx);
    const url = `/api/v1/platform/tenants/${U().id}/launch`;
    const r1 = await ctx.http.get(url).set(bearer(sa));
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.data.live).toBe(false);
    expect(r1.body.data.onboarding.steps.length).toBe(12);
    const checks = r1.body.data.checks as { key: string; ok: boolean; blocking: boolean }[];
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));
    // Seed : provider FAKE en bac à sable, pas de plafond SMS explicite, checklist vide → pas prêt.
    expect(by['payments-live']?.ok).toBe(false);
    expect(by['sms-cap']?.ok).toBe(false);
    expect(by['checklist']?.ok).toBe(false);
    expect(r1.body.data.ready).toBe(false);

    const fullChecklist = {
      contractSigned: true,
      smsBudgetValidated: true,
      onCallInformed: true,
      dataValidatedByTenant: true,
    };
    const ck = await ctx.http.patch(`${url}/checklist`).set(bearer(sa)).send(fullChecklist);
    expect(ck.status).toBe(200);
    expect(ck.body.data.checklist).toEqual(fullChecklist);
    expect(ck.body.data.checks.find((c: { key: string }) => c.key === 'checklist').ok).toBe(true);

    const refused = await ctx.http
      .post(`${url}/go-live`)
      .set(bearer(sa))
      .send({ plan: 'STANDARD', checklist: fullChecklist });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.detail).toMatch(/Paiement en ligne|SMS/);

    // Le support passe le provider en réel et l'établissement fixe son plafond SMS.
    await ctx.owner.query(
      `update tenant_payment_configs set environment = 'LIVE' where tenant_id = $1`,
      [U().id],
    );
    await ctx.owner.query(
      `update tenants set settings = settings || '{"notifications":{"smsMonthlyCap":1500}}'::jsonb where id = $1`,
      [U().id],
    );
    const before = ctx.email.sent.length;
    const live = await ctx.http.post(`${url}/go-live`).set(bearer(sa)).send({
      plan: 'STANDARD',
      checklist: fullChecklist,
      hypercareDays: 14,
      notes: 'Bascule de test',
    });
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    expect(live.body.data.live).toBe(true);
    expect(live.body.data.inHypercare).toBe(true);
    expect(live.body.data.tenant.plan).toBe('STANDARD');
    expect(live.body.data.tenant.status).toBe('ACTIVE');
    const hypercare = new Date(live.body.data.tenant.hypercareUntil).getTime() - Date.now();
    expect(hypercare).toBeGreaterThan(13 * 86_400_000);
    expect(hypercare).toBeLessThan(15 * 86_400_000);
    const mails = ctx.email.sent.slice(before).filter((m) => m.reference === 'tenant-live');
    expect(mails.length).toBeGreaterThan(0);
    expect(mails[0]!.subject).toContain('en production');

    const again = await ctx.http
      .post(`${url}/go-live`)
      .set(bearer(sa))
      .send({ plan: 'STANDARD', checklist: fullChecklist });
    expect(again.status).toBe(409);

    const audit = await ctx.owner.query(
      `select count(*)::int as n from audit_logs where action = 'tenant.live' and entity_id = $1`,
      [U().id],
    );
    expect(audit.rows[0]!.n).toBe(1);
    // Un rôle tenant n'atteint pas la route (404 : portée plateforme).
    const admin = await loginAs(ctx, 'univ', 'ADMIN');
    expect((await ctx.http.get(url).set(bearer(admin))).status).toBe(404);
    // Remise en l'état pour les autres suites (le provider FAKE reste en bac à sable).
    await ctx.owner.query(
      `update tenant_payment_configs set environment = 'SANDBOX' where tenant_id = $1`,
      [U().id],
    );
  });

  it('adoption : parc, par établissement (activation, appels, SMS), tendance 8 semaines, G8', async () => {
    const sa = await loginPlatform(ctx);
    const r = await ctx.http.get('/api/v1/platform/adoption').set(bearer(sa));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data as {
      fleet: {
        tenants: number;
        live: number;
        guardians: number;
        guardiansActivated: number;
        activationRate: number | null;
      };
      tenants: {
        code: string;
        guardians: number;
        guardiansActivated: number;
        activationRate: number | null;
        smsCap: number;
        meetsG8: boolean;
        inHypercare: boolean;
        liveAt: string | null;
      }[];
      weekly: { weekStart: string }[];
    };
    expect(d.fleet.tenants).toBeGreaterThanOrEqual(2);
    expect(d.fleet.live).toBeGreaterThanOrEqual(1);
    expect(d.weekly.length).toBe(8);
    const lycee = d.tenants.find((t) => t.code === L().code)!;
    expect(lycee.liveAt).toBeTruthy();
    expect(lycee.inHypercare).toBe(true);
    expect(lycee.smsCap).toBeGreaterThan(0);
    const expectedRate =
      lycee.guardians > 0
        ? Math.round((lycee.guardiansActivated * 1000) / lycee.guardians) / 10
        : null;
    expect(lycee.activationRate).toBe(expectedRate);
    expect(lycee.meetsG8).toBe((lycee.activationRate ?? 0) >= 70);
    const sumG = d.tenants.reduce((a, t) => a + t.guardians, 0);
    expect(d.fleet.guardians).toBe(sumG);
    // Vérification croisée avec la base.
    const db = await ctx.owner.query<{ g: number; a: number }>(
      `select count(*)::int as g, count(*) filter (where user_id is not null)::int as a from guardians where tenant_id = $1 and deleted_at is null`,
      [L().id],
    );
    expect(lycee.guardians).toBe(db.rows[0]!.g);
    expect(lycee.guardiansActivated).toBe(db.rows[0]!.a);
  });

  it('revue quotidienne : génération, e-mail aux administrateurs plateforme, liste, acquittement, régénération sans doublon', async () => {
    const svc = ctx.app.get(HypercareService);
    const before = ctx.email.sent.length;
    const day = '2026-01-15';
    const review = await svc.generate(day);
    expect(review.day).toBe(day);
    expect(review.summary.tenantsInHypercare).toBeGreaterThanOrEqual(1);
    expect(review.tenants.length).toBeGreaterThanOrEqual(2);
    const lycee = review.tenants.find((t) => t.code === L().code)!;
    expect(lycee.inHypercare).toBe(true);
    expect(Array.isArray(lycee.flags)).toBe(true);
    const mails = ctx.email.sent.slice(before).filter((m) => m.reference === `hypercare-${day}`);
    expect(mails.length).toBeGreaterThan(0);
    expect(mails[0]!.subject).toContain(day);
    // Régénération : pas de second e-mail, une seule ligne.
    await svc.generate(day);
    expect(ctx.email.sent.filter((m) => m.reference === `hypercare-${day}`).length).toBe(
      mails.length,
    );
    const sa = await loginPlatform(ctx);
    const list = await ctx.http.get('/api/v1/platform/reviews?limit=5').set(bearer(sa));
    expect(list.status).toBe(200);
    expect(list.body.data.filter((r: { day: string }) => r.day === day).length).toBe(1);
    const seeded = list.body.data.find((r: { notes: string | null }) =>
      r.notes?.includes('démonstration'),
    );
    expect(seeded?.reviewedAt).toBeTruthy();
    const ack = await ctx.http
      .post(`/api/v1/platform/reviews/${day}/ack`)
      .set(bearer(sa))
      .send({ notes: 'Rien à faire, UNKNOWN traitées' });
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    expect(ack.body.data.reviewedAt).toBeTruthy();
    expect(ack.body.data.reviewedBy).toBe(seed.platformAdmin.userId);
    const one = await ctx.http.get(`/api/v1/platform/reviews/${day}`).set(bearer(sa));
    expect(one.body.data.notes).toBe('Rien à faire, UNKNOWN traitées');
    expect((await ctx.http.get('/api/v1/platform/reviews/2001-01-01').set(bearer(sa))).status).toBe(
      404,
    );
    const gen = await ctx.http.post('/api/v1/platform/reviews/generate').set(bearer(sa));
    expect(gen.status, JSON.stringify(gen.body)).toBe(200);
    expect(gen.body.data.day).toBe(new Date().toISOString().slice(0, 10));
  });

  it('disponibilité : sonde réelle sur le serveur de test, statistiques, objectif 99,5 %, page publique sans authentification', async () => {
    const svc = ctx.app.get(AvailabilityService);
    const base = await ctx.app.getUrl();
    const ok = await svc.probe(`${base}/api/v1/health/ready`);
    expect(ok.ok).toBe(true);
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
    const ko = await svc.probe(`${base}/api/v1/health/nope`);
    expect(ko.ok).toBe(false);
    expect(ko.detail).toBe('HTTP 404');
    const sa = await loginPlatform(ctx);
    const r = await ctx.http.get('/api/v1/platform/availability?days=7').set(bearer(sa));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.target).toBe(99.5);
    expect(r.body.data.checks).toBeGreaterThanOrEqual(2);
    expect(r.body.data.failures).toBeGreaterThanOrEqual(1);
    expect(r.body.data.lastCheckOk).toBe(false);
    const today = new Date().toISOString().slice(0, 10);
    const d = (
      r.body.data.days as { day: string; checks: number; failures: number; availability: number }[]
    ).find((x) => x.day === today)!;
    expect(d.checks).toBeGreaterThanOrEqual(2);
    expect(d.availability).toBeCloseTo(
      Math.round(((d.checks - d.failures) * 10000) / d.checks) / 100,
      5,
    );
    const pub = await ctx.http.get('/api/v1/status');
    expect(pub.status).toBe(200);
    expect(['OPERATIONAL', 'DEGRADED', 'OUTAGE', 'UNKNOWN']).toContain(pub.body.data.status);
    expect(pub.body.data.status).not.toBe('UNKNOWN');
    expect(pub.body.data.days.length).toBeGreaterThan(0);
    expect(JSON.stringify(pub.body)).not.toContain(L().code);
    const probe = await ctx.http.post('/api/v1/platform/availability/probe').set(bearer(sa));
    expect(probe.status).toBe(200);
    expect(typeof probe.body.data.ok).toBe('boolean');
  });

  it('consommation mensuelle : instantané idempotent, égal aux tables sources, liste plateforme, CSV, RLS', async () => {
    const svc = ctx.app.get(UsageService);
    const month = `${new Date().toISOString().slice(0, 7)}-01`;
    const snap1 = await svc.snapshot(L().id, month);
    const snap2 = await svc.snapshot(L().id, month);
    expect(snap2.activeStudents).toBe(snap1.activeStudents);
    const db = await ctx.owner.query<{ students: number; sms: number }>(
      `select (select count(*) from students where tenant_id = $1 and status = 'ACTIVE' and deleted_at is null)::int as students,
              (select count(*) from notifications where tenant_id = $1 and channel = 'SMS' and status in ('SENT','DELIVERED') and created_at >= $2::date and created_at < $2::date + interval '1 month')::int as sms`,
      [L().id, month],
    );
    expect(snap1.activeStudents).toBe(db.rows[0]!.students);
    expect(snap1.smsSent).toBe(db.rows[0]!.sms);
    const rows = await ctx.owner.query(
      `select count(*)::int as n from tenant_usage_monthly where tenant_id = $1 and month = $2`,
      [L().id, month],
    );
    expect(rows.rows[0]!.n).toBe(1);
    const sa = await loginPlatform(ctx);
    const all = await ctx.http.post('/api/v1/platform/usage/snapshot').set(bearer(sa));
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.data.tenants).toBeGreaterThanOrEqual(2);
    const list = await ctx.http
      .get(`/api/v1/platform/usage?month=${month.slice(0, 7)}`)
      .set(bearer(sa));
    expect(list.status).toBe(200);
    const mine = list.body.data.find((r: { code: string }) => r.code === L().code);
    expect(mine.activeStudents).toBe(snap1.activeStudents);
    expect(mine.plan).toBe('STANDARD');
    const csv = await ctx.http
      .get(`/api/v1/platform/usage/export.csv?month=${month.slice(0, 7)}`)
      .set(bearer(sa));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain(`consommation_${month.slice(0, 7)}.csv`);
    expect(csv.text.startsWith('﻿mois;code;etablissement')).toBe(true);
    expect(csv.text).toContain(L().code);
    // RLS : le rôle applicatif sans contexte tenant ne voit aucune ligne.
    const { Pool } = await import('pg');
    const app = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
    try {
      const r = await app.query(`select count(*)::int as n from tenant_usage_monthly`);
      expect(r.rows[0].n).toBe(0);
    } finally {
      await app.end();
    }
  });

  it('support N1 : recherche inter-établissements, verrouillage visible et levé, réinitialisation MFA (support et administrateur)', async () => {
    const sa = await loginPlatform(ctx);
    const finance = U().users.FINANCE;
    // 5 échecs → verrouillé.
    for (let i = 0; i < 5; i++) {
      await ctx.http
        .post('/api/v1/auth/login')
        .send({ identifier: finance.email, password: 'definitely-wrong-pass' });
    }
    const locked = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: finance.email, password: DEMO_PASSWORD });
    expect(locked.status).toBe(423);
    const found = await ctx.http
      .get(`/api/v1/platform/support/lookup?q=${encodeURIComponent(finance.email)}`)
      .set(bearer(sa));
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    const u = found.body.data.users.find((x: { email: string }) => x.email === finance.email);
    expect(u).toBeTruthy();
    expect(u.lockedFor).toBeGreaterThan(0);
    expect(u.mfaEnabled).toBe(true);
    expect(
      u.memberships.some(
        (m: { tenantCode: string; roles: string[] }) =>
          m.tenantCode === U().code && m.roles.length > 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(found.body)).not.toContain('passwordHash');
    // Recherche par nom et par téléphone (tuteur sans compte éventuel) : pas d'erreur, forme stable.
    const byName = await ctx.http.get('/api/v1/platform/support/lookup?q=admin').set(bearer(sa));
    expect(byName.status).toBe(200);
    expect(Array.isArray(byName.body.data.guardiansWithoutAccount)).toBe(true);
    expect(
      (await ctx.http.get('/api/v1/platform/support/lookup?q=ab').set(bearer(sa))).status,
    ).toBe(422);

    const unlock = await ctx.http
      .post('/api/v1/platform/support/unlock')
      .set(bearer(sa))
      .send({ identifier: finance.email });
    expect(unlock.status).toBe(200);
    expect(unlock.body.data.wasLocked).toBe(true);
    const after = await ctx.http
      .post('/api/v1/auth/login')
      .send({ identifier: finance.email, password: DEMO_PASSWORD });
    expect(after.status).toBe(200);
    expect(after.body.data.mfaRequired).toBe(true);

    // Réinitialisation MFA par le support : la MFA tombe, la connexion suivante ouvre une session directement.
    const reset = await ctx.http
      .post(`/api/v1/platform/support/users/${finance.userId}/mfa-reset`)
      .set(bearer(sa))
      .send({ reason: 'Téléphone perdu, identité vérifiée par appel au chef d’établissement' });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect(reset.body.data.mfaEnabled).toBe(false);
    const direct = await login(ctx, finance.email);
    expect(direct.accessToken).toBeTruthy();
    expect((await ctx.http.get('/api/v1/me/mfa').set(bearer(direct))).body.data.enabled).toBe(
      false,
    );
    // Le support ne peut pas se réinitialiser lui-même ; un identifiant inconnu → 404.
    expect(
      (
        await ctx.http
          .post(`/api/v1/platform/support/users/${seed.platformAdmin.userId}/mfa-reset`)
          .set(bearer(sa))
          .send({ reason: 'Tentative sur soi-même' })
      ).status,
    ).toBe(409);
    expect(
      (
        await ctx.http
          .post(`/api/v1/platform/support/users/${randomUUID()}/mfa-reset`)
          .set(bearer(sa))
          .send({ reason: 'Identifiant inconnu' })
      ).status,
    ).toBe(404);

    // Réinitialisation par l'administrateur de l'établissement (permission sensible : MFA exigée) sur le membre finance,
    // qui vient de ré-enrôler sa MFA.
    const setup = await ctx.http.post('/api/v1/me/mfa/setup').set(bearer(direct));
    expect(setup.status).toBe(200);
    const { totp, base32Decode } = await import('../src/modules/identity/domain/totp');
    const code = totp(base32Decode(setup.body.data.secret as string), Date.now());
    const enable = await ctx.http.post('/api/v1/me/mfa/enable').set(bearer(direct)).send({ code });
    expect(enable.status, JSON.stringify(enable.body)).toBe(200);
    const admin = await loginAs(ctx, 'univ', 'ADMIN');
    const byAdmin = await ctx.http
      .post(`/api/v1/members/${finance.membershipId}/mfa-reset`)
      .set(bearer(admin))
      .send({ reason: 'Nouveau téléphone, identité vérifiée au secrétariat' });
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200);
    expect(byAdmin.body.data.sessionsRevoked).toBeGreaterThanOrEqual(1);
    // L'ancienne session finance est révoquée.
    expect((await ctx.http.get('/api/v1/me').set(bearer(direct))).status).toBe(401);
    // Un membre d'un autre établissement : 404 ; la scolarité (sans la permission) : 403.
    const lyceeAdmin = await loginAs(ctx, 'lycee', 'ADMIN');
    expect(
      (
        await ctx.http
          .post(`/api/v1/members/${finance.membershipId}/mfa-reset`)
          .set(bearer(lyceeAdmin))
          .send({ reason: 'Mauvais établissement' })
      ).status,
    ).toBe(404);
    const registrar = await loginAs(ctx, 'univ', 'REGISTRAR');
    expect(
      (
        await ctx.http
          .post(`/api/v1/members/${finance.membershipId}/mfa-reset`)
          .set(bearer(registrar))
          .send({ reason: 'Pas la permission' })
      ).status,
    ).toBe(403);
    const audit = await ctx.owner.query(
      `select count(*)::int as n from audit_logs where action = 'auth.mfa_reset' and entity_id = $1`,
      [finance.userId],
    );
    expect(audit.rows[0]!.n).toBe(2);
    // Remise en l'état : le compte finance retrouve le secret TOTP de démonstration (les autres suites s'en servent).
    await ctx.owner.query(
      `update users set mfa_enabled = true, mfa_enrolled_at = now(),
              mfa_secret_encrypted = (select mfa_secret_encrypted from users where id = $2)
       where id = $1`,
      [finance.userId, L().users.FINANCE.userId],
    );
  });
});
