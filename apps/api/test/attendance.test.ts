import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, loginAs, seed, startApp, type Session, type TestContext } from './helpers';

/** Phase 3 — feuilles d'appel, corrections, verrouillage, appels manquants, alertes (ADR-0006). Tenant « lycée ». */
describe("Feuilles d'appel", () => {
  let ctx: TestContext;
  let admin: Session;
  let teacher: Session;
  let studentLife: Session;
  let head: Session;
  const ac = () => seed.tenants.lycee.academic;
  const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000).toISOString();

  beforeAll(async () => {
    ctx = await startApp();
    admin = await loginAs(ctx, 'lycee', 'ADMIN');
    teacher = await loginAs(ctx, 'lycee', 'TEACHER');
    studentLife = await loginAs(ctx, 'lycee', 'STUDENT_LIFE');
    head = await loginAs(ctx, 'lycee', 'ACADEMIC_HEAD');
  });
  afterAll(() => ctx.close());

  const createSession = async (courseId: string, startsAt: string, endsAt: string) => {
    const res = await ctx.http
      .post(`/api/v1/courses/${courseId}/sessions`)
      .set(bearer(admin))
      .send({ startsAt, endsAt });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };

  it("l'enseignant voit ses séances du jour avec l'état de l'appel seedé", async () => {
    const res = await ctx.http
      .get('/api/v1/me/schedule/today?date=2026-10-12')
      .set(bearer(teacher));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = (
      res.body.data as {
        id: string;
        sheet: { status: string; counts: { present: number; absent: number; late: number } } | null;
      }[]
    ).find((x) => x.id === ac().sessionId);
    expect(s?.sheet?.status).toBe('SUBMITTED');
    expect(s?.sheet?.counts).toEqual({ present: 1, absent: 1, late: 1 });
  });

  let sessionId: string;
  let sheetId: string;
  let version: number;
  const recordOf = (
    sheet: {
      records: { id: string; studentId: string; status: string; lateMinutes: number | null }[];
    },
    studentId: string,
  ) => sheet.records.find((r) => r.studentId === studentId)!;

  it('ouvrir la feuille pré-remplit « présent » pour les inscrits du groupe ; un non-enseignant du cours est refusé', async () => {
    sessionId = await createSession(ac().courseIds.math6a, iso(-10), iso(50));
    expect(
      (await ctx.http.post(`/api/v1/sessions/${sessionId}/attendance-sheet`).set(bearer(head)))
        .status,
    ).toBe(403);
    const res = await ctx.http
      .post(`/api/v1/sessions/${sessionId}/attendance-sheet`)
      .set(bearer(teacher));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sheet = res.body.data as {
      id: string;
      status: string;
      version: number;
      retroactive: boolean;
      records: { studentId: string; status: string }[];
    };
    sheetId = sheet.id;
    version = sheet.version;
    expect(sheet.status).toBe('DRAFT');
    expect(sheet.retroactive).toBe(false);
    const ids = sheet.records.map((r) => r.studentId);
    for (const sid of ac().studentIds.slice(0, 3)) expect(ids).toContain(sid);
    expect(ids).not.toContain(ac().studentIds[3]); // 6e B
    expect(sheet.records.every((r) => r.status === 'PRESENT')).toBe(true);
    // Ré-ouvrir renvoie la même feuille.
    expect(
      (await ctx.http.post(`/api/v1/sessions/${sessionId}/attendance-sheet`).set(bearer(teacher)))
        .body.data.id,
    ).toBe(sheetId);
  });

  it('le brouillon normalise (retard ≥ seuil → absence), refuse un élève non inscrit et détecte les conflits de version', async () => {
    const [s1, s2, , s4] = ac().studentIds as [string, string, string, string];
    const bad = await ctx.http
      .patch(`/api/v1/attendance-sheets/${sheetId}`)
      .set(bearer(teacher))
      .send({ version, records: [{ studentId: s4, status: 'ABSENT' }] });
    expect(bad.status).toBe(422);
    const ok = await ctx.http
      .patch(`/api/v1/attendance-sheets/${sheetId}`)
      .set(bearer(teacher))
      .send({
        version,
        records: [
          { studentId: s1, status: 'LATE', lateMinutes: 45 },
          { studentId: s2, status: 'LATE', lateMinutes: 10 },
        ],
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(recordOf(ok.body.data, s1).status).toBe('ABSENT');
    expect(recordOf(ok.body.data, s1).lateMinutes).toBe(45);
    expect(recordOf(ok.body.data, s2).status).toBe('LATE');
    expect(ok.body.data.version).toBe(version + 1);
    const stale = await ctx.http
      .patch(`/api/v1/attendance-sheets/${sheetId}`)
      .set(bearer(teacher))
      .send({ version, records: [] });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    version = ok.body.data.version as number;
  });

  it("la soumission fige l'appel, passe la séance en HELD, publie l'événement et met à jour les statistiques", async () => {
    const res = await ctx.http
      .post(`/api/v1/attendance-sheets/${sheetId}/submit`)
      .set(bearer(teacher))
      .send({ version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('SUBMITTED');
    expect(res.body.data.counts.absent).toBe(1);
    expect(res.body.data.counts.late).toBe(1);
    expect(res.body.data.counts.present).toBeGreaterThanOrEqual(1);
    version = res.body.data.version as number;
    expect(
      (await ctx.http.get(`/api/v1/sessions/${sessionId}`).set(bearer(admin))).body.data.status,
    ).toBe('HELD');
    const again = await ctx.http
      .post(`/api/v1/attendance-sheets/${sheetId}/submit`)
      .set(bearer(teacher))
      .send({ version });
    expect(again.status).toBe(409);
    expect(
      (
        await ctx.http
          .patch(`/api/v1/attendance-sheets/${sheetId}`)
          .set(bearer(teacher))
          .send({ version, records: [] })
      ).status,
    ).toBe(409);

    const events = await ctx.owner.query(
      `select payload from outbox_events where type = 'AttendanceSheetSubmitted' and aggregate_id = $1`,
      [sheetId],
    );
    expect(events.rowCount).toBe(1);
    expect((events.rows[0].payload as { marked: unknown[] }).marked).toHaveLength(2);

    const summary = await ctx.http
      .get(
        `/api/v1/students/${ac().studentIds[0]}/attendance/summary?from=2026-09-01&to=2027-07-31`,
      )
      .set(bearer(studentLife));
    expect(summary.status).toBe(200);
    expect(summary.body.data.absent).toBeGreaterThanOrEqual(2); // seed + cette séance
    expect(summary.body.data.presenceRate).not.toBeNull();
  });

  it('une correction exige un motif, laisse une révision et respecte la fenêtre ; le verrouillage réserve la suite à la vie scolaire', async () => {
    const s2 = ac().studentIds[1]!;
    const sheet = (await ctx.http.get(`/api/v1/attendance-sheets/${sheetId}`).set(bearer(teacher)))
      .body.data;
    const rec = recordOf(sheet, s2);
    expect(
      (
        await ctx.http
          .patch(`/api/v1/attendance-records/${rec.id}`)
          .set(bearer(teacher))
          .send({ status: 'PRESENT' })
      ).status,
    ).toBe(422);
    const fixed = await ctx.http
      .patch(`/api/v1/attendance-records/${rec.id}`)
      .set(bearer(teacher))
      .send({ status: 'PRESENT', reason: 'Erreur de saisie' });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect(recordOf(fixed.body.data, s2).status).toBe('PRESENT');
    const revs = await ctx.http
      .get(`/api/v1/attendance-records/${rec.id}/revisions`)
      .set(bearer(teacher));
    expect(revs.body.data).toHaveLength(1);
    expect(revs.body.data[0]).toMatchObject({
      beforeStatus: 'LATE',
      afterStatus: 'PRESENT',
      outOfWindow: false,
    });

    const day = (offset: number) =>
      new Date(Date.now() + offset * 24 * 3_600_000).toISOString().slice(0, 10);
    const lock = await ctx.http
      .post('/api/v1/attendance-sheets/lock')
      .set(bearer(studentLife))
      .send({ from: day(-1), to: day(1), action: 'LOCK' });
    expect(lock.status).toBe(200);
    expect(lock.body.data.count).toBeGreaterThanOrEqual(1);
    expect(
      (
        await ctx.http
          .patch(`/api/v1/attendance-records/${rec.id}`)
          .set(bearer(teacher))
          .send({ status: 'LATE', lateMinutes: 5, reason: 'Finalement en retard' })
      ).status,
    ).toBe(403);
    const vs = await ctx.http
      .patch(`/api/v1/attendance-records/${rec.id}`)
      .set(bearer(studentLife))
      .send({ status: 'LATE', lateMinutes: 5, reason: 'Vérifié auprès du surveillant' });
    expect(vs.status).toBe(200);
    expect(
      (
        (
          await ctx.http
            .get(`/api/v1/attendance-records/${rec.id}/revisions`)
            .set(bearer(studentLife))
        ).body.data as { outOfWindow: boolean }[]
      )[0]?.outOfWindow,
    ).toBe(true);
    expect(
      (
        await ctx.http
          .post('/api/v1/attendance-sheets/lock')
          .set(bearer(studentLife))
          .send({ from: day(-1), to: day(1), action: 'UNLOCK' })
      ).body.data.count,
    ).toBeGreaterThanOrEqual(1);
  });

  it('saisie rétroactive réservée à la vie scolaire ; trop tôt refusé', async () => {
    const old = await createSession(
      ac().courseIds.math6a,
      iso(-3 * 24 * 60),
      iso(-3 * 24 * 60 + 60),
    );
    expect(
      (await ctx.http.post(`/api/v1/sessions/${old}/attendance-sheet`).set(bearer(teacher))).status,
    ).toBe(403);
    const vs = await ctx.http
      .post(`/api/v1/sessions/${old}/attendance-sheet`)
      .set(bearer(studentLife));
    expect(vs.status).toBe(200);
    expect(vs.body.data.retroactive).toBe(true);
    const future = await createSession(ac().courseIds.math6a, iso(120), iso(180));
    expect(
      (await ctx.http.post(`/api/v1/sessions/${future}/attendance-sheet`).set(bearer(teacher)))
        .status,
    ).toBe(422);
  });

  it('les appels manquants listent les séances terminées sans feuille soumise', async () => {
    const missed = await createSession(ac().courseIds.fr6a, iso(-26 * 60), iso(-25 * 60));
    const res = await ctx.http.get('/api/v1/attendance-sheets/missing').set(bearer(studentLife));
    expect(res.status).toBe(200);
    const ids = (res.body.data as { sessionId: string }[]).map((m) => m.sessionId);
    expect(ids).toContain(missed);
    expect(ids).not.toContain(sessionId); // soumise
    expect(
      (await ctx.http.get('/api/v1/attendance-sheets/missing').set(bearer(teacher))).status,
    ).toBe(403);
  });

  it("la liste des feuilles respecte la portée (« mes cours » pour l'enseignant)", async () => {
    const mine = await ctx.http
      .get('/api/v1/attendance-sheets?mine=true&limit=100')
      .set(bearer(teacher));
    expect(mine.status).toBe(200);
    expect((mine.body.data as { id: string }[]).some((s) => s.id === sheetId)).toBe(true);
    const all = await ctx.http.get('/api/v1/attendance-sheets?limit=100').set(bearer(studentLife));
    expect((all.body.data as unknown[]).length).toBeGreaterThanOrEqual(
      (mine.body.data as unknown[]).length,
    );
  });

  it("l'alerte seedée figure dans la liste de surveillance et se clôt", async () => {
    const list = await ctx.http.get('/api/v1/attendance/watchlist').set(bearer(studentLife));
    expect(list.status).toBe(200);
    const item = (list.body.data as { alertId: string; student: { id: string } }[]).find(
      (w) => w.student.id === ac().studentIds[0],
    );
    expect(item).toBeDefined();
    expect(
      (
        await ctx.http
          .post(`/api/v1/attendance/alerts/${item!.alertId}/resolve`)
          .set(bearer(studentLife))
      ).status,
    ).toBe(200);
    expect(
      (
        await ctx.http
          .post(`/api/v1/attendance/alerts/${item!.alertId}/resolve`)
          .set(bearer(studentLife))
      ).status,
    ).toBe(404);
  });

  it('tableaux de bord enseignant et vie scolaire', async () => {
    const t = await ctx.http.get('/api/v1/dashboards/teacher').set(bearer(teacher));
    expect(t.status).toBe(200);
    expect(t.body.data.submittedToday).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(t.body.data.today)).toBe(true);
    const sl = await ctx.http.get('/api/v1/dashboards/student-life').set(bearer(studentLife));
    expect(sl.status).toBe(200);
    expect(sl.body.data.today.sheetsSubmitted).toBeGreaterThanOrEqual(1);
    expect(sl.body.data.missingSheets).toBeGreaterThanOrEqual(1);
    expect(sl.body.data.justificationsPending).toBeGreaterThanOrEqual(0);
  });
});
