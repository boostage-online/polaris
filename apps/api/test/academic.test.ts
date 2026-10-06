import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, loginAs, seed, startApp, type Session, type TestContext } from './helpers';

/** Phase 2 — structure académique, cours, emplois du temps, séances (ADR-0004). Tenant « lycée ». */
describe('Structure académique et séances', () => {
  let ctx: TestContext;
  let admin: Session;
  let teacher: Session;
  let registrar: Session;
  const L = () => seed.tenants.lycee;
  const ac = () => L().academic;

  beforeAll(async () => {
    ctx = await startApp();
    admin = await loginAs(ctx, 'lycee', 'ADMIN');
    teacher = await loginAs(ctx, 'lycee', 'TEACHER');
    registrar = await loginAs(ctx, 'lycee', 'REGISTRAR');
  });
  afterAll(() => ctx.close());

  it("l'année courante seedée est visible et unique", async () => {
    const res = await ctx.http.get('/api/v1/academic-years').set(bearer(admin));
    expect(res.status).toBe(200);
    const years = res.body.data as { id: string; isCurrent: boolean; label: string }[];
    expect(years.filter((y) => y.isCurrent)).toHaveLength(1);
    expect(years[0]!.label).toBe('2026-2027');
  });

  it('créer une nouvelle année courante bascule la précédente', async () => {
    const created = await ctx.http.post('/api/v1/academic-years').set(bearer(admin)).send({
      label: '2027-2028',
      startDate: '2027-09-15',
      endDate: '2028-07-15',
      isCurrent: false,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(
      (await ctx.http.post(`/api/v1/academic-years/${id}/set-current`).set(bearer(admin))).status,
    ).toBe(200);
    const list = (await ctx.http.get('/api/v1/academic-years').set(bearer(admin))).body.data as {
      id: string;
      isCurrent: boolean;
    }[];
    expect(list.find((y) => y.id === id)?.isCurrent).toBe(true);
    expect(list.filter((y) => y.isCurrent)).toHaveLength(1);
    // Retour à l'année seedée pour la suite des tests.
    expect(
      (await ctx.http.post(`/api/v1/academic-years/${ac().yearId}/set-current`).set(bearer(admin)))
        .status,
    ).toBe(200);
  });

  it('les groupes de la classe seedée portent leur effectif', async () => {
    const res = await ctx.http
      .get(`/api/v1/groups?academicYearId=${ac().yearId}`)
      .set(bearer(registrar));
    expect(res.status).toBe(200);
    const g = (
      res.body.data as { id: string; studentCount: number; kind: string; levelName: string }[]
    ).find((x) => x.id === ac().groupIds.sixA);
    expect(g?.studentCount).toBe(3);
    expect(g?.kind).toBe('CLASS');
    expect(g?.levelName).toBe('6e');
  });

  it('un sous-groupe exige une classe parente ; un nom de groupe est unique par année', async () => {
    const noParent = await ctx.http.post('/api/v1/groups').set(bearer(admin)).send({
      academicYearId: ac().yearId,
      levelId: ac().levelIds.sixieme,
      name: 'Orphelin',
      kind: 'SUBGROUP',
    });
    expect(noParent.status).toBe(422);
    const dup = await ctx.http
      .post('/api/v1/groups')
      .set(bearer(admin))
      .send({ academicYearId: ac().yearId, levelId: ac().levelIds.sixieme, name: '6e A' });
    expect(dup.status).toBe(409);
  });

  it('une classe avec des inscriptions actives ne peut pas être supprimée', async () => {
    const res = await ctx.http.delete(`/api/v1/groups/${ac().groupIds.sixA}`).set(bearer(admin));
    expect(res.status).toBe(409);
  });

  it('un cours se crée avec ses enseignants ; un créneau en conflit est signalé, pas refusé', async () => {
    const course = await ctx.http
      .post('/api/v1/courses')
      .set(bearer(admin))
      .send({
        subjectId: ac().subjectIds.fr,
        groupId: ac().groupIds.sixB,
        teachers: [{ staffProfileId: ac().staffProfileIds.TEACHER }],
      });
    expect(course.status).toBe(201);
    expect(course.body.data.teachers).toHaveLength(1);
    const courseId = course.body.data.id as string;

    // Le même enseignant a déjà Maths 6e A le lundi 08:00-10:00 : chevauchement enseignant.
    const slot = await ctx.http
      .post(`/api/v1/courses/${courseId}/schedule-slots`)
      .set(bearer(admin))
      .send({ weekday: 1, startTime: '09:00', endTime: '11:00', room: 'Salle A1' });
    expect(slot.status).toBe(201);
    expect((slot.body.meta.warnings as string[]).length).toBeGreaterThan(0);

    const dupCourse = await ctx.http
      .post('/api/v1/courses')
      .set(bearer(admin))
      .send({ subjectId: ac().subjectIds.fr, groupId: ac().groupIds.sixB });
    expect(dupCourse.status).toBe(409);
  });

  it('la génération des séances est idempotente et respecte les créneaux', async () => {
    const first = await ctx.http
      .post('/api/v1/sessions/generate')
      .set(bearer(admin))
      .send({ horizonDays: 21 });
    expect(first.status).toBe(200);
    expect(first.body.data.scanned).toBeGreaterThan(0);
    const second = await ctx.http
      .post('/api/v1/sessions/generate')
      .set(bearer(admin))
      .send({ horizonDays: 21 });
    expect(second.body.data.created).toBe(0);

    const list = await ctx.http
      .get(
        `/api/v1/sessions?groupId=${ac().groupIds.sixA}&from=2026-10-12T00:00:00.000Z&to=2026-10-12T23:59:59.000Z`,
      )
      .set(bearer(registrar));
    expect(list.status).toBe(200);
    const seeded = (
      list.body.data as { id: string; subjectName: string; teachers: unknown[] }[]
    ).find((s) => s.id === ac().sessionId);
    expect(seeded?.subjectName).toBe('Mathématiques');
    expect(seeded?.teachers).toHaveLength(1);
  });

  it('un enseignant ne voit que ses séances ; la scolarité (VIEW_ATTENDANCE_ANY) voit tout', async () => {
    // Séance ponctuelle d'un cours que l'enseignant seedé n'enseigne pas (Français 6e A, sans enseignant).
    const extra = await ctx.http
      .post(`/api/v1/courses/${ac().courseIds.fr6a}/sessions`)
      .set(bearer(admin))
      .send({ startsAt: '2026-10-13T08:00:00.000Z', endsAt: '2026-10-13T09:00:00.000Z' });
    expect(extra.status).toBe(201);

    const mine = await ctx.http
      .get(
        '/api/v1/me/schedule?from=2026-10-01T00:00:00.000Z&to=2026-10-31T00:00:00.000Z&limit=100',
      )
      .set(bearer(teacher));
    expect(mine.status).toBe(200);
    const ids = mine.body.data as { id: string; courseOfferingId: string }[];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((s) => s.courseOfferingId !== ac().courseIds.fr6a)).toBe(true);

    const all = await ctx.http
      .get(
        '/api/v1/me/schedule?from=2026-10-01T00:00:00.000Z&to=2026-10-31T00:00:00.000Z&limit=100',
      )
      .set(bearer(registrar));
    expect((all.body.data as { id: string }[]).some((s) => s.id === extra.body.data.id)).toBe(true);
  });

  it("annuler une séance exige un motif ; l'annulation est journalisée", async () => {
    const noReason = await ctx.http
      .patch(`/api/v1/sessions/${ac().sessionId}`)
      .set(bearer(admin))
      .send({ status: 'CANCELLED' });
    expect(noReason.status).toBe(422);
    const ok = await ctx.http
      .patch(`/api/v1/sessions/${ac().sessionId}`)
      .set(bearer(admin))
      .send({ status: 'CANCELLED', cancelReason: 'Enseignant absent' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('CANCELLED');
    const audit = await ctx.http.get('/api/v1/audit-logs?limit=50').set(bearer(admin));
    expect(
      (audit.body.data as { action: string; entityId: string }[]).some(
        (l) => l.action === 'session.cancelled' && l.entityId === ac().sessionId,
      ),
    ).toBe(true);
    // Réactivée pour les tests suivants.
    expect(
      (
        await ctx.http
          .patch(`/api/v1/sessions/${ac().sessionId}`)
          .set(bearer(admin))
          .send({ status: 'PLANNED', cancelReason: null })
      ).status,
    ).toBe(200);
  });

  it('le personnel liste les membres STAFF avec leur profil enseignant', async () => {
    const res = await ctx.http.get('/api/v1/staff').set(bearer(admin));
    expect(res.status).toBe(200);
    const rows = res.body.data as {
      membershipId: string;
      isTeacher: boolean;
      staffProfileId: string | null;
    }[];
    expect(rows.find((r) => r.membershipId === L().users.TEACHER.membershipId)?.isTeacher).toBe(
      true,
    );
    const upd = await ctx.http
      .patch(`/api/v1/staff/${L().users.ACADEMIC_HEAD.membershipId}`)
      .set(bearer(admin))
      .send({ isTeacher: true, title: 'Professeur' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.isTeacher).toBe(true);
  });

  it('le tableau de bord administrateur remonte les alertes de configuration', async () => {
    const res = await ctx.http.get('/api/v1/dashboards/admin').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.counts.students).toBeGreaterThanOrEqual(4);
    const codes = (res.body.data.configurationIssues as { code: string }[]).map((i) => i.code);
    expect(codes).toContain('COURSES_WITHOUT_TEACHER'); // Français 6e A seedé sans enseignant
  });
});
