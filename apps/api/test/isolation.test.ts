import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectRoutes } from '../src/openapi/build';
import { bearer, loginAs, seed, startApp, type Session, type TestContext } from './helpers';

/**
 * Test générique d'isolation (ADR-0002, Partie 13) : pour CHAQUE route tenant portant un identifiant,
 * un administrateur du tenant B appelle la route avec un identifiant du tenant A et doit recevoir 404
 * (jamais 200, jamais 403). Une route nouvelle sans entrée dans `fixtures` fait échouer le test.
 */
describe('Isolation inter-tenant', () => {
  let ctx: TestContext;
  let admB: Session;
  beforeAll(async () => {
    ctx = await startApp();
    admB = await loginAs(ctx, 'univ', 'ADMIN');
  });
  afterAll(() => ctx.close());

  const A = () => seed.tenants.lycee;

  /** Identifiant du tenant A selon la ressource visée par la route (toujours un objet réel du tenant A). */
  const idFor = (path: string, name: string): string => {
    const ac = A().academic;
    if (name === 'membershipId') return A().users.TEACHER.membershipId;
    if (name === 'studentId') return ac.studentIds[0]!;
    if (name === 'paymentId') return ac.billing.paymentId;
    if (name === 'familyId') return '00000000-0000-0000-0000-000000000000';
    const byPrefix: [string, string][] = [
      ['/api/v1/academic-years', ac.yearId],
      ['/api/v1/programs', ac.programId],
      ['/api/v1/levels', ac.levelIds.sixieme],
      ['/api/v1/groups', ac.groupIds.sixA],
      ['/api/v1/subjects', ac.subjectIds.math],
      ['/api/v1/courses', ac.courseIds.math6a],
      ['/api/v1/schedule-slots', ac.slotId],
      ['/api/v1/sessions', ac.sessionId],
      ['/api/v1/students', ac.studentIds[0]!],
      ['/api/v1/enrollments', ac.enrollmentIds.s1Class],
      ['/api/v1/guardians', ac.guardianIds.parent],
      ['/api/v1/student-guardians', ac.linkIds.parentS1],
      ['/api/v1/imports', ac.importJobId],
      ['/api/v1/fee-categories', ac.billing.categoryId],
      ['/api/v1/fee-structures', ac.billing.structureId],
      ['/api/v1/payments', ac.billing.paymentId],
      ['/api/v1/attendance-sheets', ac.attendance.sheetId],
      ['/api/v1/attendance-records', ac.attendance.recordIds.s1],
      ['/api/v1/justifications', ac.attendance.justificationId],
      ['/api/v1/attendance/alerts', ac.attendance.alertId],
      ['/api/v1/me/notifications', ac.attendance.notificationId],
      ['/api/v1/notifications', ac.attendance.notificationId],
      ['/api/v1/roles', A().roleIds.TEACHER],
    ];
    const hit = byPrefix.find(([p]) => path.startsWith(p));
    if (!hit) throw new Error(`Aucune fixture d'isolation pour ${path} (:${name})`);
    return hit[1];
  };
  /** Corps valides (la validation précède la recherche : un corps invalide donnerait 400, pas 404). */
  const B = () => seed.tenants.univ.academic;
  const bodies: Record<string, () => object> = {
    'PATCH /api/v1/roles/:id/permissions': () => ({ permissions: ['VIEW_STUDENTS'] }),
    'POST /api/v1/roles/:id/duplicate': () => ({ name: `Copie ${Date.now()}` }),
    'PUT /api/v1/members/:membershipId/roles': () => ({ roleIds: [A().roleIds.TEACHER] }),
    'PATCH /api/v1/academic-years/:id': () => ({ label: 'Isolation' }),
    'POST /api/v1/academic-years/:id/terms': () => ({
      label: 'T1',
      startDate: '2026-09-15',
      endDate: '2026-12-15',
    }),
    'PATCH /api/v1/programs/:id': () => ({ name: 'Isolation' }),
    'POST /api/v1/programs/:id/levels': () => ({ name: 'Isolation', rank: 9 }),
    'PATCH /api/v1/levels/:id': () => ({ name: 'Isolation' }),
    'PATCH /api/v1/groups/:id': () => ({ name: 'Isolation' }),
    'PATCH /api/v1/subjects/:id': () => ({ name: 'Isolation' }),
    'PATCH /api/v1/staff/:membershipId': () => ({ isTeacher: true }),
    'PUT /api/v1/courses/:id/teachers': () => ({ teachers: [] }),
    'POST /api/v1/courses/:id/schedule-slots': () => ({
      weekday: 2,
      startTime: '10:00',
      endTime: '11:00',
    }),
    'POST /api/v1/courses/:id/sessions': () => ({
      startsAt: '2026-11-02T08:00:00.000Z',
      endsAt: '2026-11-02T09:00:00.000Z',
    }),
    'PATCH /api/v1/sessions/:id': () => ({ room: 'Isolation' }),
    'PATCH /api/v1/students/:id': () => ({ notes: 'Isolation' }),
    'POST /api/v1/students/:id/enrollments': () => ({ groupId: B().groupIds.sixB }),
    'POST /api/v1/students/:id/transfer': () => ({ toGroupId: B().groupIds.sixB }),
    'POST /api/v1/students/:id/leave': () => ({ status: 'LEFT' }),
    'POST /api/v1/students/:id/guardians': () => ({
      guardianId: B().guardianIds.other,
      relationship: 'TUTOR',
    }),
    'POST /api/v1/enrollments/:id/close': () => ({ reason: 'Isolation' }),
    'PATCH /api/v1/guardians/:id': () => ({ firstName: 'Isolation' }),
    'PATCH /api/v1/student-guardians/:id': () => ({ isPrimary: true }),
    'DELETE /api/v1/student-guardians/:id': () => ({ reason: 'Isolation' }),
    'PATCH /api/v1/attendance-sheets/:id': () => ({ version: 1, records: [] }),
    'POST /api/v1/attendance-sheets/:id/submit': () => ({ version: 1 }),
    'PATCH /api/v1/attendance-records/:id': () => ({ status: 'PRESENT', reason: 'Isolation' }),
    'POST /api/v1/justifications/:id/review': () => ({ decision: 'APPROVED' }),
    'POST /api/v1/me/children/:studentId/justifications': () => ({
      fromDate: '2026-10-12',
      toDate: '2026-10-12',
      reason: 'Isolation',
    }),
    'PATCH /api/v1/fee-categories/:id': () => ({ name: 'Isolation' }),
    'PATCH /api/v1/fee-structures/:id': () => ({ name: 'Isolation' }),
    'POST /api/v1/students/:id/fees': () => ({ feeStructureIds: [B().billing.structureId] }),
    'POST /api/v1/students/:id/payments/manual': () => ({ amount: 1000, method: 'CASH' }),
    'POST /api/v1/payments/:id/reverse': () => ({ reason: 'Isolation' }),
  };

  it('toutes les routes tenant avec identifiant répondent 404 pour une ressource du tenant A', async () => {
    const routes = collectRoutes(ctx.app).filter(
      (r) => !r.isPublic && r.scope === 'tenant' && r.path.includes(':'),
    );
    expect(routes.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const r of routes) {
      const key = `${r.method.toUpperCase()} ${r.path}`;
      const path = r.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => idFor(r.path, name));
      const req = ctx.http[r.method](path).set(bearer(admB)).set('Idempotency-Key', randomUUID());
      const body = bodies[key];
      const res = body ? await req.send(body()) : await req.send();
      if (res.status !== 404) failures.push(`${key} → ${res.status}`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('GET /tenant renvoie uniquement son propre établissement', async () => {
    const res = await ctx.http.get('/api/v1/tenant').set(bearer(admB));
    expect(res.body.data.id).toBe(seed.tenants.univ.id);
  });

  it('les listes ne contiennent que des objets du tenant courant', async () => {
    const roles = await ctx.http.get('/api/v1/roles').set(bearer(admB));
    expect(roles.status).toBe(200);
    const ids = new Set((roles.body.data as { id: string }[]).map((r) => r.id));
    for (const id of Object.values(seed.tenants.lycee.roleIds)) expect(ids.has(id)).toBe(false);
    for (const id of Object.values(seed.tenants.univ.roleIds)) expect(ids.has(id)).toBe(true);

    const members = await ctx.http.get('/api/v1/members').set(bearer(admB));
    const emails = (members.body.data as { email: string }[]).map((m) => m.email);
    expect(emails.every((e) => e.endsWith('@univ-demo.local'))).toBe(true);
  });

  it("le journal d'audit ne montre pas les actions des autres tenants", async () => {
    await ctx.owner.query(
      `insert into audit_logs (tenant_id, action, entity_type, entity_id) values ($1, 'isolation.probe', 'Probe', 'A')`,
      [seed.tenants.lycee.id],
    );
    const res = await ctx.http.get('/api/v1/audit-logs?limit=200').set(bearer(admB));
    expect(res.status).toBe(200);
    expect(
      (res.body.data as { action: string }[]).some((l) => l.action === 'isolation.probe'),
    ).toBe(false);
  });
});
