import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, loginAs, seed, startApp, type Session, type TestContext } from './helpers';

/** Phase 2 — tuteurs, liens parent-enfant et portée parent (ADR-0004, ADR-0007). Tenant « lycée ». */
describe('Tuteurs et liens parent-enfant', () => {
  let ctx: TestContext;
  let registrar: Session;
  let parent: Session;
  const ac = () => seed.tenants.lycee.academic;

  beforeAll(async () => {
    ctx = await startApp();
    registrar = await loginAs(ctx, 'lycee', 'REGISTRAR');
    parent = await login(ctx, ac().parentUser.email);
  });
  afterAll(() => ctx.close());

  it('un parent voit ses enfants avec les droits de chaque lien, et rien d’autre', async () => {
    const res = await ctx.http.get('/api/v1/me/children').set(bearer(parent));
    expect(res.status).toBe(200);
    const kids = res.body.data as {
      student: { id: string };
      currentGroup: { name: string } | null;
      rights: { finance: boolean; pay: boolean; attendance: boolean };
    }[];
    expect(kids.map((k) => k.student.id).sort()).toEqual(
      [ac().studentIds[0], ac().studentIds[1]].sort(),
    );
    const s2 = kids.find((k) => k.student.id === ac().studentIds[1])!;
    expect(s2.rights.finance).toBe(false);
    expect(s2.rights.pay).toBe(false);
    expect(s2.rights.attendance).toBe(true);
    expect(kids.find((k) => k.student.id === ac().studentIds[0])?.currentGroup?.name).toBe('6e A');

    expect((await ctx.http.get('/api/v1/students').set(bearer(parent))).status).toBe(403);
    expect(
      (await ctx.http.get(`/api/v1/students/${ac().studentIds[0]}`).set(bearer(parent))).status,
    ).toBe(403);
    // Un membre du personnel n'est pas un tuteur : pas de vue « mes enfants ».
    expect((await ctx.http.get('/api/v1/me/children').set(bearer(registrar))).status).toBe(404);
  });

  it('le parent de l’université ne voit pas les enfants du lycée', async () => {
    const other = await login(ctx, seed.tenants.univ.academic.parentUser.email);
    const res = await ctx.http.get('/api/v1/me/children').set(bearer(other));
    expect(res.status).toBe(200);
    const ids = (res.body.data as { student: { id: string } }[]).map((k) => k.student.id);
    expect(ids).not.toContain(ac().studentIds[0]);
    expect(ids).toContain(seed.tenants.univ.academic.studentIds[0]);
  });

  let guardianId: string;
  it('créer un tuteur ; le téléphone est unique par établissement', async () => {
    const res = await ctx.http
      .post('/api/v1/guardians')
      .set(bearer(registrar))
      .send({
        firstName: 'Clarisse',
        lastName: 'HOUNKPATIN',
        phone: '+22997000010',
        email: 'Clarisse@Example.com',
      });
    expect(res.status).toBe(201);
    guardianId = res.body.data.id as string;
    expect(res.body.data.activated).toBe(false);
    const dup = await ctx.http
      .post('/api/v1/guardians')
      .set(bearer(registrar))
      .send({ firstName: 'C', lastName: 'H', phone: '+22997000010' });
    expect(dup.status).toBe(409);
  });

  it('rattacher un tuteur existant, puis un tuteur créé à la volée (réutilisé si le téléphone existe)', async () => {
    const s4 = ac().studentIds[3]!;
    const link = await ctx.http
      .post(`/api/v1/students/${s4}/guardians`)
      .set(bearer(registrar))
      .send({ guardianId, relationship: 'MOTHER', isPrimary: true });
    expect(link.status).toBe(201);
    expect(link.body.data.guardian.id).toBe(guardianId);
    expect(link.body.data.isPrimary).toBe(true);

    const twice = await ctx.http
      .post(`/api/v1/students/${s4}/guardians`)
      .set(bearer(registrar))
      .send({ guardianId, relationship: 'TUTOR' });
    expect(twice.status).toBe(409);

    const inline = await ctx.http
      .post(`/api/v1/students/${s4}/guardians`)
      .set(bearer(registrar))
      .send({
        guardian: { firstName: 'Pascal', lastName: 'SOSSOU', phone: '+22991000002' },
        relationship: 'FATHER',
        isPrimary: true,
        canViewFinance: false,
      });
    expect(inline.status).toBe(201);
    expect(inline.body.data.guardian.id).toBe(ac().guardianIds.other); // même téléphone : réutilisé
    expect(inline.body.data.canViewFinance).toBe(false);

    const links = (await ctx.http.get(`/api/v1/students/${s4}/guardians`).set(bearer(registrar)))
      .body.data as { guardianId: string; isPrimary: boolean }[];
    expect(links).toHaveLength(2);
    expect(links.filter((l) => l.isPrimary)).toHaveLength(1);
    expect(links.find((l) => l.isPrimary)?.guardianId).toBe(ac().guardianIds.other);
  });

  it("inviter un tuteur crée son accès parent et envoie le SMS ; l'invitation est journalisée", async () => {
    const before = ctx.sms.sent.length;
    const res = await ctx.http
      .post(`/api/v1/guardians/${guardianId}/invite`)
      .set(bearer(registrar));
    expect(res.status).toBe(200);
    expect(ctx.sms.sent.length).toBe(before + 1);
    expect(ctx.sms.sent.at(-1)?.to).toBe('+22997000010');
    const g = (await ctx.http.get(`/api/v1/guardians/${guardianId}`).set(bearer(registrar))).body
      .data as { activated: boolean; invitedAt: string | null; links: unknown[] };
    expect(g.activated).toBe(true);
    expect(g.invitedAt).not.toBeNull();
    expect(g.links).toHaveLength(1);
    const audit = await ctx.http
      .get('/api/v1/audit-logs?limit=50')
      .set(bearer(await loginAs(ctx, 'lycee', 'ADMIN')));
    expect(
      (audit.body.data as { action: string; entityId: string }[]).some(
        (l) => l.action === 'guardian.invited' && l.entityId === guardianId,
      ),
    ).toBe(true);
  });

  it('modifier un lien et détacher un tuteur (motif obligatoire) ; le parent perd la vue sur cet enfant', async () => {
    const upd = await ctx.http
      .patch(`/api/v1/student-guardians/${ac().linkIds.parentS2}`)
      .set(bearer(registrar))
      .send({ canViewFinance: true });
    expect(upd.status).toBe(200);
    expect(upd.body.data.canViewFinance).toBe(true);

    const noReason = await ctx.http
      .delete(`/api/v1/student-guardians/${ac().linkIds.parentS2}`)
      .set(bearer(registrar))
      .send({});
    expect(noReason.status).toBe(422);
    const del = await ctx.http
      .delete(`/api/v1/student-guardians/${ac().linkIds.parentS2}`)
      .set(bearer(registrar))
      .send({ reason: 'Erreur de saisie' });
    expect(del.status).toBe(204);
    expect(
      (
        await ctx.http
          .delete(`/api/v1/student-guardians/${ac().linkIds.parentS2}`)
          .set(bearer(registrar))
          .send({ reason: 'bis' })
      ).status,
    ).toBe(404);

    const kids = (await ctx.http.get('/api/v1/me/children').set(bearer(parent))).body.data as {
      student: { id: string };
    }[];
    expect(kids.map((k) => k.student.id)).toEqual([ac().studentIds[0]]);
  });

  it('la recherche de tuteurs filtre par nom, téléphone et activation', async () => {
    const byPhone = await ctx.http.get('/api/v1/guardians?q=97000010').set(bearer(registrar));
    expect((byPhone.body.data as { id: string }[]).map((g) => g.id)).toEqual([guardianId]);
    const inactive = await ctx.http.get('/api/v1/guardians?activated=false').set(bearer(registrar));
    expect((inactive.body.data as { activated: boolean }[]).every((g) => !g.activated)).toBe(true);
  });
});
