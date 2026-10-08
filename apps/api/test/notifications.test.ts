import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationPlanner } from '../src/modules/notifications';
import { bearer, login, loginAs, seed, startApp, type Session, type TestContext } from './helpers';

/** Phase 3 — moteur de notifications : planification idempotente, agrégation, préférences, quota SMS, journal. */
describe('Notifications', () => {
  let ctx: TestContext;
  let planner: NotificationPlanner;
  let admin: Session;
  let parent: Session;
  const L = () => seed.tenants.lycee;
  const ac = () => L().academic;
  const event = (
    id: string,
    marked: { studentId: string; status: 'ABSENT' | 'LATE'; lateMinutes: number | null }[],
  ) => ({
    id,
    type: 'AttendanceSheetSubmitted',
    tenantId: L().id,
    aggregateType: 'AttendanceSheet',
    aggregateId: ac().attendance.sheetId,
    payload: {
      sheetId: ac().attendance.sheetId,
      sessionId: ac().sessionId,
      startsAt: '2026-10-12T07:00:00.000Z',
      subjectName: 'Mathématiques',
      groupName: '6e A',
      retroactive: false,
      marked: marked.map((m) => ({ ...m, recordId: m.studentId })),
    },
    occurredAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    ctx = await startApp();
    planner = ctx.app.get(NotificationPlanner);
    admin = await loginAs(ctx, 'lycee', 'ADMIN');
    parent = await login(ctx, ac().parentUser.email);
  });
  afterAll(() => ctx.close());

  it("un appel soumis → un SMS agrégé et une notification in-app par tuteur ; rejouer l'événement ne duplique rien", async () => {
    const before = ctx.sms.sent.length;
    const [s1, s2] = ac().studentIds as [string, string];
    await planner.handle(
      event('evt-attendance-1', [
        { studentId: s1, status: 'ABSENT', lateMinutes: null },
        { studentId: s2, status: 'LATE', lateMinutes: 10 },
      ]),
    );
    const toParent = ctx.sms.sent.slice(before).filter((m) => m.to === ac().parentUser.phone);
    expect(toParent).toHaveLength(1);
    expect(toParent[0]!.body).toContain('Aïcha');
    expect(toParent[0]!.body.length).toBeLessThanOrEqual(160);

    const inbox = await ctx.http.get('/api/v1/me/notifications').set(bearer(parent));
    expect(inbox.status, JSON.stringify(inbox.body)).toBe(200);
    const items = inbox.body.data as {
      kind: string;
      channel: string;
      body: string;
      readAt: string | null;
    }[];
    expect(
      items.some(
        (n) => n.kind === 'STUDENT_ABSENT' && n.channel === 'INAPP' && n.body.includes('Aïcha'),
      ),
    ).toBe(true);
    expect(inbox.body.meta.unread).toBeGreaterThanOrEqual(1);

    const count = async () =>
      Number(
        (
          await ctx.owner.query(
            `select count(*) from notifications where tenant_id = $1 and event_id = 'evt-attendance-1'`,
            [L().id],
          )
        ).rows[0].count,
      );
    const n1 = await count();
    const totalBefore = ctx.sms.sent.length;
    await planner.handle(
      event('evt-attendance-1', [
        { studentId: s1, status: 'ABSENT', lateMinutes: null },
        { studentId: s2, status: 'LATE', lateMinutes: 10 },
      ]),
    );
    expect(await count()).toBe(n1);
    expect(ctx.sms.sent.length).toBe(totalBefore);
  });

  it('un tuteur non invité (sans compte) ne reçoit rien ; un retard seul ne déclenche pas de SMS par défaut', async () => {
    const before = ctx.sms.sent.length;
    const s3 = ac().studentIds[2]!; // tuteur « Pascal » non invité
    await planner.handle(
      event('evt-attendance-2', [{ studentId: s3, status: 'ABSENT', lateMinutes: null }]),
    );
    expect(ctx.sms.sent.length).toBe(before);
    const s2 = ac().studentIds[1]!;
    await planner.handle(
      event('evt-attendance-3', [{ studentId: s2, status: 'LATE', lateMinutes: 5 }]),
    );
    expect(ctx.sms.sent.length).toBe(before);
  });

  it('les préférences du tuteur sont respectées (SMS pour les retards)', async () => {
    const prefs = await ctx.http
      .put('/api/v1/me/notifications/preferences')
      .set(bearer(parent))
      .send({ preferences: { STUDENT_LATE: ['SMS', 'INAPP'] } });
    expect(prefs.status, JSON.stringify(prefs.body)).toBe(200);
    expect(prefs.body.data.preferences.STUDENT_LATE).toEqual(['SMS', 'INAPP']);
    expect(prefs.body.data.preferences.STUDENT_ABSENT).toEqual(['SMS', 'INAPP']);
    const before = ctx.sms.sent.length;
    await planner.handle(
      event('evt-attendance-4', [
        { studentId: ac().studentIds[0]!, status: 'LATE', lateMinutes: 5 },
      ]),
    );
    expect(ctx.sms.sent.length).toBe(before + 1);
  });

  it('le quota SMS mensuel suspend les SMS (in-app conservé) ; le renvoi repart une fois le plafond relevé', async () => {
    expect(
      (
        await ctx.http
          .patch('/api/v1/tenant/settings')
          .set(bearer(admin))
          .send({ notifications: { smsMonthlyCap: 1 } })
      ).status,
    ).toBe(200);
    const before = ctx.sms.sent.length;
    await planner.handle(
      event('evt-attendance-5', [
        { studentId: ac().studentIds[0]!, status: 'ABSENT', lateMinutes: null },
      ]),
    );
    expect(ctx.sms.sent.length).toBe(before);
    const journal = await ctx.http
      .get(`/api/v1/notifications?studentId=${ac().studentIds[0]}&channel=SMS&status=SUPPRESSED`)
      .set(bearer(admin));
    expect(journal.status).toBe(200);
    const suppressed = (journal.body.data as { id: string; status: string }[])[0];
    expect(suppressed).toBeDefined();
    const usage = await ctx.http.get('/api/v1/notifications/usage').set(bearer(admin));
    expect(usage.body.data.cap).toBe(1);
    expect(usage.body.data.suppressed).toBeGreaterThanOrEqual(1);

    expect(
      (
        await ctx.http
          .patch('/api/v1/tenant/settings')
          .set(bearer(admin))
          .send({ notifications: { smsMonthlyCap: 2000 } })
      ).status,
    ).toBe(200);
    const resent = await ctx.http
      .post(`/api/v1/notifications/${suppressed!.id}/resend`)
      .set(bearer(admin));
    expect(resent.status, JSON.stringify(resent.body)).toBe(200);
    expect(resent.body.data.status).toBe('SENT');
    expect(ctx.sms.sent.length).toBe(before + 1);
    expect(
      (await ctx.http.post(`/api/v1/notifications/${suppressed!.id}/resend`).set(bearer(admin)))
        .status,
    ).toBe(409);
  });

  it('lecture : marquer une notification puis tout marquer comme lu', async () => {
    const inbox = await ctx.http.get('/api/v1/me/notifications?unread=true').set(bearer(parent));
    const first = (inbox.body.data as { id: string }[])[0];
    expect(first).toBeDefined();
    expect(
      (await ctx.http.post(`/api/v1/me/notifications/${first!.id}/read`).set(bearer(parent))).body
        .data.marked,
    ).toBe(1);
    await ctx.http.post('/api/v1/me/notifications/read-all').set(bearer(parent));
    expect(
      (await ctx.http.get('/api/v1/me/notifications').set(bearer(parent))).body.meta.unread,
    ).toBe(0);
    // Le journal est réservé à l'administration.
    expect((await ctx.http.get('/api/v1/notifications').set(bearer(parent))).status).toBe(403);
  });

  it("appels manquants : l'enseignant est prévenu in-app une fois par séance", async () => {
    const h = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
    const created = await ctx.http
      .post(`/api/v1/courses/${ac().courseIds.math6a}/sessions`)
      .set(bearer(admin))
      .send({ startsAt: h(5), endsAt: h(4) });
    expect(created.status).toBe(201);
    const first = await planner.planMissingSheets(L().id);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(await planner.planMissingSheets(L().id)).toBe(0);
    const teacher = await loginAs(ctx, 'lycee', 'TEACHER');
    const inbox = await ctx.http.get('/api/v1/me/notifications').set(bearer(teacher));
    expect(
      (inbox.body.data as { kind: string; actionUrl: string | null }[]).some(
        (n) =>
          n.kind === 'ATTENDANCE_SHEET_MISSING' &&
          n.actionUrl === `/attendance/sessions/${created.body.data.id}`,
      ),
    ).toBe(true);
  });

  it('un encaissement prévient les tuteurs ayant la vue finance, avec le numéro de reçu', async () => {
    const before = ctx.sms.sent.length;
    await planner.handle({
      id: 'evt-payment-1',
      type: 'PaymentRecorded',
      tenantId: L().id,
      aggregateType: 'Payment',
      aggregateId: ac().billing.paymentId,
      payload: {
        paymentId: ac().billing.paymentId,
        studentId: ac().studentIds[0],
        amount: 60000,
        currency: 'XOF',
        method: 'CASH',
        receiptNumber: ac().billing.receiptNumber,
        allocated: 60000,
        credit: 0,
      },
      occurredAt: new Date().toISOString(),
    });
    expect(ctx.sms.sent.length).toBe(before + 1);
    expect(ctx.sms.sent.at(-1)?.body).toContain(ac().billing.receiptNumber);
    expect(ctx.sms.sent.at(-1)?.body).toContain('60 000 FCFA');
  });

  it('une décision de justificatif prévient le tuteur auteur', async () => {
    const before = ctx.sms.sent.length;
    await planner.handle({
      id: 'evt-justif-1',
      type: 'JustificationReviewed',
      tenantId: L().id,
      aggregateType: 'AbsenceJustification',
      aggregateId: ac().attendance.justificationId,
      payload: {
        justificationId: ac().attendance.justificationId,
        studentId: ac().studentIds[0],
        decision: 'APPROVED',
        comment: null,
        submittedBy: ac().parentUser.userId,
        fromDate: '2026-10-12',
        toDate: '2026-10-12',
      },
      occurredAt: new Date().toISOString(),
    });
    expect(ctx.sms.sent.length).toBe(before + 1);
    expect(ctx.sms.sent.at(-1)?.body).toContain('accepté');
  });
});
