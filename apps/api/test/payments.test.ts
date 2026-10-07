import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderRegistry, ReconciliationService } from '../src/modules/payments';
import { WorkerModule } from '../src/worker/worker.module';
import { bearer, login, loginAs, seed, startApp, type Session, type TestContext } from './helpers';

/**
 * Paiements électroniques (Partie 10, scénarios P1–P15) sur le provider de démonstration : le parent paie,
 * la caisse factice poste le webhook signé, le worker vérifie et crée le paiement — une seule fois.
 */
describe('Paiements électroniques', () => {
  let ctx: TestContext;
  let worker: INestApplicationContext;
  let admin: Session;
  let finance: Session;
  let direction: Session;
  let parent: Session;
  let studentId: string;
  let installmentIds: string[];
  const T = () => seed.tenants.lycee;
  const ac = () => T().academic;
  const key = () => ({ 'Idempotency-Key': randomUUID() });
  const sign = (body: string) =>
    createHash('sha256').update(`${ac().payments.webhookSecret}|${body}`).digest('hex');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const attemptOf = async (id: string) =>
    (
      await ctx.http
        .get(`/api/v1/me/children/${studentId}/payment-attempts/${id}`)
        .set(bearer(parent))
    ).body.data as {
      id: string;
      status: string;
      checkout: { kind: string; url?: string } | null;
      externalId: string | null;
      paymentId: string | null;
      receiptNumber: string | null;
      failureCode: string | null;
      reviewStatus: string;
    };
  const waitFor = async (id: string, statuses: string[], timeoutMs = 15_000) => {
    const start = Date.now();
    for (;;) {
      const a = await attemptOf(id);
      if (statuses.includes(a.status)) return a;
      if (Date.now() - start > timeoutMs) throw new Error(`attempt ${id} toujours ${a.status}`);
      await sleep(250);
    }
  };
  const startAttempt = async (amount: number, installments: string[] = []) => {
    const res = await ctx.http
      .post(`/api/v1/me/children/${studentId}/payment-attempts`)
      .set(bearer(parent))
      .set(key())
      .send({ amount, installmentIds: installments });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string; externalId: string; status: string };
  };
  const payFake = (
    externalId: string,
    status: 'SUCCESS' | 'FAILED' | 'CANCELLED',
    amount?: number,
  ) =>
    ctx.http
      .post(`/api/v1/dev/fake-provider/transactions/${externalId}/complete`)
      .send({ status, amount });
  const paymentsOfAttempt = async (attemptId: string) =>
    (
      await ctx.owner.query<{ n: number }>(
        `select count(*)::int as n from payments where attempt_id = $1`,
        [attemptId],
      )
    ).rows[0]!.n;

  beforeAll(async () => {
    ctx = await startApp();
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    await worker.init();
    admin = await loginAs(ctx, 'lycee', 'ADMIN');
    finance = await loginAs(ctx, 'lycee', 'FINANCE');
    direction = await loginAs(ctx, 'lycee', 'DIRECTION');
    parent = await login(ctx, ac().parentUser.email);
    // Un élève dédié à cette suite (les autres suites font bouger les comptes de S1/S2) : inscrit en 6e A,
    // rattaché au parent de démonstration avec le droit de payer, grille SCOL-6E affectée (3 × 50 000).
    const created = await ctx.http.post('/api/v1/students').set(bearer(admin)).send({
      firstName: 'Elec',
      lastName: 'PAYEUR',
      birthDate: '2013-05-05',
      gender: 'M',
      groupId: ac().groupIds.sixA,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    studentId = created.body.data.id as string;
    const linked = await ctx.http
      .post(`/api/v1/students/${studentId}/guardians`)
      .set(bearer(admin))
      .send({
        guardianId: ac().guardianIds.parent,
        relationship: 'MOTHER',
        canViewFinance: true,
        canPay: true,
      });
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    const assigned = await ctx.http
      .post(`/api/v1/students/${studentId}/fees`)
      .set(bearer(finance))
      .send({ feeStructureIds: [ac().billing.structureId] });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    const fee = (
      assigned.body.data.fees as {
        feeStructureId: string;
        installments: { id: string; seq: number }[];
      }[]
    ).find((f) => f.feeStructureId === ac().billing.structureId)!;
    installmentIds = fee.installments.sort((a, b) => a.seq - b.seq).map((i) => i.id);
    await ctx.app.get(ProviderRegistry).resetCircuit(T().id, 'FAKE');
  }, 60_000);
  afterAll(async () => {
    await worker.close();
    await ctx.close();
  });

  it('configuration du compte marchand : clés masquées, test de connexion, un seul provider actif', async () => {
    const list = await ctx.http.get('/api/v1/payment-config').set(bearer(admin));
    expect(list.status).toBe(200);
    const fake = (
      list.body.data as { provider: string; status: string; webhookUrl: string }[]
    ).find((c) => c.provider === 'FAKE')!;
    expect(fake.status).toBe('ACTIVE');
    expect(fake.webhookUrl).toContain(
      `/api/v1/webhooks/payments/fake/${ac().payments.webhookToken}`,
    );
    expect((await ctx.http.get('/api/v1/payment-config').set(bearer(finance))).status).toBe(403);

    const feda = await ctx.http
      .put('/api/v1/payment-config')
      .set(bearer(admin))
      .send({
        provider: 'FEDAPAY',
        environment: 'SANDBOX',
        credentials: { secretKey: 'sk_sandbox_demo_1234' },
        webhookSecret: 'whsec_feda_demo',
      });
    expect(feda.status, JSON.stringify(feda.body)).toBe(200);
    expect(feda.body.data.status).toBe('PENDING_TEST');
    expect(feda.body.data.credentialsMasked.secretKey).toBe('••••1234');
    expect(feda.body.data.webhookSecretSet).toBe(true);
    expect(JSON.stringify(feda.body)).not.toContain('sk_sandbox_demo_1234');
    // Activer sans test → 409 ; une clé inconnue → 422.
    expect(
      (
        await ctx.http
          .patch('/api/v1/payment-config/FEDAPAY/status')
          .set(bearer(admin))
          .send({ status: 'ACTIVE' })
      ).status,
    ).toBe(409);
    expect(
      (
        await ctx.http
          .put('/api/v1/payment-config')
          .set(bearer(admin))
          .send({ provider: 'FEDAPAY', credentials: { secretKey: 'x', apiKey: 'y' } })
      ).status,
    ).toBe(422);
    // Les clés sont chiffrées en base (enveloppe), jamais en clair.
    const raw = await ctx.owner.query<{ c: string }>(
      `select credentials_encrypted as c from tenant_payment_configs where tenant_id = $1 and provider = 'FEDAPAY'`,
      [T().id],
    );
    expect(raw.rows[0]!.c).not.toContain('sk_sandbox');
    expect(JSON.parse(raw.rows[0]!.c)).toMatchObject({ v: 1, kid: 'local-1' });
    // Le provider de démonstration reste le provider actif.
    const again = await ctx.http.post('/api/v1/payment-config/FAKE/test').set(bearer(admin));
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe('ACTIVE');
  });

  it('options de paiement du parent : provider, bornes ; refus hors droit « payer »', async () => {
    const res = await ctx.http
      .get(`/api/v1/me/children/${studentId}/payment-options`)
      .set(bearer(parent));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      enabled: true,
      provider: 'FAKE',
      environment: 'SANDBOX',
      minAmount: 100,
      maxAmount: 150000,
    });
    // Montant hors bornes → 422 ; échéance inconnue → 422.
    expect(
      (
        await ctx.http
          .post(`/api/v1/me/children/${studentId}/payment-attempts`)
          .set(bearer(parent))
          .set(key())
          .send({ amount: 200000 })
      ).status,
    ).toBe(422);
    expect(
      (
        await ctx.http
          .post(`/api/v1/me/children/${studentId}/payment-attempts`)
          .set(bearer(parent))
          .set(key())
          .send({ amount: 1000, installmentIds: [randomUUID()] })
      ).status,
    ).toBe(422);
    // Sans Idempotency-Key → 422.
    expect(
      (
        await ctx.http
          .post(`/api/v1/me/children/${studentId}/payment-attempts`)
          .set(bearer(parent))
          .send({ amount: 1000 })
      ).status,
    ).toBe(422);
  });

  let succeeded: { id: string; externalId: string };
  it('P1 — succès nominal : initiate → webhook → verify → un paiement, allocations, reçu ; rejeu de la clé idempotent', async () => {
    const k = key();
    const res = await ctx.http
      .post(`/api/v1/me/children/${studentId}/payment-attempts`)
      .set(bearer(parent))
      .set(k)
      .send({ amount: 50000, installmentIds: [installmentIds[0]!] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const a = res.body.data as {
      id: string;
      externalId: string;
      status: string;
      checkout: { kind: string; url: string };
    };
    expect(a.status).toBe('PENDING');
    expect(a.checkout.kind).toBe('REDIRECT');
    expect(a.checkout.url).toContain(`/pay/fake/${a.externalId}`);
    const replay = await ctx.http
      .post(`/api/v1/me/children/${studentId}/payment-attempts`)
      .set(bearer(parent))
      .set(k)
      .send({ amount: 50000, installmentIds: [installmentIds[0]!] });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(a.id);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    // Le parent paie sur la caisse factice : webhook signé → file → verify → paiement.
    const paid = await payFake(a.externalId, 'SUCCESS');
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.data.webhook).toBe('ACCEPTED');
    const done = await waitFor(a.id, ['SUCCEEDED', 'FAILED', 'UNKNOWN']);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.paymentId).toBeTruthy();
    expect(done.receiptNumber).toMatch(/^LYCEE-DEMO-\d{4}-\d{6}$/);
    expect(await paymentsOfAttempt(a.id)).toBe(1);
    succeeded = { id: a.id, externalId: a.externalId };

    const acc = (await ctx.http.get(`/api/v1/students/${studentId}/fees`).set(bearer(finance))).body
      .data;
    expect(acc.totals.paid).toBe(50000);
    const fee = (acc.fees as { installments: { id: string; status: string }[] }[])[0]!;
    expect(fee.installments.find((i) => i.id === installmentIds[0])!.status).toBe('PAID');
    const payment = (acc.payments as { id: string; source: string; method: string }[]).find(
      (p) => p.id === done.paymentId,
    )!;
    expect(payment.source).toBe('ELECTRONIC');
    expect(payment.method).toBe('MOBILE_MONEY');

    const tl = await ctx.http.get(`/api/v1/payment-attempts/${a.id}`).set(bearer(direction));
    expect(tl.status).toBe(200);
    expect(tl.body.data.providerTransaction.normalizedStatus).toBe('SUCCEEDED');
    expect(tl.body.data.webhooks).toHaveLength(1);
    expect(tl.body.data.webhooks[0].processedAt).toBeTruthy();
    expect(tl.body.data.payment.receiptNumber).toBe(done.receiptNumber);
    expect((tl.body.data.audit as { action: string }[]).map((x) => x.action)).toContain(
      'payment_attempt.succeeded',
    );
    expect(JSON.stringify(tl.body)).not.toContain('whsec');

    // Reçu : mention « Encaissé par … via Provider de démonstration ».
    const receipt = await ctx.http
      .get(`/api/v1/payments/${done.paymentId}/receipt`)
      .set(bearer(finance));
    expect(receipt.body.data.snapshot.payment.channel).toContain('via Provider de démonstration');
  });

  it('P5 / P14 — dix webhooks identiques : un seul traité ; signature invalide : 400 sans trace', async () => {
    const body = JSON.stringify({
      id: `evt_dup_${randomUUID().slice(0, 8)}`,
      event: 'transaction.success',
      transactionId: succeeded.externalId,
      attemptId: succeeded.id,
      amount: 50000,
      status: 'SUCCESS',
      timestamp: new Date().toISOString(),
    });
    const url = `/api/v1/webhooks/payments/fake/${ac().payments.webhookToken}`;
    const outcomes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await ctx.http
        .post(url)
        .set('Content-Type', 'application/json')
        .set('x-fake-signature', sign(body))
        .send(body);
      expect(r.status).toBe(200);
      outcomes.push(r.body.outcome as string);
    }
    expect(outcomes.filter((o) => o === 'ACCEPTED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'DUPLICATE')).toHaveLength(9);
    await sleep(1500);
    expect(await paymentsOfAttempt(succeeded.id)).toBe(1);
    const events = await ctx.owner.query<{ n: number }>(
      `select count(*)::int as n from webhook_events where external_transaction_id = $1`,
      [succeeded.externalId],
    );
    expect(events.rows[0]!.n).toBe(2); // le webhook de la caisse factice + ce rejeu (9 doublons ignorés)

    const bad = await ctx.http
      .post(url)
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', 'deadbeef')
      .send(body);
    expect(bad.status).toBe(400);
    expect(bad.body.outcome).toBe('INVALID_SIGNATURE');
    const unknown = await ctx.http
      .post(`/api/v1/webhooks/payments/fake/pas-un-jeton-connu`)
      .set('x-fake-signature', sign(body))
      .send(body);
    expect(unknown.status).toBe(404);
    const after = await ctx.owner.query<{ n: number }>(
      `select count(*)::int as n from webhook_events where external_transaction_id = $1`,
      [succeeded.externalId],
    );
    expect(after.rows[0]!.n).toBe(2);
  });

  it('P2 / P4 — échec et annulation : tentative terminale, aucun paiement, nouvelle tentative possible', async () => {
    const failed = await startAttempt(20000);
    expect((await payFake(failed.externalId, 'FAILED')).status).toBe(200);
    const f = await waitFor(failed.id, ['FAILED']);
    expect(f.failureCode).toBe('DECLINED');
    expect(await paymentsOfAttempt(failed.id)).toBe(0);

    const cancelled = await startAttempt(20000);
    expect((await payFake(cancelled.externalId, 'CANCELLED')).status).toBe(200);
    const c = await waitFor(cancelled.id, ['CANCELLED']);
    expect(c.failureCode).toBe('CANCELLED');
    // Notification « paiement non abouti » au payeur (via outbox → worker → in-app).
    const start = Date.now();
    let n = 0;
    while (Date.now() - start < 15_000) {
      n = (
        await ctx.owner.query<{ n: number }>(
          `select count(*)::int as n from notifications where kind = 'PAYMENT_FAILED' and recipient_user_id = $1`,
          [ac().parentUser.userId],
        )
      ).rows[0]!.n;
      if (n >= 1) break;
      await sleep(300);
    }
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('P6 / P9 — retour du parent sans webhook : la vérification suffit ; cinq confirmations concurrentes → un paiement', async () => {
    const a = await startAttempt(10000, [installmentIds[1]!]);
    const fake = ctx.app.get(ProviderRegistry).fake!;
    await fake.complete(a.externalId, 'SUCCESS'); // état côté provider, sans webhook
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.http
          .post(`/api/v1/me/children/${studentId}/payment-attempts/${a.id}/confirm`)
          .set(bearer(parent))
          .send({ externalId: a.externalId }),
      ),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(results.every((r) => r.body.data.status === 'SUCCEEDED')).toBe(true);
    expect(await paymentsOfAttempt(a.id)).toBe(1);
    const acc = (await ctx.http.get(`/api/v1/students/${studentId}/fees`).set(bearer(finance))).body
      .data;
    const fee = (
      acc.fees as { installments: { id: string; status: string; amountAllocated: number }[] }[]
    )[0]!;
    expect(fee.installments.find((i) => i.id === installmentIds[1])!).toMatchObject({
      status: 'PARTIALLY_PAID',
      amountAllocated: 10000,
    });
  });

  it('P13 — montant vérifié ≠ montant demandé : UNKNOWN, aucune allocation, revue puis résolution', async () => {
    const a = await startAttempt(10000);
    const fake = ctx.app.get(ProviderRegistry).fake!;
    await fake.complete(a.externalId, 'SUCCESS', { amount: 9000 });
    const r = await ctx.http
      .post(`/api/v1/me/children/${studentId}/payment-attempts/${a.id}/confirm`)
      .set(bearer(parent))
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('UNKNOWN');
    expect(r.body.data.reviewStatus).toBe('OPEN');
    expect(await paymentsOfAttempt(a.id)).toBe(0);

    const pending = await ctx.http.get('/api/v1/payment-attempts/pending').set(bearer(finance));
    expect(pending.status).toBe(200);
    expect((pending.body.data.unknown as { id: string }[]).some((x) => x.id === a.id)).toBe(true);
    expect(pending.body.data.providerHealth).toMatchObject({
      provider: 'FAKE',
      circuitOpen: false,
    });

    const re = await ctx.http
      .post(`/api/v1/payment-attempts/${a.id}/reverify`)
      .set(bearer(finance));
    expect(re.status).toBe(200);
    expect(re.body.data.status).toBe('UNKNOWN'); // l'écart persiste
    expect(
      (
        await ctx.http
          .post(`/api/v1/payment-attempts/${a.id}/resolve`)
          .set(bearer(finance))
          .send({ note: 'x' })
      ).status,
    ).toBe(422);
    const resolved = await ctx.http
      .post(`/api/v1/payment-attempts/${a.id}/resolve`)
      .set(bearer(finance))
      .send({ note: 'Écart de 1 000 FCFA imputable aux frais : remboursé au parent en espèces' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({ status: 'FAILED', reviewStatus: 'RESOLVED' });
    expect(
      (await ctx.http.get(`/api/v1/payment-attempts/${a.id}`).set(bearer(direction))).status,
    ).toBe(200);
  });

  it('P7 — provider indisponible à initiate : 503 PROVIDER_UNAVAILABLE, tentative FAILED, disjoncteur', async () => {
    expect(
      (
        await ctx.http
          .post('/api/v1/dev/fake-provider/outage')
          .set(bearer(admin))
          .send({ on: true })
      ).status,
    ).toBe(200);
    try {
      for (let i = 0; i < 5; i++) {
        const res = await ctx.http
          .post(`/api/v1/me/children/${studentId}/payment-attempts`)
          .set(bearer(parent))
          .set(key())
          .send({ amount: 5000 });
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('PROVIDER_UNAVAILABLE');
      }
      const health = (await ctx.http.get('/api/v1/payment-attempts/pending').set(bearer(finance)))
        .body.data.providerHealth as { circuitOpen: boolean };
      expect(health.circuitOpen).toBe(true);
      const list = await ctx.http
        .get(`/api/v1/payment-attempts?status=FAILED&studentId=${studentId}`)
        .set(bearer(finance));
      expect(
        (list.body.data as { failureCode: string }[]).filter(
          (x) => x.failureCode === 'PROVIDER_UNAVAILABLE',
        ).length,
      ).toBeGreaterThanOrEqual(5);
    } finally {
      await ctx.http
        .post('/api/v1/dev/fake-provider/outage')
        .set(bearer(admin))
        .send({ on: false });
      await ctx.app.get(ProviderRegistry).resetCircuit(T().id, 'FAKE');
    }
    // Disjoncteur refermé : une nouvelle tentative repart.
    const ok = await startAttempt(5000);
    expect(ok.status).toBe('PENDING');
  });

  it('P3 / P8 — réconciliation : une tentative sans webhook est confirmée ; les périmées expirent ou passent en revue', async () => {
    const reconciliation = ctx.app.get(ReconciliationService);
    const a = await startAttempt(5000);
    await ctx.app.get(ProviderRegistry).fake!.complete(a.externalId, 'SUCCESS');
    await ctx.owner.query(
      `update payment_attempts set next_check_at = now() - interval '1 minute' where id = $1`,
      [a.id],
    );
    const r = await reconciliation.reconcilePending(T().id);
    expect(r.changed).toBeGreaterThanOrEqual(1);
    expect((await attemptOf(a.id)).status).toBe('SUCCEEDED');
    expect(await paymentsOfAttempt(a.id)).toBe(1);

    // Périmées : sans identifiant provider → EXPIRED ; avec identifiant mais provider muet → UNKNOWN + revue.
    const noExt = randomUUID();
    const withExt = randomUUID();
    await ctx.owner.query(
      `insert into payment_attempts (id, tenant_id, student_id, amount, currency, provider, status, external_id, expires_at, metadata)
       values ($1, $2, $3, 5000, 'XOF', 'FAKE', 'PENDING', null, now() - interval '2 days', '{}'),
              ($4, $2, $3, 5000, 'XOF', 'FAKE', 'PROCESSING', 'fake_mute_' || $4, now() - interval '2 days', '{}')`,
      [noExt, T().id, studentId, withExt],
    );
    const stale = await reconciliation.expireStale(T().id);
    expect(stale.expired).toBeGreaterThanOrEqual(1);
    expect(stale.unknown).toBeGreaterThanOrEqual(1);
    const rows = await ctx.owner.query<{ id: string; status: string; review_status: string }>(
      `select id, status, review_status from payment_attempts where id = any($1)`,
      [[noExt, withExt]],
    );
    expect(rows.rows.find((x) => x.id === noExt)!.status).toBe('EXPIRED');
    expect(rows.rows.find((x) => x.id === withExt)).toMatchObject({
      status: 'UNKNOWN',
      review_status: 'OPEN',
    });
  });

  it('réconciliation quotidienne : une transaction réussie inconnue chez nous devient orpheline, puis est traitée', async () => {
    const fake = ctx.app.get(ProviderRegistry).fake!;
    // Une transaction côté provider sans tentative Polaris (le parent a payé, on a tout perdu).
    const orphan = await fake.initiate(
      { secrets: {}, environment: 'SANDBOX' },
      {
        attemptId: randomUUID(),
        amount: 12345,
        currency: 'XOF',
        description: 'orpheline',
        customer: { firstName: 'X', lastName: 'Y' },
        callbackUrl: 'http://localhost/x',
        webhookUrl: 'http://localhost/w',
      },
    );
    await fake.complete(orphan.externalId!, 'SUCCESS');
    const today = new Date().toISOString().slice(0, 10);
    const run = await ctx.http
      .post('/api/v1/payment-reconciliation/run')
      .set(bearer(finance))
      .send({ day: today });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.data.status).toBe('DISCREPANCIES');
    const found = (
      run.body.data.orphans as { externalId: string; amount: number; resolved: boolean }[]
    ).find((o) => o.externalId === orphan.externalId);
    expect(found).toMatchObject({ amount: 12345, resolved: false });
    expect(run.body.data.mismatches).toEqual([]);

    const pending = await ctx.http.get('/api/v1/payment-attempts/pending').set(bearer(finance));
    expect(
      (pending.body.data.orphans as { externalId: string }[]).some(
        (o) => o.externalId === orphan.externalId,
      ),
    ).toBe(true);
    const resolved = await ctx.http
      .post(`/api/v1/payment-reconciliation/${run.body.data.id}/orphans/resolve`)
      .set(bearer(finance))
      .send({
        externalId: orphan.externalId,
        note: 'Encaissement saisi manuellement, reçu n° 000009',
      });
    expect(resolved.status).toBe(200);
    expect(
      (resolved.body.data.orphans as { externalId: string; resolved: boolean }[]).find(
        (o) => o.externalId === orphan.externalId,
      )!.resolved,
    ).toBe(true);
    // Une nouvelle exécution ne la signale plus.
    const again = await ctx.http
      .post('/api/v1/payment-reconciliation/run')
      .set(bearer(finance))
      .send({ day: today });
    const o2 = (again.body.data.orphans as { externalId: string; resolved: boolean }[]).find(
      (o) => o.externalId === orphan.externalId,
    );
    expect(o2?.resolved).toBe(true);
    expect(
      (await ctx.http.get('/api/v1/payment-reconciliation').set(bearer(direction))).status,
    ).toBe(200);
  });

  it("espace parent : historique des tentatives ; un parent n'accède pas aux routes finance", async () => {
    const list = await ctx.http
      .get(`/api/v1/me/children/${studentId}/payment-attempts`)
      .set(bearer(parent));
    expect(list.status).toBe(200);
    expect((list.body.data as unknown[]).length).toBeGreaterThanOrEqual(5);
    expect((await ctx.http.get('/api/v1/payment-attempts').set(bearer(parent))).status).toBe(403);
    expect(
      (await ctx.http.get('/api/v1/payment-attempts/pending').set(bearer(parent))).status,
    ).toBe(403);
    // Un autre enfant (non rattaché à ce parent) → 404.
    const other = ac().studentIds[2]!;
    expect(
      (await ctx.http.get(`/api/v1/me/children/${other}/payment-options`).set(bearer(parent)))
        .status,
    ).toBe(404);
  });
});
