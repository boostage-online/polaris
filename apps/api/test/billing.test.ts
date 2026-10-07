import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { UnpaidService } from '../src/modules/billing';
import { bearer, login, loginAs, seed, startApp, type Session, type TestContext } from './helpers';

/** Phase 4 — sous-grand-livre de créances (ADR-0005) : catalogue, affectation, caisse, reçus, impayés, parent. Tenant « lycée ». */
describe('Frais et paiements', () => {
  let ctx: TestContext;
  let finance: Session;
  let direction: Session;
  const L = () => seed.tenants.lycee;
  const ac = () => L().academic;
  const b = () => ac().billing;
  const key = () => ({ 'Idempotency-Key': randomUUID() });
  const day = (offset: number) =>
    new Date(Date.now() + offset * 24 * 3_600_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    ctx = await startApp();
    finance = await loginAs(ctx, 'lycee', 'FINANCE');
    direction = await loginAs(ctx, 'lycee', 'DIRECTION');
  });
  afterAll(() => ctx.close());

  let cantineId: string;
  it('catalogue : catégories, grille avec échéancier (Σ = total), code unique', async () => {
    const cats = await ctx.http.get('/api/v1/fee-categories').set(bearer(finance));
    expect(cats.status, JSON.stringify(cats.body)).toBe(200);
    expect((cats.body.data as { code: string }[]).some((c) => c.code === 'SCOLARITE')).toBe(true);
    const cat = await ctx.http
      .post('/api/v1/fee-categories')
      .set(bearer(finance))
      .send({ code: 'CANTINE', name: 'Cantine' });
    expect(cat.status, JSON.stringify(cat.body)).toBe(201);
    const st = await ctx.http
      .post('/api/v1/fee-structures')
      .set(bearer(finance))
      .send({
        categoryId: cat.body.data.id,
        code: 'CANT-6E',
        name: 'Cantine 6e',
        appliesTo: { levelIds: [ac().levelIds.sixieme] },
        schedule: [
          { seq: 1, label: 'Cantine 1er semestre', amount: 15000, dueDate: day(7) },
          { seq: 2, label: 'Cantine 2nd semestre', amount: 15000, dueDate: '2027-02-01' },
        ],
      });
    expect(st.status, JSON.stringify(st.body)).toBe(201);
    cantineId = st.body.data.id as string;
    expect(st.body.data.totalAmount).toBe(30000);
    expect(st.body.data.schedule).toHaveLength(2);
    const dup = await ctx.http
      .post('/api/v1/fee-structures')
      .set(bearer(finance))
      .send({
        categoryId: cat.body.data.id,
        code: 'CANT-6E',
        name: 'x',
        schedule: [{ seq: 1, label: 'a', amount: 1, dueDate: '2027-01-01' }],
      });
    expect(dup.status).toBe(409);
    const list = await ctx.http.get('/api/v1/fee-structures').set(bearer(direction));
    expect((list.body.data as { id: string }[]).some((s) => s.id === b().structureId)).toBe(true);
  });

  it("le compte de l'élève seedé : dû 150 000, payé 60 000, échéances PAID / PARTIALLY_PAID / PENDING, reçu n° 1", async () => {
    const res = await ctx.http
      .get(`/api/v1/students/${ac().studentIds[0]}/fees`)
      .set(bearer(finance));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const acc = res.body.data as {
      totals: { due: number; paid: number; balance: number; overdue: number };
      fees: { installments: { status: string }[] }[];
      payments: { receiptNumber: string | null }[];
    };
    expect(acc.totals).toMatchObject({ due: 150000, paid: 60000, balance: 90000, overdue: 0 });
    expect(acc.fees[0]!.installments.map((i) => i.status)).toEqual([
      'PAID',
      'PARTIALLY_PAID',
      'PENDING',
    ]);
    expect(acc.payments[0]!.receiptNumber).toBe(b().receiptNumber);
  });

  it("l'affectation de masse crée les créances manquantes de la cible et n'ajoute rien au second passage", async () => {
    const first = await ctx.http
      .post('/api/v1/fees/assign')
      .set(bearer(finance))
      .send({ feeStructureId: cantineId });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.targeted).toBeGreaterThanOrEqual(4);
    expect(first.body.data.created).toBe(first.body.data.targeted);
    const again = await ctx.http
      .post('/api/v1/fees/assign')
      .set(bearer(finance))
      .send({ feeStructureId: cantineId });
    expect(again.body.data.created).toBe(0);
    expect(again.body.data.skipped).toBe(again.body.data.targeted);
    const locked = await ctx.http
      .patch(`/api/v1/fee-structures/${cantineId}`)
      .set(bearer(finance))
      .send({ schedule: [{ seq: 1, label: 'x', amount: 5, dueDate: '2027-01-01' }] });
    expect(locked.status).toBe(409); // échéancier figé une fois affecté
  });

  let paymentS2: string;
  it("l'encaissement manuel exige une Idempotency-Key, alloue sur les échéances ciblées, émet un reçu, et se rejoue sans doublon", async () => {
    const s2 = ac().studentIds[1]!;
    const body = {
      amount: 70000,
      method: 'CASH',
      payerName: 'M. AGBODJAN',
      reference: 'BRD-0002',
      installmentIds: [b().installmentIds.s2[0], b().installmentIds.s2[1]],
    };
    expect(
      (
        await ctx.http
          .post(`/api/v1/students/${s2}/payments/manual`)
          .set(bearer(finance))
          .send(body)
      ).status,
    ).toBe(422);
    const k = key();
    const res = await ctx.http
      .post(`/api/v1/students/${s2}/payments/manual`)
      .set(bearer(finance))
      .set(k)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    paymentS2 = res.body.data.id as string;
    expect(res.body.data.allocatedAmount).toBe(70000);
    expect(res.body.data.creditAmount).toBe(0);
    expect(res.body.data.receiptNumber).toBe('LYCEE-DEMO-2026-000002');
    expect((res.body.data.allocations as { amount: number }[]).map((a) => a.amount)).toEqual([
      50000, 20000,
    ]);
    const replay = await ctx.http
      .post(`/api/v1/students/${s2}/payments/manual`)
      .set(bearer(finance))
      .set(k)
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(paymentS2);
    const list = await ctx.http.get(`/api/v1/payments?studentId=${s2}`).set(bearer(finance));
    expect((list.body.data as unknown[]).length).toBe(1);
    const acc = await ctx.http.get(`/api/v1/students/${s2}/fees`).set(bearer(finance));
    expect(acc.body.data.totals.paid).toBe(70000);
    const scol = (
      acc.body.data.fees as { feeStructureId: string; installments: { status: string }[] }[]
    ).find((f) => f.feeStructureId === b().structureId)!;
    expect(scol.installments.map((i) => i.status)).toEqual(['PAID', 'PARTIALLY_PAID', 'PENDING']);
  });

  it('un trop-perçu devient un crédit, appliqué automatiquement à la prochaine créance ; un ajustement ne passe jamais sous le payé', async () => {
    const s3 = ac().studentIds[2]!;
    const res = await ctx.http
      .post(`/api/v1/students/${s3}/payments/manual`)
      .set(bearer(finance))
      .set(key())
      .send({ amount: 200000, method: 'BANK_TRANSFER', reference: 'VIR-77' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.allocatedAmount).toBe(180000); // 150 000 scolarité + 30 000 cantine
    expect(res.body.data.creditAmount).toBe(20000);
    let acc = (await ctx.http.get(`/api/v1/students/${s3}/fees`).set(bearer(finance))).body.data;
    expect(acc.totals.credit).toBe(20000);
    expect(acc.totals.balance).toBe(0);
    const scolFee = (acc.fees as { id: string; feeStructureId: string }[]).find(
      (f) => f.feeStructureId === b().structureId,
    )!;
    const adj = await ctx.http.post('/api/v1/fees/adjustments').set(bearer(finance)).send({
      studentFeeId: scolFee.id,
      amount: 25000,
      kind: 'PENALTY',
      reason: 'Pénalité de retard exceptionnelle',
    });
    expect(adj.status, JSON.stringify(adj.body)).toBe(201);
    acc = adj.body.data;
    expect(acc.totals.credit).toBe(0);
    expect(acc.totals.balance).toBe(5000); // 25 000 de pénalité − 20 000 de crédit appliqué
    expect((acc.credits as { status: string }[])[0]!.status).toBe('APPLIED');
    const s1Fee = b().feeIds.s1;
    const tooLow = await ctx.http
      .post('/api/v1/fees/adjustments')
      .set(bearer(finance))
      .send({ studentFeeId: s1Fee, amount: -100000, kind: 'SCHOLARSHIP', reason: 'Bourse' });
    expect(tooLow.status).toBe(422);
    const ok = await ctx.http
      .post('/api/v1/fees/adjustments')
      .set(bearer(finance))
      .send({ studentFeeId: s1Fee, amount: -30000, kind: 'DISCOUNT', reason: 'Remise fratrie' });
    expect(ok.status).toBe(201);
    // 150 000 (scolarité) + 30 000 (cantine affectée plus haut) − 30 000 de remise
    expect(ok.body.data.totals).toMatchObject({ due: 150000, paid: 60000, balance: 90000 });
  });

  it("l'annulation compensatoire contre-passe les allocations, émet un reçu d'annulation, et est définitive", async () => {
    const s2 = ac().studentIds[1]!;
    const noReason = await ctx.http
      .post(`/api/v1/payments/${paymentS2}/reverse`)
      .set(bearer(finance))
      .send({});
    expect(noReason.status).toBe(422);
    const res = await ctx.http
      .post(`/api/v1/payments/${paymentS2}/reverse`)
      .set(bearer(finance))
      .send({ reason: 'Erreur de montant saisi' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('REVERSED');
    const acc = (await ctx.http.get(`/api/v1/students/${s2}/fees`).set(bearer(finance))).body.data;
    expect(acc.totals.paid).toBe(0);
    const scol = (
      acc.fees as { feeStructureId: string; installments: { status: string }[] }[]
    ).find((f) => f.feeStructureId === b().structureId)!;
    expect(scol.installments.map((i) => i.status)).toEqual(['OVERDUE', 'PENDING', 'PENDING']);
    const cancel = await ctx.http
      .get(`/api/v1/payments/${paymentS2}/receipt?kind=CANCELLATION`)
      .set(bearer(finance));
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.kind).toBe('CANCELLATION');
    expect(cancel.body.data.snapshot.cancels).toBe('LYCEE-DEMO-2026-000002');
    expect(
      (
        await ctx.http
          .post(`/api/v1/payments/${paymentS2}/reverse`)
          .set(bearer(finance))
          .send({ reason: 'bis' })
      ).status,
    ).toBe(409);
    // Le paiement lui-même est immuable en base (trigger).
    await expect(
      ctx.owner.query(`update payments set amount = 1 where id = $1`, [paymentS2]),
    ).rejects.toThrow(/immuable/);
  });

  it('reçu PDF et vérification publique par empreinte', async () => {
    const s3 = ac().studentIds[2]!;
    const pay = (
      (await ctx.http.get(`/api/v1/payments?studentId=${s3}`).set(bearer(finance))).body.data as {
        id: string;
        receiptNumber: string;
      }[]
    )[0]!;
    const pdf = await ctx.http
      .get(`/api/v1/payments/${pay.id}/receipt.pdf`)
      .set(bearer(finance))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const receipt = (await ctx.http.get(`/api/v1/payments/${pay.id}/receipt`).set(bearer(finance)))
      .body.data as { number: string; verifyUrl: string };
    const hash = receipt.verifyUrl.split('/').pop()!;
    const ok = await ctx.http.get(`/api/v1/receipts/verify/lycee-demo/${receipt.number}/${hash}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      valid: true,
      status: 'VALID',
      amount: 200000,
      tenantName: 'Lycée de démonstration',
    });
    const bad = await ctx.http.get(
      `/api/v1/receipts/verify/lycee-demo/${receipt.number}/0000000000000000`,
    );
    expect(bad.body.data.status).toBe('UNKNOWN');
    const reversedReceipt = (
      await ctx.http.get(`/api/v1/payments/${paymentS2}/receipt`).set(bearer(finance))
    ).body.data as { number: string; verifyUrl: string };
    const cancelled = await ctx.http.get(
      `/api/v1/receipts/verify/lycee-demo/${reversedReceipt.number}/${reversedReceipt.verifyUrl.split('/').pop()}`,
    );
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('impayés par échéance et par classe ; rappels manuels dédoublonnés ; rappels planifiés J−7', async () => {
    const s4 = ac().studentIds[3]!;
    const overdue = await ctx.http
      .get('/api/v1/unpaid?status=OVERDUE&limit=200')
      .set(bearer(finance));
    expect(overdue.status).toBe(200);
    const mine = (
      overdue.body.data as { student: { id: string }; id: string; status: string }[]
    ).filter((i) => i.student.id === s4);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine.every((i) => i.status === 'OVERDUE')).toBe(true);
    const byGroup = await ctx.http.get('/api/v1/unpaid/by-group').set(bearer(direction));
    expect(
      (byGroup.body.data as { groupName: string; due: number }[]).find(
        (g) => g.groupName === '6e B',
      )?.due,
    ).toBeGreaterThan(0);

    const remind = await ctx.http
      .post('/api/v1/unpaid/reminders')
      .set(bearer(finance))
      .send({ installmentIds: [mine[0]!.id], message: 'Merci de passer à la caisse' });
    expect(remind.status, JSON.stringify(remind.body)).toBe(200);
    expect(remind.body.data.installments).toBe(1);
    expect(
      (
        await ctx.http
          .post('/api/v1/unpaid/reminders')
          .set(bearer(finance))
          .send({ installmentIds: [mine[0]!.id] })
      ).body.data.skipped,
    ).toBe(1);

    const db = ctx.app.get(DatabaseService);
    const unpaid = ctx.app.get(UnpaidService);
    const first = await db.withTenantTx(L().id, (tx) => unpaid.scheduleReminders(tx));
    expect(first.dueSoon).toBeGreaterThanOrEqual(3); // cantine 1er semestre à J+7 pour les élèves non soldés
    const second = await db.withTenantTx(L().id, (tx) => unpaid.scheduleReminders(tx));
    expect(second.dueSoon).toBe(0);
    const events = await ctx.owner.query(
      `select count(*)::int as n from outbox_events where event_type = 'InstallmentsDueSoon' and tenant_id = $1`,
      [L().id],
    );
    expect(events.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('exports CSV, tableau de bord finance, contrôle d’intégrité', async () => {
    const csv = await ctx.http.get('/api/v1/exports/payments.csv').set(bearer(finance));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('LYCEE-DEMO-2026-000001');
    const aged = await ctx.http.get('/api/v1/exports/aged-balance.csv').set(bearer(finance));
    expect(aged.text).toContain('retard_0_30');
    expect((await ctx.http.get('/api/v1/exports/unpaid.csv').set(bearer(direction))).status).toBe(
      403,
    );

    const dash = await ctx.http.get('/api/v1/dashboards/finance').set(bearer(direction));
    expect(dash.status, JSON.stringify(dash.body)).toBe(200);
    expect(dash.body.data.year.invoiced).toBeGreaterThanOrEqual(600000);
    expect(dash.body.data.year.paid).toBeGreaterThanOrEqual(260000);
    expect(dash.body.data.today.count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(dash.body.data.byGroup)).toBe(true);

    const check = await ctx.http.post('/api/v1/fees/integrity-check').set(bearer(finance));
    expect(check.status).toBe(200);
    expect(check.body.data.mismatches).toBe(0);
  });

  it('le parent voit les frais de ses enfants avec le droit finance, et le reçu de son paiement', async () => {
    const parent = await login(ctx, ac().parentUser.email);
    const res = await ctx.http.get('/api/v1/me/children/finance').set(bearer(parent));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s1 = (
      res.body.data as {
        student: { id: string };
        totals: { paid: number };
        nextInstallment: { seq: number; feeName?: string } | null;
      }[]
    ).find((c) => c.student.id === ac().studentIds[0]);
    expect(s1).toBeDefined();
    expect(s1!.totals.paid).toBe(60000);
    expect(s1!.nextInstallment?.feeName).toBe('Cantine 6e'); // la plus proche échéance ouverte
    expect(
      (await ctx.http.get(`/api/v1/me/children/${ac().studentIds[0]}/fees`).set(bearer(parent)))
        .status,
    ).toBe(200);
    expect(
      (await ctx.http.get(`/api/v1/me/children/${ac().studentIds[3]}/fees`).set(bearer(parent)))
        .status,
    ).toBe(404);
    const receipt = await ctx.http
      .get(`/api/v1/me/children/${ac().studentIds[0]}/payments/${b().paymentId}/receipt`)
      .set(bearer(parent));
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.number).toBe(b().receiptNumber);
    expect(
      (await ctx.http.get(`/api/v1/students/${ac().studentIds[0]}/fees`).set(bearer(parent)))
        .status,
    ).toBe(403);
  });
});
