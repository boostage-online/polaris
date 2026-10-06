import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, loginAs, seed, startApp, type Session, type TestContext } from './helpers';

/** Phase 2 — élèves et inscriptions (ADR-0004). Tenant « lycée », acteur Scolarité. */
describe('Élèves et inscriptions', () => {
  let ctx: TestContext;
  let registrar: Session;
  const ac = () => seed.tenants.lycee.academic;

  beforeAll(async () => {
    ctx = await startApp();
    registrar = await loginAs(ctx, 'lycee', 'REGISTRAR');
  });
  afterAll(() => ctx.close());

  it('liste, recherche et filtres (classe, statut, fiches incomplètes)', async () => {
    const all = await ctx.http.get('/api/v1/students?limit=100').set(bearer(registrar));
    expect(all.status).toBe(200);
    expect((all.body.data as unknown[]).length).toBeGreaterThanOrEqual(5);

    const byName = await ctx.http.get('/api/v1/students?q=adjovi').set(bearer(registrar));
    expect((byName.body.data as { lastName: string }[]).every((s) => s.lastName === 'ADJOVI')).toBe(
      true,
    );
    expect((byName.body.data as unknown[]).length).toBeGreaterThanOrEqual(1);

    const inClass = await ctx.http
      .get(`/api/v1/students?groupId=${ac().groupIds.sixA}`)
      .set(bearer(registrar));
    expect(
      (inClass.body.data as { currentGroup: { id: string } | null }[]).every(
        (s) => s.currentGroup?.id === ac().groupIds.sixA,
      ),
    ).toBe(true);

    const left = await ctx.http.get('/api/v1/students?status=LEFT').set(bearer(registrar));
    expect((left.body.data as { id: string }[]).some((s) => s.id === ac().studentIds[4])).toBe(
      true,
    );

    const incomplete = await ctx.http
      .get('/api/v1/students?incomplete=true&limit=100')
      .set(bearer(registrar));
    // Sèdjro (4e élève) n'a aucun tuteur : fiche incomplète.
    expect(
      (incomplete.body.data as { id: string }[]).some((s) => s.id === ac().studentIds[3]),
    ).toBe(true);
  });

  it("la fiche élève porte l'historique d'inscriptions et le nombre de tuteurs", async () => {
    const res = await ctx.http.get(`/api/v1/students/${ac().studentIds[0]}`).set(bearer(registrar));
    expect(res.status).toBe(200);
    const s = res.body.data as {
      enrollments: { groupKind: string; isPrimary: boolean }[];
      currentGroup: { name: string } | null;
      guardianCount: number;
    };
    expect(s.currentGroup?.name).toBe('6e A');
    expect(s.enrollments).toHaveLength(2);
    expect(s.enrollments.some((e) => e.groupKind === 'SUBGROUP' && !e.isPrimary)).toBe(true);
    expect(s.guardianCount).toBe(1);
  });

  let created: string;
  it('créer un élève génère un matricule et peut inscrire immédiatement', async () => {
    const res = await ctx.http
      .post('/api/v1/students')
      .set(bearer(registrar))
      .send({
        firstName: 'Bienvenu',
        lastName: 'ZINSOU',
        birthDate: '2014-02-02',
        gender: 'M',
        groupId: ac().groupIds.sixB,
      });
    expect(res.status).toBe(201);
    created = res.body.data.id as string;
    expect(res.body.data.matricule).toMatch(/^2026-\d{5}$/);
    expect(res.body.data.currentGroup?.id).toBe(ac().groupIds.sixB);

    const dup = await ctx.http
      .post('/api/v1/students')
      .set(bearer(registrar))
      .send({ matricule: res.body.data.matricule, firstName: 'X', lastName: 'Y' });
    expect(dup.status).toBe(409);
  });

  it("une seule inscription de classe active par année ; l'inscription en sous-groupe s'ajoute", async () => {
    const again = await ctx.http
      .post(`/api/v1/students/${created}/enrollments`)
      .set(bearer(registrar))
      .send({ groupId: ac().groupIds.sixA });
    expect(again.status).toBe(409);
    const sub = await ctx.http
      .post(`/api/v1/students/${created}/enrollments`)
      .set(bearer(registrar))
      .send({ groupId: ac().groupIds.sixA1 });
    expect(sub.status).toBe(201);
    expect(sub.body.data.isPrimary).toBe(false);
    const close = await ctx.http
      .post(`/api/v1/enrollments/${sub.body.data.id}/close`)
      .set(bearer(registrar))
      .send({ reason: 'Changement de groupe' });
    expect(close.status).toBe(200);
    expect(close.body.data.leftAt).not.toBeNull();
  });

  it("le transfert clôt l'ancienne classe et ses sous-groupes, puis inscrit dans la nouvelle", async () => {
    const s1 = ac().studentIds[0]!; // 6e A + sous-groupe 6e A – Groupe 1
    const res = await ctx.http
      .post(`/api/v1/students/${s1}/transfer`)
      .set(bearer(registrar))
      .send({ toGroupId: ac().groupIds.sixB, reason: 'Équilibrage' });
    expect(res.status).toBe(200);
    const fiche = (await ctx.http.get(`/api/v1/students/${s1}`).set(bearer(registrar))).body
      .data as {
      currentGroup: { id: string } | null;
      enrollments: { groupId: string; leftAt: string | null; leftReason: string | null }[];
    };
    expect(fiche.currentGroup?.id).toBe(ac().groupIds.sixB);
    const active = fiche.enrollments.filter((e) => e.leftAt === null);
    expect(active).toHaveLength(1);
    expect(fiche.enrollments.find((e) => e.groupId === ac().groupIds.sixA1)?.leftAt).not.toBeNull();
    // Retour en 6e A pour les tests suivants (tuteurs, imports).
    expect(
      (
        await ctx.http
          .post(`/api/v1/students/${s1}/transfer`)
          .set(bearer(registrar))
          .send({ toGroupId: ac().groupIds.sixA })
      ).status,
    ).toBe(200);
    const same = await ctx.http
      .post(`/api/v1/students/${s1}/transfer`)
      .set(bearer(registrar))
      .send({ toGroupId: ac().groupIds.sixA });
    expect(same.status).toBe(409);
  });

  it('un départ clôt toutes les inscriptions et bloque toute nouvelle inscription', async () => {
    const res = await ctx.http
      .post(`/api/v1/students/${created}/leave`)
      .set(bearer(registrar))
      .send({ status: 'LEFT', reason: 'Déménagement' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('LEFT');
    expect(
      (res.body.data.enrollments as { leftAt: string | null }[]).every((e) => e.leftAt !== null),
    ).toBe(true);
    const enroll = await ctx.http
      .post(`/api/v1/students/${created}/enrollments`)
      .set(bearer(registrar))
      .send({ groupId: ac().groupIds.sixA });
    expect(enroll.status).toBe(409);
  });

  it('la capacité de la classe est respectée', async () => {
    const admin = await loginAs(ctx, 'lycee', 'ADMIN');
    const tiny = await ctx.http
      .post('/api/v1/groups')
      .set(bearer(admin))
      .send({
        academicYearId: ac().yearId,
        levelId: ac().levelIds.cinquieme,
        name: '5e Mini',
        capacity: 1,
      });
    expect(tiny.status).toBe(201);
    const a = await ctx.http
      .post('/api/v1/students')
      .set(bearer(registrar))
      .send({ firstName: 'Un', lastName: 'CAPACITE', groupId: tiny.body.data.id });
    expect(a.status).toBe(201);
    const b = await ctx.http
      .post('/api/v1/students')
      .set(bearer(registrar))
      .send({ firstName: 'Deux', lastName: 'CAPACITE' });
    const full = await ctx.http
      .post(`/api/v1/students/${b.body.data.id}/enrollments`)
      .set(bearer(registrar))
      .send({ groupId: tiny.body.data.id });
    expect(full.status).toBe(409);
  });

  it('le tableau de bord scolarité agrège effectifs, fiches incomplètes et imports récents', async () => {
    const res = await ctx.http.get('/api/v1/dashboards/registrar').set(bearer(registrar));
    expect(res.status).toBe(200);
    const d = res.body.data as {
      students: { active: number; left: number; withoutGuardian: number; incomplete: number };
      guardians: { total: number; activated: number };
      enrollmentsThisYear: number;
      recentImports: unknown[];
    };
    expect(d.students.active).toBeGreaterThanOrEqual(4);
    expect(d.students.left).toBeGreaterThanOrEqual(2);
    expect(d.students.withoutGuardian).toBeGreaterThanOrEqual(1);
    expect(d.students.incomplete).toBeGreaterThanOrEqual(d.students.withoutGuardian);
    expect(d.guardians.total).toBeGreaterThanOrEqual(2);
    expect(d.guardians.activated).toBeGreaterThanOrEqual(1);
    expect(d.recentImports.length).toBeGreaterThanOrEqual(1);
  });

  it('un enseignant lit les élèves mais ne peut ni créer ni inscrire', async () => {
    const teacher = await loginAs(ctx, 'lycee', 'TEACHER');
    expect((await ctx.http.get('/api/v1/students').set(bearer(teacher))).status).toBe(200);
    expect(
      (
        await ctx.http
          .post('/api/v1/students')
          .set(bearer(teacher))
          .send({ firstName: 'A', lastName: 'B' })
      ).status,
    ).toBe(403);
  });
});
