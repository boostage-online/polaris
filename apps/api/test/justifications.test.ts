import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, loginAs, seed, startApp, type Session, type TestContext } from './helpers';

/** Phase 3 — justificatifs (vie scolaire et parent) et vue parent de l'assiduité. Tenant « lycée ». */
describe('Justificatifs et espace parent', () => {
  let ctx: TestContext;
  let admin: Session;
  let studentLife: Session;
  let parent: Session;
  const ac = () => seed.tenants.lycee.academic;

  beforeAll(async () => {
    ctx = await startApp();
    admin = await loginAs(ctx, 'lycee', 'ADMIN');
    studentLife = await loginAs(ctx, 'lycee', 'STUDENT_LIFE');
    parent = await login(ctx, ac().parentUser.email);
  });
  afterAll(() => ctx.close());

  it('la file des justificatifs contient le dépôt seedé, plus ancien en premier', async () => {
    const res = await ctx.http
      .get('/api/v1/justifications?status=PENDING')
      .set(bearer(studentLife));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const j = (
      res.body.data as { id: string; recordCount: number; submittedByKind: string }[]
    ).find((x) => x.id === ac().attendance.justificationId);
    expect(j?.recordCount).toBe(1);
    expect(j?.submittedByKind).toBe('GUARDIAN');
  });

  it("le parent voit l'assiduité de ses enfants autorisés, pas celle des autres", async () => {
    const res = await ctx.http.get('/api/v1/me/children/summary').set(bearer(parent));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const kids = res.body.data as {
      student: { id: string };
      last30Days: { absent: number };
      alerts: number;
      pendingJustifications: number;
      recent: { status: string }[];
    }[];
    const s1 = kids.find((k) => k.student.id === ac().studentIds[0]);
    expect(s1).toBeDefined();
    expect(s1!.pendingJustifications).toBeGreaterThanOrEqual(1);
    expect(s1!.recent.some((r) => r.status === 'ABSENT')).toBe(true);

    const hist = await ctx.http
      .get(`/api/v1/me/children/${ac().studentIds[0]}/attendance?from=2026-10-01&to=2026-10-31`)
      .set(bearer(parent));
    expect(hist.status).toBe(200);
    expect(
      (hist.body.data as { recordId: string }[]).some(
        (h) => h.recordId === ac().attendance.recordIds.s1,
      ),
    ).toBe(true);
    expect(
      (
        await ctx.http
          .get(`/api/v1/me/children/${ac().studentIds[3]}/attendance`)
          .set(bearer(parent))
      ).status,
    ).toBe(404);
    expect(
      (await ctx.http.get(`/api/v1/students/${ac().studentIds[0]}/attendance`).set(bearer(parent)))
        .status,
    ).toBe(403);
  });

  let parentJustificationId: string;
  it("le dépôt par un parent dépend de la règle de l'établissement et du droit sur le lien", async () => {
    const body = {
      fromDate: '2026-10-12',
      toDate: '2026-10-12',
      reason: 'Malade, certificat à suivre',
    };
    const s1 = ac().studentIds[0]!;
    expect(
      (
        await ctx.http
          .post(`/api/v1/me/children/${s1}/justifications`)
          .set(bearer(parent))
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx.http
          .patch('/api/v1/tenant/settings')
          .set(bearer(admin))
          .send({ attendance: { guardianJustificationsEnabled: true } })
      ).status,
    ).toBe(200);
    const ok = await ctx.http
      .post(`/api/v1/me/children/${s1}/justifications`)
      .set(bearer(parent))
      .send(body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    parentJustificationId = ok.body.data.id as string;
    expect(ok.body.data.recordCount).toBe(1); // l'absence seedée d'Aïcha le 12/10
    expect(ok.body.data.submittedByKind).toBe('GUARDIAN');
    expect(
      (
        await ctx.http
          .post(`/api/v1/me/children/${ac().studentIds[3]}/justifications`)
          .set(bearer(parent))
          .send(body)
      ).status,
    ).toBe(404);
    const mine = await ctx.http.get(`/api/v1/me/children/${s1}/justifications`).set(bearer(parent));
    expect((mine.body.data as { id: string }[]).some((j) => j.id === parentJustificationId)).toBe(
      true,
    );
    // Le record rattaché est en attente d'excuse.
    const sheet = await ctx.http
      .get(`/api/v1/attendance-sheets/${ac().attendance.sheetId}`)
      .set(bearer(studentLife));
    expect(
      (sheet.body.data.records as { id: string; excuseStatus: string }[]).find(
        (r) => r.id === ac().attendance.recordIds.s1,
      )?.excuseStatus,
    ).toBe('PENDING');
  });

  it('accepter excuse les enregistrements couverts et recalcule les statistiques ; une décision est définitive', async () => {
    const res = await ctx.http
      .post(`/api/v1/justifications/${ac().attendance.justificationId}/review`)
      .set(bearer(studentLife))
      .send({ decision: 'APPROVED', comment: 'Certificat reçu' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    const sheet = await ctx.http
      .get(`/api/v1/attendance-sheets/${ac().attendance.sheetId}`)
      .set(bearer(studentLife));
    expect(
      (sheet.body.data.records as { id: string; excuseStatus: string }[]).find(
        (r) => r.id === ac().attendance.recordIds.s1,
      )?.excuseStatus,
    ).toBe('EXCUSED');
    const summary = await ctx.http
      .get(
        `/api/v1/students/${ac().studentIds[0]}/attendance/summary?from=2026-10-12&to=2026-10-12`,
      )
      .set(bearer(studentLife));
    expect(summary.body.data.excused).toBe(1);
    expect(summary.body.data.unjustified).toBe(0);
    expect(
      (
        await ctx.http
          .post(`/api/v1/justifications/${ac().attendance.justificationId}/review`)
          .set(bearer(studentLife))
          .send({ decision: 'REJECTED' })
      ).status,
    ).toBe(409);
  });

  it('demander un complément laisse le dossier en file ; refuser ne rétrograde jamais un enregistrement déjà excusé', async () => {
    const info = await ctx.http
      .post(`/api/v1/justifications/${parentJustificationId}/review`)
      .set(bearer(studentLife))
      .send({ decision: 'INFO_REQUESTED', comment: 'Merci de joindre le certificat' });
    expect(info.status).toBe(200);
    expect(info.body.data.status).toBe('INFO_REQUESTED');
    const queue = await ctx.http
      .get('/api/v1/justifications?status=INFO_REQUESTED')
      .set(bearer(studentLife));
    expect((queue.body.data as { id: string }[]).some((j) => j.id === parentJustificationId)).toBe(
      true,
    );
    const rej = await ctx.http
      .post(`/api/v1/justifications/${parentJustificationId}/review`)
      .set(bearer(studentLife))
      .send({ decision: 'REJECTED', comment: 'Hors délai' });
    expect(rej.status).toBe(200);
    const sheet = await ctx.http
      .get(`/api/v1/attendance-sheets/${ac().attendance.sheetId}`)
      .set(bearer(studentLife));
    expect(
      (sheet.body.data.records as { id: string; excuseStatus: string }[]).find(
        (r) => r.id === ac().attendance.recordIds.s1,
      )?.excuseStatus,
    ).toBe('EXCUSED');
    // Un enseignant ne décide pas.
    const teacher = await loginAs(ctx, 'lycee', 'TEACHER');
    expect((await ctx.http.get('/api/v1/justifications').set(bearer(teacher))).status).toBe(403);
  });

  it('la vie scolaire dépose aussi pour un élève (un intervalle sans enregistrement couvert reste valide)', async () => {
    const res = await ctx.http.post('/api/v1/justifications').set(bearer(studentLife)).send({
      studentId: ac().studentIds[2],
      fromDate: '2026-11-02',
      toDate: '2026-11-03',
      reason: 'Voyage familial',
      documentName: 'attestation.pdf',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.recordCount).toBe(0);
    expect(res.body.data.submittedByKind).toBe('STAFF');
    expect(
      (await ctx.http.get(`/api/v1/justifications/${res.body.data.id}`).set(bearer(studentLife)))
        .body.data.documentName,
    ).toBe('attestation.pdf');
  });
});
