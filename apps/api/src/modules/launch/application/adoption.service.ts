import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AdoptionOverview } from '@polaris/contracts';
import { DatabaseService } from '../../../database/database.service';

const pct = (num: number, den: number) => (den > 0 ? Math.round((num * 1000) / den) / 10 : null);
const n = (v: unknown) => Number(v ?? 0);

/** Seuils de la porte G8 (document directeur, Phase 8). */
export const G8 = {
  /** ≥ 70 % des parents des pilotes activés. */
  activationRate: 70,
  /** Part des séances tenues avec un appel soumis sur 7 jours : seuil de bonne adoption enseignants. */
  sheetRate7d: 80,
};

/**
 * Tableau de bord d'adoption (Super Admin, Phase 8) : par établissement, l'activation des parents, l'usage
 * réel par les enseignants (appels soumis / séances tenues), la part du paiement en ligne et la consommation
 * SMS ; pour le parc, les totaux et une tendance sur 8 semaines. Lecture seule, agrégats sans nom.
 */
@Injectable()
export class AdoptionService {
  constructor(private readonly db: DatabaseService) {}

  async overview(): Promise<AdoptionOverview> {
    const tx = this.db.current();
    const [perTenant, weekly] = await Promise.all([
      tx.execute<{
        id: string;
        code: string;
        name: string;
        status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED';
        plan: 'PILOT' | 'STANDARD' | 'PREMIUM';
        live_at: Date | null;
        hypercare_until: Date | null;
        students: number;
        guardians: number;
        activated: number;
        teachers: number;
        teachers_active: number;
        held7: number;
        submitted7: number;
        online30: number;
        total30: number;
        sms_month: number;
        sms_cap: number;
        open_alerts: number;
      }>(sql`
        select t.id, t.code, t.name, t.status, t.plan, t.live_at, t.hypercare_until,
               (select count(*) from students s where s.tenant_id = t.id and s.status = 'ACTIVE' and s.deleted_at is null)::int as students,
               (select count(*) from guardians g where g.tenant_id = t.id and g.deleted_at is null)::int as guardians,
               (select count(*) from guardians g where g.tenant_id = t.id and g.deleted_at is null and g.user_id is not null)::int as activated,
               (select count(distinct ct.staff_profile_id) from course_teachers ct where ct.tenant_id = t.id)::int as teachers,
               (select count(distinct sh.submitted_by) from attendance_sheets sh
                  where sh.tenant_id = t.id and sh.submitted_at >= now() - interval '7 days')::int as teachers_active,
               (select coalesce(sum(d.sessions_held), 0) from report_attendance_daily d where d.tenant_id = t.id and d.day >= current_date - 6)::int as held7,
               (select coalesce(sum(d.sheets_submitted), 0) from report_attendance_daily d where d.tenant_id = t.id and d.day >= current_date - 6)::int as submitted7,
               (select count(*) from payments p where p.tenant_id = t.id and p.status = 'COMPLETED' and p.source = 'ELECTRONIC' and p.value_date >= current_date - 29)::int as online30,
               (select count(*) from payments p where p.tenant_id = t.id and p.status = 'COMPLETED' and p.value_date >= current_date - 29)::int as total30,
               (select count(*) from notifications nt where nt.tenant_id = t.id and nt.channel = 'SMS' and nt.status in ('SENT','DELIVERED') and nt.created_at >= date_trunc('month', now()))::int as sms_month,
               coalesce((t.settings -> 'notifications' ->> 'smsMonthlyCap')::int, 2000) as sms_cap,
               (select count(*) from platform_alerts a where a.tenant_id = t.id and a.resolved_at is null)::int as open_alerts
        from tenants t
        order by t.live_at nulls last, t.created_at`),
      tx.execute<{
        week_start: string;
        activated: number;
        held: number;
        submitted: number;
        online: number;
      }>(sql`
        with weeks as (
          select generate_series(date_trunc('week', current_date)::date - interval '7 weeks', date_trunc('week', current_date)::date, interval '1 week')::date as week_start
        )
        select to_char(w.week_start, 'YYYY-MM-DD') as week_start,
               (select count(*) from guardians g join users u on u.id = g.user_id
                  where g.deleted_at is null and u.created_at < w.week_start + interval '7 days')::int as activated,
               (select coalesce(sum(sessions_held), 0) from report_attendance_daily d where d.day >= w.week_start and d.day < w.week_start + 7)::int as held,
               (select coalesce(sum(sheets_submitted), 0) from report_attendance_daily d where d.day >= w.week_start and d.day < w.week_start + 7)::int as submitted,
               (select count(*) from payments p where p.status = 'COMPLETED' and p.source = 'ELECTRONIC' and p.value_date >= w.week_start and p.value_date < w.week_start + 7)::int as online
        from weeks w order by w.week_start`),
    ]);
    const now = Date.now();
    const rows: AdoptionOverview['tenants'] = perTenant.rows.map((r) => {
      const liveAt = r.live_at ? new Date(r.live_at) : null;
      const activationRate = pct(n(r.activated), n(r.guardians));
      const sheetRate7d = pct(n(r.submitted7), n(r.held7));
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        status: r.status,
        plan: r.plan,
        liveAt: liveAt?.toISOString() ?? null,
        daysLive: liveAt ? Math.max(0, Math.floor((now - liveAt.getTime()) / 86_400_000)) : null,
        inHypercare: r.hypercare_until !== null && new Date(r.hypercare_until).getTime() > now,
        students: n(r.students),
        guardians: n(r.guardians),
        guardiansActivated: n(r.activated),
        activationRate,
        teachers: n(r.teachers),
        teachersActive7d: n(r.teachers_active),
        sheetsExpected7d: n(r.held7),
        sheetsSubmitted7d: n(r.submitted7),
        sheetRate7d,
        onlineShare30d: pct(n(r.online30), n(r.total30)),
        smsMonth: n(r.sms_month),
        smsCap: n(r.sms_cap),
        openAlerts: n(r.open_alerts),
        meetsG8: activationRate !== null && activationRate >= G8.activationRate,
      };
    });
    const sum = (f: (t: (typeof rows)[number]) => number) => rows.reduce((a, t) => a + f(t), 0);
    const guardians = sum((t) => t.guardians);
    const activated = sum((t) => t.guardiansActivated);
    return {
      generatedAt: new Date().toISOString(),
      fleet: {
        tenants: rows.length,
        live: rows.filter((t) => t.liveAt !== null).length,
        inHypercare: rows.filter((t) => t.inHypercare).length,
        students: sum((t) => t.students),
        guardians,
        guardiansActivated: activated,
        activationRate: pct(activated, guardians),
        sheetRate7d: pct(
          sum((t) => t.sheetsSubmitted7d),
          sum((t) => t.sheetsExpected7d),
        ),
        tenantsMeetingG8: rows.filter((t) => t.meetsG8).length,
      },
      tenants: rows,
      weekly: weekly.rows.map((w) => ({
        weekStart: w.week_start,
        guardiansActivated: n(w.activated),
        sheetRate: pct(n(w.submitted), n(w.held)),
        onlinePayments: n(w.online),
      })),
    };
  }
}
