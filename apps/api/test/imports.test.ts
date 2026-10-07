import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, loginAs, startApp, type Session, type TestContext } from './helpers';

/** Phase 2 — imports CSV élèves et tuteurs (simulation puis application). Tenant « lycée ». */
describe('Imports CSV', () => {
  let ctx: TestContext;
  let registrar: Session;
  const count = async () =>
    (
      (await ctx.http.get('/api/v1/students?limit=200').set(bearer(registrar))).body
        .data as unknown[]
    ).length;

  beforeAll(async () => {
    ctx = await startApp();
    registrar = await loginAs(ctx, 'lycee', 'REGISTRAR');
  });
  afterAll(() => ctx.close());

  const studentsCsv = [
    'Matricule;Nom;Prénom;Date de naissance;Sexe;Classe',
    'IMP-001;KPOGNON;Éric;12/05/2014;M;6e B',
    'IMP-002;TOSSOU;Laure;2014-07-01;F;6e B',
    'IMP-003;ADJOVI;Aïcha;12/03/2014;F;6e A', // doublon probable de l'élève seedée (même nom + naissance)
    ';MAUVAIS;Date;31/02/zzzz;;6e B', // date illisible
    'IMP-005;PERDU;Enfant;;M;4e Z', // classe inconnue
    '',
  ].join('\n');

  it('la simulation produit un rapport par ligne sans rien écrire', async () => {
    const before = await count();
    const res = await ctx.http
      .post('/api/v1/imports/students')
      .set(bearer(registrar))
      .send({ csv: studentsCsv });
    expect(res.status).toBe(200);
    const job = res.body.data as {
      dryRun: boolean;
      rowsTotal: number;
      rowsOk: number;
      rowsError: number;
      report: { line: number; status: string; message?: string }[];
    };
    expect(job.dryRun).toBe(true);
    expect(job.rowsTotal).toBe(5);
    expect(job.rowsOk).toBe(3);
    expect(job.rowsError).toBe(2);
    expect(job.report.find((r) => r.line === 4)?.status).toBe('WARNING');
    expect(job.report.find((r) => r.line === 4)?.message).toMatch(/Doublon probable/);
    expect(job.report.find((r) => r.line === 5)?.status).toBe('ERROR');
    expect(job.report.find((r) => r.line === 6)?.message).toMatch(/inconnue/);
    expect(await count()).toBe(before);
  });

  it("l'application crée les élèves valides, les inscrit, et le rapport est consultable", async () => {
    const before = await count();
    const res = await ctx.http
      .post('/api/v1/imports/students?dryRun=false')
      .set(bearer(registrar))
      .send({ csv: studentsCsv });
    expect(res.status).toBe(200);
    expect(res.body.data.dryRun).toBe(false);
    expect(await count()).toBe(before + 3);

    const list = (await ctx.http.get('/api/v1/students?q=IMP-00').set(bearer(registrar))).body
      .data as {
      matricule: string;
      currentGroup: { name: string } | null;
      birthDate: string | null;
    }[];
    expect(list.find((s) => s.matricule === 'IMP-001')?.currentGroup?.name).toBe('6e B');
    expect(list.find((s) => s.matricule === 'IMP-001')?.birthDate).toBe('2014-05-12');

    const again = await ctx.http.get(`/api/v1/imports/${res.body.data.id}`).set(bearer(registrar));
    expect(again.status).toBe(200);
    expect(again.body.data.report).toHaveLength(5);

    // Rejouer le même fichier met à jour par matricule sans créer de doublon.
    await ctx.http
      .post('/api/v1/imports/students?dryRun=false')
      .set(bearer(registrar))
      .send({ csv: studentsCsv });
    expect(await count()).toBe(before + 3);
  });

  it('les tuteurs sont créés ou réutilisés par téléphone (format local accepté) et rattachés', async () => {
    const csv = [
      'matricule,nom,prenom,telephone,lien',
      'IMP-001,KPOGNON,Firmin,97 00 00 20,père',
      'IMP-002,KPOGNON,Firmin,+229 97 00 00 20,tuteur', // même téléphone (ancien format) : réutilisé
      'IMP-002,TOSSOU,Rose,0196000021,mère',
      'IMP-404,INCONNU,X,97000022,père',
      'IMP-001,SANS,Tel,,père',
    ].join('\n');
    const dry = await ctx.http
      .post('/api/v1/imports/guardians')
      .set(bearer(registrar))
      .send({ csv });
    expect(dry.status).toBe(200);
    expect(dry.body.data.rowsError).toBe(2);
    const res = await ctx.http
      .post('/api/v1/imports/guardians?dryRun=false')
      .set(bearer(registrar))
      .send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.data.rowsOk).toBe(3);

    const firmin = (await ctx.http.get('/api/v1/guardians?q=0197000020').set(bearer(registrar)))
      .body.data as { id: string }[];
    expect(firmin).toHaveLength(1);
    const g = (await ctx.http.get(`/api/v1/guardians/${firmin[0]!.id}`).set(bearer(registrar))).body
      .data as { links: { relationship: string; student: { matricule: string } }[] };
    expect(g.links.map((l) => l.student.matricule).sort()).toEqual(['IMP-001', 'IMP-002']);
    expect(g.links.find((l) => l.student.matricule === 'IMP-001')?.relationship).toBe('FATHER');
  });

  it('un fichier sans colonnes obligatoires ou trop volumineux est refusé', async () => {
    const bad = await ctx.http
      .post('/api/v1/imports/students')
      .set(bearer(registrar))
      .send({ csv: 'a;b\n1;2' });
    expect(bad.status).toBe(422);
    const huge = ['nom;prenom', ...Array.from({ length: 5001 }, (_, i) => `N${i};P${i}`)].join(
      '\n',
    );
    const tooBig = await ctx.http
      .post('/api/v1/imports/students')
      .set(bearer(registrar))
      .send({ csv: huge });
    expect(tooBig.status).toBe(422);
  });
});
