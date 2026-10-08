import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import type { DailyReview } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import { platformDailyReviews } from '../../../database/schema';
import { AuditService } from '../../audit';
import { EMAIL_GATEWAY, type EmailGateway } from '../../shared';

type TenantRow = DailyReview['tenants'][number];

const n = (v: unknown) => Number(v ?? 0);
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Revue quotidienne (hypercare, Phase 8) : chaque matin à 07:00 le worker compile, pour la plateforme et
 * pour chaque établissement, ce que le document directeur demande de revoir pendant les 4 semaines qui
 * suivent une mise en production — alertes, tentatives UNKNOWN, réconciliation, intégrité du grand-livre,
 * quotas SMS, erreurs d'import, notifications en échec, appels manquants — et l'envoie par e-mail aux
 * administrateurs plateforme. La revue est une ligne par jour : on la lit, on agit, on l'**acquitte** avec
 * une note ; une journée sans point d'attention est marquée « saine » en une ligne.
 */
@Injectable()
export class HypercareService {
  private readonly logger = new Logger(HypercareService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Génère (ou régénère) la revue du jour et l'envoie si elle est nouvelle. */
  async generate(day = today(), opts: { notify?: boolean } = {}): Promise<DailyReview> {
    return this.db.withPlatformTx('hypercare daily review', async (tx) => {
      const existing = await tx.query.platformDailyReviews.findFirst({
        where: eq(platformDailyReviews.day, day),
      });
      const tenants = await this.collectTenants(tx);
      const summary = await this.summarize(tx, tenants);
      const generatedAt = new Date();
      await tx
        .insert(platformDailyReviews)
        .values({
          day,
          generatedAt,
          summary,
          tenants,
          reviewedAt: null,
          reviewedBy: null,
          notes: null,
        })
        .onConflictDoUpdate({
          target: platformDailyReviews.day,
          set: { generatedAt, summary, tenants },
        });
      if (opts.notify !== false && !existing) await this.notify(tx, day, summary, tenants);
      return this.toDto({
        day,
        generatedAt,
        summary,
        tenants,
        reviewedAt: existing?.reviewedAt ?? null,
        reviewedBy: existing?.reviewedBy ?? null,
        notes: existing?.notes ?? null,
      });
    });
  }

  async list(limit = 30): Promise<DailyReview[]> {
    const tx = this.db.current();
    const rows = await tx
      .select()
      .from(platformDailyReviews)
      .orderBy(desc(platformDailyReviews.day))
      .limit(limit);
    return rows.map((r) => this.toDto(r));
  }

  async get(day: string): Promise<DailyReview> {
    const tx = this.db.current();
    const row = await tx.query.platformDailyReviews.findFirst({
      where: eq(platformDailyReviews.day, day),
    });
    if (!row) throw AppError.notFound('Revue');
    return this.toDto(row);
  }

  /** Acquittement : qui a lu, quand, avec quelle note (actions décidées). */
  async acknowledge(day: string, notes?: string): Promise<DailyReview> {
    const tx = this.db.current();
    const actor = RequestContextStore.require().actor!;
    const [row] = await tx
      .update(platformDailyReviews)
      .set({ reviewedAt: new Date(), reviewedBy: actor.userId, notes: notes ?? null })
      .where(eq(platformDailyReviews.day, day))
      .returning();
    if (!row) throw AppError.notFound('Revue');
    await this.audit.record({
      action: 'hypercare.review_acknowledged',
      entityType: 'DailyReview',
      entityId: day,
      tenantId: null,
      after: { notes: notes ?? null },
    });
    return this.toDto(row);
  }

  // ------------------------------------------------------------------ collecte

  private async collectTenants(tx: Db): Promise<TenantRow[]> {
    const rows = await tx.execute<{
      id: string;
      code: string;
      name: string;
      hypercare_until: Date | null;
      open_alerts: number;
      unknown_attempts: number;
      pending_over_1h: number;
      recon_status: string | null;
      ledger_mismatches: number | null;
      sms_month: number;
      sms_cap: number;
      imports_failed: number;
      notif_failed: number;
      sheets_missing: number;
      activated_delta: number;
    }>(sql`
      select t.id, t.code, t.name, t.hypercare_until,
             (select count(*) from platform_alerts a where a.tenant_id = t.id and a.resolved_at is null)::int as open_alerts,
             (select count(*) from payment_attempts a where a.tenant_id = t.id and a.status = 'UNKNOWN')::int as unknown_attempts,
             (select count(*) from payment_attempts a where a.tenant_id = t.id and a.status in ('CREATED','PENDING','PROCESSING') and a.created_at < now() - interval '1 hour')::int as pending_over_1h,
             (select r.status from payment_reconciliation_runs r where r.tenant_id = t.id order by r.day desc, r.created_at desc limit 1) as recon_status,
             (select c.mismatches from ledger_integrity_checks c where c.tenant_id = t.id order by c.checked_at desc limit 1) as ledger_mismatches,
             (select count(*) from notifications nt where nt.tenant_id = t.id and nt.channel = 'SMS' and nt.status in ('SENT','DELIVERED') and nt.created_at >= date_trunc('month', now()))::int as sms_month,
             coalesce((t.settings -> 'notifications' ->> 'smsMonthlyCap')::int, 2000) as sms_cap,
             (select count(*) from import_jobs j where j.tenant_id = t.id and j.status = 'FAILED' and j.created_at >= now() - interval '24 hours')::int as imports_failed,
             (select count(*) from notifications nt where nt.tenant_id = t.id and nt.status = 'FAILED' and nt.created_at >= now() - interval '24 hours')::int as notif_failed,
             (select coalesce(sum(d.sheets_missing), 0) from report_attendance_daily d where d.tenant_id = t.id and d.day >= current_date - 1)::int as sheets_missing,
             (select count(*) from guardians g join users u on u.id = g.user_id where g.tenant_id = t.id and g.deleted_at is null and u.created_at >= now() - interval '24 hours')::int as activated_delta
      from tenants t
      where t.status in ('TRIAL','ACTIVE')
      order by t.hypercare_until desc nulls last, t.name`);
    const now = Date.now();
    return rows.rows.map((r) => {
      const smsRatio =
        n(r.sms_cap) > 0 ? Math.round((n(r.sms_month) * 1000) / n(r.sms_cap)) / 10 : null;
      const reconciliation: TenantRow['reconciliation'] =
        r.recon_status === 'OK' || r.recon_status === 'UNSUPPORTED'
          ? 'OK'
          : r.recon_status === 'DISCREPANCIES'
            ? 'DISCREPANCIES'
            : r.recon_status === 'ERROR'
              ? 'ERROR'
              : 'NONE';
      const flags: string[] = [];
      if (n(r.open_alerts) > 0) flags.push(`${n(r.open_alerts)} alerte(s) ouverte(s)`);
      if (n(r.unknown_attempts) > 0)
        flags.push(`${n(r.unknown_attempts)} tentative(s) UNKNOWN à traiter`);
      if (n(r.pending_over_1h) > 0)
        flags.push(`${n(r.pending_over_1h)} tentative(s) en attente depuis > 1 h`);
      if (reconciliation === 'DISCREPANCIES') flags.push('réconciliation avec écarts');
      if (reconciliation === 'ERROR') flags.push('réconciliation en erreur');
      if ((r.ledger_mismatches ?? 0) > 0)
        flags.push(`${n(r.ledger_mismatches)} écart(s) d'intégrité du grand-livre`);
      if (smsRatio !== null && smsRatio >= 80) flags.push(`quota SMS à ${smsRatio} %`);
      if (n(r.imports_failed) > 0) flags.push(`${n(r.imports_failed)} import(s) en échec`);
      if (n(r.notif_failed) > 0) flags.push(`${n(r.notif_failed)} notification(s) en échec`);
      if (n(r.sheets_missing) > 0) flags.push(`${n(r.sheets_missing)} appel(s) non réalisé(s)`);
      return {
        tenantId: r.id,
        code: r.code,
        name: r.name,
        inHypercare: r.hypercare_until !== null && new Date(r.hypercare_until).getTime() > now,
        openAlerts: n(r.open_alerts),
        unknownAttempts: n(r.unknown_attempts),
        pendingOver1h: n(r.pending_over_1h),
        reconciliation,
        ledgerMismatches: r.ledger_mismatches === null ? null : n(r.ledger_mismatches),
        smsRatio,
        importsFailed: n(r.imports_failed),
        notificationsFailed: n(r.notif_failed),
        sheetsMissing: n(r.sheets_missing),
        guardiansActivatedDelta: n(r.activated_delta),
        flags,
      };
    });
  }

  private async summarize(tx: Db, tenants: TenantRow[]): Promise<DailyReview['summary']> {
    const [alerts, avail] = await Promise.all([
      tx.execute<{ open: number; critical: number }>(
        sql`select count(*)::int as open, count(*) filter (where severity = 'CRITICAL')::int as critical from platform_alerts where resolved_at is null`,
      ),
      tx.execute<{ checks: number; failures: number }>(
        sql`select count(*)::int as checks, count(*) filter (where not ok)::int as failures from availability_checks where checked_at >= now() - interval '24 hours'`,
      ),
    ]);
    const a = alerts.rows[0]!;
    const v = avail.rows[0]!;
    const checks = n(v.checks);
    const sum = (f: (t: TenantRow) => number) => tenants.reduce((s, t) => s + f(t), 0);
    const flagged = tenants.filter((t) => t.flags.length > 0).length;
    const summary = {
      availability24h:
        checks > 0 ? Math.round(((checks - n(v.failures)) * 10000) / checks) / 100 : null,
      availabilityChecks: checks,
      openAlerts: n(a.open),
      criticalAlerts: n(a.critical),
      unknownAttempts: sum((t) => t.unknownAttempts),
      reconciliationGaps: tenants.filter((t) => t.reconciliation === 'DISCREPANCIES').length,
      ledgerMismatches: sum((t) => t.ledgerMismatches ?? 0),
      tenantsOverSmsBudget: tenants.filter((t) => (t.smsRatio ?? 0) >= 80).length,
      importsFailed: sum((t) => t.importsFailed),
      notificationsFailed: sum((t) => t.notificationsFailed),
      tenantsInHypercare: tenants.filter((t) => t.inHypercare).length,
      tenantsFlagged: flagged,
      healthy: false,
    };
    summary.healthy =
      summary.openAlerts === 0 &&
      summary.unknownAttempts === 0 &&
      summary.reconciliationGaps === 0 &&
      summary.ledgerMismatches === 0 &&
      summary.importsFailed === 0 &&
      summary.notificationsFailed === 0 &&
      flagged === 0 &&
      (summary.availability24h === null || summary.availability24h >= 99.5);
    return summary;
  }

  private async notify(tx: Db, day: string, summary: DailyReview['summary'], tenants: TenantRow[]) {
    const admins = await tx.execute<{ email: string }>(
      sql`select distinct u.email from users u join memberships m on m.user_id = u.id
          where m.kind = 'PLATFORM' and m.status = 'ACTIVE' and u.status = 'ACTIVE' and u.email is not null`,
    );
    const subject = summary.healthy
      ? `[Polaris] Revue du ${day} : journée saine`
      : `[Polaris] Revue du ${day} : ${summary.tenantsFlagged} établissement(s) à regarder`;
    const lines = [
      `Disponibilité 24 h : ${summary.availability24h ?? '—'} % (${summary.availabilityChecks} sondes)`,
      `Alertes ouvertes : ${summary.openAlerts} (critiques : ${summary.criticalAlerts})`,
      `Tentatives UNKNOWN : ${summary.unknownAttempts} · réconciliations avec écarts : ${summary.reconciliationGaps} · écarts grand-livre : ${summary.ledgerMismatches}`,
      `Imports en échec : ${summary.importsFailed} · notifications en échec : ${summary.notificationsFailed} · établissements ≥ 80 % du quota SMS : ${summary.tenantsOverSmsBudget}`,
      `Établissements en hypercare : ${summary.tenantsInHypercare}`,
      '',
      ...tenants
        .filter((t) => t.flags.length > 0 || t.inHypercare)
        .map(
          (t) =>
            `- ${t.name}${t.inHypercare ? ' (hypercare)' : ''} : ${t.flags.length ? t.flags.join(', ') : 'rien à signaler'}${t.guardiansActivatedDelta ? ` ; +${t.guardiansActivatedDelta} parent(s) activé(s)` : ''}`,
        ),
      '',
      `Acquitter la revue : ${this.env.WEB_ORIGIN}/platform (onglet Hypercare)`,
      'Runbook : docs/runbooks/hypercare.md',
    ];
    for (const a of admins.rows) {
      try {
        await this.email.send({
          to: a.email,
          subject,
          text: lines.join('\n'),
          reference: `hypercare-${day}`,
        });
      } catch (e) {
        this.logger.error({ msg: 'hypercare e-mail failed', err: (e as Error).message });
      }
    }
  }

  private toDto(row: {
    day: string;
    generatedAt: Date;
    summary: Record<string, unknown>;
    tenants: unknown[];
    reviewedAt: Date | null;
    reviewedBy: string | null;
    notes: string | null;
  }): DailyReview {
    return {
      day: row.day,
      generatedAt: row.generatedAt.toISOString(),
      summary: row.summary as DailyReview['summary'],
      tenants: row.tenants as TenantRow[],
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewedBy: row.reviewedBy,
      notes: row.notes,
    };
  }
}
