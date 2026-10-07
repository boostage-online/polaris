import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { UsageMonth } from '@polaris/contracts';
import { DatabaseService } from '../../../database/database.service';
import { tenantUsageMonthly } from '../../../database/schema';

const n = (v: unknown) => Number(v ?? 0);

/** Premier jour du mois (UTC) au format `YYYY-MM-01`. */
export function monthStart(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
export function previousMonthStart(d = new Date()): string {
  return monthStart(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
}

/**
 * Consommation mensuelle par établissement (Phase 8, Partie 18 : mesure avant toute facturation SaaS).
 * Instantané recalculé chaque nuit pour le mois courant (et le mois précédent les deux premiers jours du
 * mois, pour figer les totaux). Table tenant sous RLS : écrite dans une transaction tenant, lue par la
 * plateforme avec BYPASSRLS, exportable en CSV pour la facturation manuelle.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);
  constructor(private readonly db: DatabaseService) {}

  /** Recalcule et enregistre l'instantané d'un mois pour un établissement (idempotent). */
  async snapshot(tenantId: string, month = monthStart()) {
    return this.db.withTenantTx(tenantId, async (tx) => {
      const r = (
        await tx.execute<{
          active_students: number;
          guardians: number;
          guardians_activated: number;
          staff_active: number;
          sheets_submitted: number;
          sms_sent: number;
          emails_sent: number;
          online_payments: number;
          online_amount: number;
          manual_payments: number;
          manual_amount: number;
        }>(sql`
          with m as (select ${month}::date as start, (${month}::date + interval '1 month') as stop)
          select (select count(*) from students where status = 'ACTIVE' and deleted_at is null)::int as active_students,
                 (select count(*) from guardians where deleted_at is null)::int as guardians,
                 (select count(*) from guardians where deleted_at is null and user_id is not null)::int as guardians_activated,
                 (select count(*) from memberships where tenant_id = ${tenantId}::uuid and kind = 'STAFF' and status = 'ACTIVE')::int as staff_active,
                 (select count(*) from attendance_sheets, m where submitted_at >= m.start and submitted_at < m.stop)::int as sheets_submitted,
                 (select count(*) from notifications, m where channel = 'SMS' and status in ('SENT','DELIVERED') and created_at >= m.start and created_at < m.stop)::int as sms_sent,
                 (select count(*) from notifications, m where channel = 'EMAIL' and status in ('SENT','DELIVERED') and created_at >= m.start and created_at < m.stop)::int as emails_sent,
                 (select count(*) from payments, m where status = 'COMPLETED' and source = 'ELECTRONIC' and value_date >= m.start and value_date < m.stop)::int as online_payments,
                 (select coalesce(sum(amount), 0) from payments, m where status = 'COMPLETED' and source = 'ELECTRONIC' and value_date >= m.start and value_date < m.stop)::bigint as online_amount,
                 (select count(*) from payments, m where status = 'COMPLETED' and source = 'MANUAL' and value_date >= m.start and value_date < m.stop)::int as manual_payments,
                 (select coalesce(sum(amount), 0) from payments, m where status = 'COMPLETED' and source = 'MANUAL' and value_date >= m.start and value_date < m.stop)::bigint as manual_amount`)
      ).rows[0]!;
      const row = {
        tenantId,
        month,
        activeStudents: n(r.active_students),
        guardians: n(r.guardians),
        guardiansActivated: n(r.guardians_activated),
        staffActive: n(r.staff_active),
        sheetsSubmitted: n(r.sheets_submitted),
        smsSent: n(r.sms_sent),
        emailsSent: n(r.emails_sent),
        onlinePayments: n(r.online_payments),
        onlineAmount: n(r.online_amount),
        manualPayments: n(r.manual_payments),
        manualAmount: n(r.manual_amount),
        computedAt: new Date(),
      };
      await tx
        .insert(tenantUsageMonthly)
        .values(row)
        .onConflictDoUpdate({
          target: [tenantUsageMonthly.tenantId, tenantUsageMonthly.month],
          set: { ...row },
        });
      return row;
    });
  }

  /** Tous les établissements actifs, mois courant + mois précédent les deux premiers jours du mois (figer les totaux). */
  async snapshotAll(now = new Date()) {
    const ids = await this.db.withPlatformTx('usage snapshot tenants', async (tx) =>
      (
        await tx.execute<{ id: string }>(
          sql`select id from tenants where status in ('TRIAL','ACTIVE') order by created_at`,
        )
      ).rows.map((r) => r.id),
    );
    const months = [monthStart(now)];
    if (now.getUTCDate() <= 2) months.push(previousMonthStart(now));
    const results: Record<string, string[]> = {};
    for (const id of ids) {
      results[id] = [];
      for (const m of months) {
        try {
          await this.snapshot(id, m);
          results[id].push(m);
        } catch (e) {
          this.logger.error({
            msg: 'usage snapshot failed',
            tenantId: id,
            month: m,
            err: (e as Error).message,
          });
        }
      }
    }
    return { tenants: ids.length, months };
  }

  /** Vue plateforme : une ligne par établissement pour le mois demandé (défaut : mois courant). */
  async list(month?: string): Promise<UsageMonth[]> {
    const tx = this.db.current();
    const start = month ? `${month}-01` : monthStart();
    const rows = await tx.execute<{
      tenant_id: string;
      code: string;
      name: string;
      plan: 'PILOT' | 'STANDARD' | 'PREMIUM';
      month: string;
      active_students: number;
      guardians: number;
      guardians_activated: number;
      staff_active: number;
      sheets_submitted: number;
      sms_sent: number;
      emails_sent: number;
      online_payments: number;
      online_amount: number;
      manual_payments: number;
      manual_amount: number;
      computed_at: Date;
    }>(sql`
      select u.tenant_id, t.code, t.name, t.plan, to_char(u.month, 'YYYY-MM') as month,
             u.active_students, u.guardians, u.guardians_activated, u.staff_active, u.sheets_submitted,
             u.sms_sent, u.emails_sent, u.online_payments, u.online_amount, u.manual_payments, u.manual_amount, u.computed_at
      from tenant_usage_monthly u join tenants t on t.id = u.tenant_id
      where u.month = ${start}::date
      order by t.name`);
    return rows.rows.map((r) => ({
      tenantId: r.tenant_id,
      code: r.code,
      name: r.name,
      plan: r.plan,
      month: r.month,
      activeStudents: n(r.active_students),
      guardians: n(r.guardians),
      guardiansActivated: n(r.guardians_activated),
      staffActive: n(r.staff_active),
      sheetsSubmitted: n(r.sheets_submitted),
      smsSent: n(r.sms_sent),
      emailsSent: n(r.emails_sent),
      onlinePayments: n(r.online_payments),
      onlineAmount: n(r.online_amount),
      manualPayments: n(r.manual_payments),
      manualAmount: n(r.manual_amount),
      computedAt: new Date(r.computed_at).toISOString(),
    }));
  }

  /** CSV (`;`, BOM UTF-8) pour la facturation manuelle. */
  toCsv(rows: UsageMonth[]): string {
    const head = [
      'mois',
      'code',
      'etablissement',
      'offre',
      'eleves_actifs',
      'tuteurs',
      'tuteurs_actives',
      'personnel_actif',
      'appels_soumis',
      'sms_envoyes',
      'emails_envoyes',
      'paiements_en_ligne',
      'montant_en_ligne_xof',
      'paiements_manuels',
      'montant_manuel_xof',
      'calcule_le',
    ];
    const esc = (v: string | number) => {
      const s = String(v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) =>
      [
        r.month,
        r.code,
        r.name,
        r.plan,
        r.activeStudents,
        r.guardians,
        r.guardiansActivated,
        r.staffActive,
        r.sheetsSubmitted,
        r.smsSent,
        r.emailsSent,
        r.onlinePayments,
        r.onlineAmount,
        r.manualPayments,
        r.manualAmount,
        r.computedAt,
      ]
        .map(esc)
        .join(';'),
    );
    return `\uFEFF${[head.join(';'), ...lines].join('\n')}\n`;
  }
}
