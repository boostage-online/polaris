import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listZip } from '../src/modules/reporting';
import {
  ReportRefreshService,
  TenantExportService,
  ScheduledReportsService,
} from '../src/modules/reporting';
import {
  bearer,
  loginAs,
  loginPlatform,
  seed,
  startApp,
  type Session,
  type TestContext,
} from './helpers';

/** Reporting (Phase 6) : agrégats, rapports CSV, tableaux de bord, traçabilité, rapports planifiés, export, vue plateforme. */
describe('Reporting et tableaux de bord', () => {
  let ctx: TestContext;
  let admin: Session;
  let direction: Session;
  let finance: Session;
  let academic: Session;
  let teacher: Session;
  let platform: Session;
  const T = () => seed.tenants.lycee;
  const ac = () => T().academic;

  beforeAll(async () => {
    ctx = await startApp();
    admin = await loginAs(ctx, 'lycee', 'ADMIN');
    direction = await loginAs(ctx, 'lycee', 'DIRECTION');
    finance = await loginAs(ctx, 'lycee', 'FINANCE');
    academic = await loginAs(ctx, 'lycee', 'ACADEMIC_HEAD');
    teacher = await loginAs(ctx, 'lycee', 'TEACHER');
    platform = await loginPlatform(ctx);
    // Agrégats complets (le worker le fait toutes les 5 min ; ici à la demande).
    await ctx.app.get(ReportRefreshService).refreshAll(T().id);
  }, 60_000);
  afterAll(() => ctx.close());

  it('les agrégats quotidiens reflètent la séance seedée (appel soumis : 1 absent, 1 retard) et le paiement de 60 000', async () => {
    const att = await ctx.owner.query<{
      records: number;
      present: number;
      absent: number;
      late: number;
      sheets_submitted: number;
    }>(
      `select records, present, absent, late, sheets_submitted from report_attendance_daily where tenant_id = $1 and group_id = $2 and day = '2026-10-12'`,
      [T().id, ac().groupIds.sixA],
    );
    expect(att.rows.length).toBeGreaterThanOrEqual(1);
    const row = att.rows[0]!;
    expect(row.sheets_submitted).toBeGreaterThanOrEqual(1);
    expect(row.absent).toBeGreaterThanOrEqual(1);
    expect(row.late).toBeGreaterThanOrEqual(1);
    const fin = await ctx.owner.query<{ channel: string; amount: string; payments: number }>(
      `select channel, amount, payments from report_finance_daily where tenant_id = $1 and day = '2026-10-02'`,
      [T().id],
    );
    const cash = fin.rows.find((r) => r.channel === 'CASH');
    expect(cash).toBeDefined();
    expect(Number(cash!.amount)).toBeGreaterThanOrEqual(60000);
    // Rejouable : un second rafraîchissement ne duplique rien.
    const r = await ctx.app
      .get(ReportRefreshService)
      .refresh(T().id, { from: '2026-10-01', to: '2026-10-31' });
    expect(r.attendanceRows).toBeGreaterThanOrEqual(1);
    const again = await ctx.owner.query<{ n: number }>(
      `select count(*)::int as n from report_finance_daily where tenant_id = $1 and day = '2026-10-02' and channel = 'CASH'`,
      [T().id],
    );
    expect(again.rows[0]!.n).toBe(1);
  });

  it('catalogue filtré par permission ; rapport JSON et CSV ; un rôle sans la permission du rapport reçoit 403', async () => {
    const cat = await ctx.http.get('/api/v1/reports').set(bearer(finance));
    expect(cat.status).toBe(200);
    const keys = (cat.body.data as { key: string }[]).map((k) => k.key);
    expect(keys).toContain('collections-by-channel');
    expect(keys).not.toContain('attendance-by-group');
    const all = await ctx.http.get('/api/v1/reports').set(bearer(direction));
    expect((all.body.data as unknown[]).length).toBe(8);

    const res = await ctx.http
      .get('/api/v1/reports/attendance-by-group?from=2026-10-01&to=2026-10-31')
      .set(bearer(direction));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.columns.length).toBeGreaterThan(5);
    const sixA = (
      res.body.data.rows as { groupName: string; records: number; presenceRate: number | null }[]
    ).find((r) => r.groupName === '6e A')!;
    expect(sixA.records).toBeGreaterThanOrEqual(3);
    expect(sixA.presenceRate).not.toBeNull();

    const csv = await ctx.http
      .get('/api/v1/reports/attendance-by-group.csv?from=2026-10-01&to=2026-10-31')
      .set(bearer(direction));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain(
      'attendance-by-group_2026-10-01_2026-10-31.csv',
    );
    expect(csv.text).toContain('Classe;Niveau');
    expect(csv.text).toContain('6e A');

    expect(
      (await ctx.http.get('/api/v1/reports/attendance-by-group').set(bearer(finance))).status,
    ).toBe(403);
    expect(
      (await ctx.http.get('/api/v1/reports/collections-by-channel').set(bearer(academic))).status,
    ).toBe(403);
    expect((await ctx.http.get('/api/v1/reports').set(bearer(teacher))).status).toBe(403);
    expect((await ctx.http.get('/api/v1/reports/inconnu').set(bearer(direction))).status).toBe(422);
    expect(
      (
        await ctx.http
          .get('/api/v1/reports/attendance-by-group?from=2026-12-01&to=2026-11-01')
          .set(bearer(direction))
      ).status,
    ).toBe(422);
  });

  it('les huit rapports s’exécutent ; élèves à risque et encaissements par canal portent les données seedées', async () => {
    for (const key of [
      'students-at-risk',
      'missing-sheets',
      'attendance-corrections',
      'collections-by-channel',
      'recovery-by-group',
      'parent-activation',
      'payment-attempts',
    ]) {
      const r = await ctx.http
        .get(`/api/v1/reports/${key}?from=2026-09-01&to=2026-12-31`)
        .set(bearer(admin));
      expect(r.status, `${key}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    // Un élève avec trois absences non justifiées sur la période (statistiques quotidiennes posées par le test).
    const s3 = ac().studentIds[2]!;
    await ctx.owner.query(
      `insert into attendance_daily_stats (tenant_id, student_id, day, sessions, present, absent, late, excused, unjustified, updated_at)
       values ($1, $2, '2026-10-20', 2, 1, 1, 0, 0, 1, now()), ($1, $2, '2026-10-21', 2, 1, 1, 0, 0, 1, now()), ($1, $2, '2026-10-22', 2, 1, 1, 0, 0, 1, now())
       on conflict (tenant_id, student_id, day) do update set sessions = excluded.sessions, present = excluded.present, absent = excluded.absent, unjustified = excluded.unjustified`,
      [T().id, s3],
    );
    const risk = await ctx.http
      .get('/api/v1/reports/students-at-risk?from=2026-10-01&to=2026-10-31')
      .set(bearer(academic));
    expect(risk.status, JSON.stringify(risk.body)).toBe(200);
    const rows = risk.body.data.rows as { studentId: string; unjustified: number }[];
    expect(rows.find((r) => r.studentId === s3)?.unjustified).toBeGreaterThanOrEqual(3);
    const channels = await ctx.http
      .get('/api/v1/reports/collections-by-channel?from=2026-10-01&to=2026-10-31')
      .set(bearer(finance));
    const cash = (
      channels.body.data.rows as { channelCode: string; amount: number; kind: string }[]
    ).find((r) => r.channelCode === 'CASH')!;
    expect(cash.kind).toBe('Caisse');
    expect(cash.amount).toBeGreaterThanOrEqual(60000);
    const activation = await ctx.http
      .get('/api/v1/reports/parent-activation')
      .set(bearer(direction));
    const g = (
      activation.body.data.rows as { groupName: string; guardians: number; activated: number }[]
    ).find((r) => r.groupName === '6e A')!;
    expect(g.guardians).toBeGreaterThanOrEqual(1);
    expect(g.activated).toBeGreaterThanOrEqual(1);
  });

  it('tableaux de bord direction, pédagogique et canaux financiers', async () => {
    const d = await ctx.http.get('/api/v1/dashboards/direction').set(bearer(direction));
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.data.students.active).toBeGreaterThanOrEqual(3);
    expect(d.body.data.finance.invoiced).toBeGreaterThanOrEqual(150000);
    expect(d.body.data.parents.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(d.body.data.trends.attendanceWeekly)).toBe(true);
    expect(d.body.data.refreshedAt).toBeTruthy();
    expect((await ctx.http.get('/api/v1/dashboards/direction').set(bearer(finance))).status).toBe(
      403,
    );

    const p = await ctx.http
      .get('/api/v1/dashboards/pedagogy?from=2026-10-01&to=2026-10-31')
      .set(bearer(academic));
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(
      (p.body.data.byGroup as { groupName: string }[]).some((g) => g.groupName === '6e A'),
    ).toBe(true);
    expect(Array.isArray(p.body.data.studentsAtRisk)).toBe(true);
    expect(Array.isArray(p.body.data.lateDistribution)).toBe(true);

    const c = await ctx.http
      .get('/api/v1/dashboards/finance/channels?from=2026-10-01&to=2026-10-31')
      .set(bearer(finance));
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(
      (c.body.data.channels as { channel: string; kind: string }[]).some(
        (x) => x.channel === 'CASH' && x.kind === 'MANUAL',
      ),
    ).toBe(true);
    expect(c.body.data.online.attempts).toBeGreaterThanOrEqual(0);
    expect(
      (await ctx.http.get('/api/v1/dashboards/finance/channels').set(bearer(academic))).status,
    ).toBe(403);
  });

  it("traçabilité d'une feuille d'appel et d'une notification", async () => {
    const s = await ctx.http
      .get(`/api/v1/trace/sheets/${ac().attendance.sheetId}`)
      .set(bearer(direction));
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.data.sheet.status).toBe('SUBMITTED');
    expect(s.body.data.session.groupName).toBe('6e A');
    expect(s.body.data.counts.records).toBeGreaterThanOrEqual(3);
    expect(s.body.data.counts.absent).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(s.body.data.revisions)).toBe(true);
    expect(
      (await ctx.http.get(`/api/v1/trace/sheets/${ac().attendance.sheetId}`).set(bearer(teacher)))
        .status,
    ).toBe(403);

    const n = await ctx.http
      .get(`/api/v1/trace/notifications/${ac().attendance.notificationId}`)
      .set(bearer(admin));
    expect(n.status, JSON.stringify(n.body)).toBe(200);
    expect(n.body.data.notification.recipient.userId).toBe(ac().parentUser.userId);
    expect(n.body.data.notification.channel).toBeTruthy();
    expect(
      (
        await ctx.http
          .get(`/api/v1/trace/notifications/${ac().attendance.notificationId}`)
          .set(bearer(finance))
      ).status,
    ).toBe(403);
  });

  it('rapports planifiés : création, envoi immédiat avec CSV en pièce jointe, envoi dû du jour, suspension, suppression', async () => {
    const created = await ctx.http
      .post('/api/v1/scheduled-reports')
      .set(bearer(direction))
      .send({
        reportKey: 'recovery-by-group',
        cadence: 'MONTHLY',
        dayOfPeriod: 1,
        recipients: ['direction@lycee-demo.local', 'comptable@lycee-demo.local'],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    expect(
      (
        await ctx.http
          .post('/api/v1/scheduled-reports')
          .set(bearer(direction))
          .send({
            reportKey: 'recovery-by-group',
            cadence: 'WEEKLY',
            dayOfPeriod: 9,
            recipients: ['x@y.z'],
          })
      ).status,
    ).toBe(422);

    const before = ctx.email.sent.length;
    const sent = await ctx.http.post(`/api/v1/scheduled-reports/${id}/send`).set(bearer(direction));
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.data.sent).toBe(2);
    const mails = ctx.email.sent.slice(before);
    expect(mails).toHaveLength(2);
    expect(mails[0]!.subject).toContain('Recouvrement par classe');
    expect(mails[0]!.attachments?.[0]?.filename).toMatch(
      /^recovery-by-group_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const csv = Buffer.from(mails[0]!.attachments![0]!.content, 'base64').toString('utf8');
    expect(csv).toContain('Classe;Élèves');

    // Envoi « dû » : un rapport hebdomadaire planifié pour aujourd'hui part une seule fois par jour.
    const tz = 'Africa/Porto-Novo';
    const isoWeekday =
      ((new Date(new Date().toLocaleString('en-US', { timeZone: tz })).getDay() + 6) % 7) + 1;
    const weekly = await ctx.http
      .post('/api/v1/scheduled-reports')
      .set(bearer(direction))
      .send({
        reportKey: 'attendance-by-group',
        cadence: 'WEEKLY',
        dayOfPeriod: isoWeekday,
        recipients: ['vie-scolaire@lycee-demo.local'],
      });
    expect(weekly.status).toBe(201);
    const svc = ctx.app.get(ScheduledReportsService);
    const first = await svc.runDue(T().id);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const second = await svc.runDue(T().id);
    expect(second.sent).toBe(0);

    const off = await ctx.http
      .patch(`/api/v1/scheduled-reports/${id}`)
      .set(bearer(direction))
      .send({ enabled: false });
    expect(off.body.data.enabled).toBe(false);
    expect(
      (await ctx.http.delete(`/api/v1/scheduled-reports/${id}`).set(bearer(direction))).status,
    ).toBe(204);
    expect(
      (
        await ctx.http
          .delete(`/api/v1/scheduled-reports/${weekly.body.data.id}`)
          .set(bearer(direction))
      ).status,
    ).toBe(204);
    expect((await ctx.http.get('/api/v1/scheduled-reports').set(bearer(finance))).status).toBe(403);
  });

  it("export complet de l'établissement : demande, construction (worker), archive ZIP de CSV téléchargeable", async () => {
    const req = await ctx.http.post('/api/v1/tenant-exports').set(bearer(admin));
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(req.body.data.status).toBe('QUEUED');
    const id = req.body.data.id as string;
    expect((await ctx.http.post('/api/v1/tenant-exports').set(bearer(admin))).status).toBe(409);
    expect(
      (await ctx.http.get(`/api/v1/tenant-exports/${id}/download`).set(bearer(admin))).status,
    ).toBe(409);

    const built = await ctx.app.get(TenantExportService).build(T().id, id);
    expect(built?.status).toBe('DONE');
    const st = await ctx.http.get(`/api/v1/tenant-exports/${id}`).set(bearer(admin));
    expect(st.body.data.status).toBe('DONE');
    const entries = st.body.data.entries as { name: string; rows: number }[];
    expect(entries.find((e) => e.name === 'eleves')!.rows).toBeGreaterThanOrEqual(3);
    expect(entries.find((e) => e.name === 'paiements')!.rows).toBeGreaterThanOrEqual(1);

    const dl = await ctx.http
      .get(`/api/v1/tenant-exports/${id}/download`)
      .set(bearer(admin))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('application/zip');
    const zip = dl.body as Buffer;
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
    const names = listZip(zip).map((e) => e.name);
    expect(names).toContain('eleves.csv');
    expect(names).toContain('presences.csv');
    expect(names).toContain('README.txt');
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect((await ctx.http.get('/api/v1/tenant-exports').set(bearer(direction))).status).toBe(403);
    // Un export du lycée n'est pas visible depuis l'université.
    const admB = await loginAs(ctx, 'univ', 'ADMIN');
    expect((await ctx.http.get(`/api/v1/tenant-exports/${id}`).set(bearer(admB))).status).toBe(404);
  });

  it('vue plateforme (Super Admin) : parc, volumétrie, santé, par établissement ; refusée aux rôles tenant', async () => {
    const o = await ctx.http.get('/api/v1/platform/overview').set(bearer(platform));
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    expect(o.body.data.tenants.total).toBeGreaterThanOrEqual(2);
    expect(o.body.data.totals.studentsActive).toBeGreaterThanOrEqual(6);
    expect(o.body.data.health.database).toBe(true);
    expect(o.body.data.health.redis).toBe(true);
    expect((o.body.data.health.queues as { name: string }[]).map((q) => q.name)).toContain(
      'payments',
    );
    const lycee = (
      o.body.data.perTenant as {
        code: string;
        studentsActive: number;
        lastRefreshAt: string | null;
      }[]
    ).find((t) => t.code === 'lycee-demo')!;
    expect(lycee.studentsActive).toBeGreaterThanOrEqual(3);
    expect(lycee.lastRefreshAt).toBeTruthy();
    expect((await ctx.http.get('/api/v1/platform/overview').set(bearer(admin))).status).toBe(404);
  });
});
