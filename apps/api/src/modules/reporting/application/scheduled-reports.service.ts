import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  CreateScheduledReportSchema,
  ReportKey,
  ScheduledReport,
  UpdateScheduledReportSchema,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { scheduledReports, tenants } from '../../../database/schema';
import { addDays, localDateParts } from '../../academic';
import { AuditService } from '../../audit';
import { EMAIL_GATEWAY, type EmailGateway } from '../../shared';
import { ReportsService } from './reports.service';

/**
 * Rapports planifiés par e-mail : hebdomadaires (jour ISO) ou mensuels (jour du mois), envoyés par le worker
 * à 06:30 avec le CSV en pièce jointe sur la période écoulée (7 jours ou le mois précédent). Idempotent par
 * jour : `last_sent_at` empêche un second envoi le même jour.
 */
@Injectable()
export class ScheduledReportsService {
  private readonly logger = new Logger(ScheduledReportsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  async list(): Promise<ScheduledReport[]> {
    const rows = await this.db
      .current()
      .select()
      .from(scheduledReports)
      .where(eq(scheduledReports.tenantId, this.tenantId))
      .orderBy(desc(scheduledReports.createdAt));
    return rows.map(this.dto);
  }

  async create(input: z.infer<typeof CreateScheduledReportSchema>) {
    const tx = this.db.current();
    this.reports.definition(input.reportKey);
    if (input.cadence === 'WEEKLY' && input.dayOfPeriod > 7)
      throw AppError.validation([
        { path: 'dayOfPeriod', message: 'Jour de semaine entre 1 (lundi) et 7' },
      ]);
    const id = randomUUID();
    await tx.insert(scheduledReports).values({
      id,
      tenantId: this.tenantId,
      reportKey: input.reportKey,
      cadence: input.cadence,
      dayOfPeriod: input.dayOfPeriod,
      recipients: input.recipients,
      filters: input.filters,
      enabled: true,
      lastSentAt: null,
      lastError: null,
      createdBy: RequestContextStore.require().actor?.userId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await this.audit.record({
      action: 'scheduled_report.created',
      entityType: 'ScheduledReport',
      entityId: id,
      after: input,
    });
    return this.dto(
      (await tx.query.scheduledReports.findFirst({ where: eq(scheduledReports.id, id) }))!,
    );
  }

  async update(id: string, patch: z.infer<typeof UpdateScheduledReportSchema>) {
    const tx = this.db.current();
    const row = await tx.query.scheduledReports.findFirst({ where: eq(scheduledReports.id, id) });
    if (!row) throw AppError.notFound('Rapport planifié');
    await tx
      .update(scheduledReports)
      .set({
        reportKey: patch.reportKey,
        cadence: patch.cadence,
        dayOfPeriod: patch.dayOfPeriod,
        recipients: patch.recipients,
        filters: patch.filters,
        enabled: patch.enabled,
      })
      .where(eq(scheduledReports.id, id));
    await this.audit.record({
      action: 'scheduled_report.updated',
      entityType: 'ScheduledReport',
      entityId: id,
      after: patch,
    });
    return this.dto(
      (await tx.query.scheduledReports.findFirst({ where: eq(scheduledReports.id, id) }))!,
    );
  }

  async remove(id: string) {
    const tx = this.db.current();
    const res = await tx
      .delete(scheduledReports)
      .where(eq(scheduledReports.id, id))
      .returning({ id: scheduledReports.id });
    if (res.length === 0) throw AppError.notFound('Rapport planifié');
    await this.audit.record({
      action: 'scheduled_report.deleted',
      entityType: 'ScheduledReport',
      entityId: id,
    });
  }

  /** Envoi immédiat (bouton « Envoyer maintenant ») : période par défaut du rapport. */
  async sendNow(id: string) {
    const tx = this.db.current();
    const row = await tx.query.scheduledReports.findFirst({ where: eq(scheduledReports.id, id) });
    if (!row) throw AppError.notFound('Rapport planifié');
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
    const today = localDateParts(new Date(), tenant.timezone).date;
    const sent = await this.deliver(tenant.name, row, this.periodFor(row, today), new Date());
    return { sent };
  }

  /** Worker (quotidien 06:30) : envoie les rapports dus aujourd'hui pour le tenant. */
  async runDue(tenantId: string, now = new Date()) {
    return this.db.withTenantTx(tenantId, async (tx) => {
      const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
      const { date: today, isoWeekday } = localDateParts(now, tenant.timezone);
      const dayOfMonth = Number(today.slice(8, 10));
      const rows = await tx
        .select()
        .from(scheduledReports)
        .where(and(eq(scheduledReports.tenantId, tenantId), eq(scheduledReports.enabled, true)));
      let sent = 0;
      for (const r of rows) {
        const due =
          r.cadence === 'WEEKLY' ? r.dayOfPeriod === isoWeekday : r.dayOfPeriod === dayOfMonth;
        if (!due) continue;
        if (r.lastSentAt && localDateParts(r.lastSentAt, tenant.timezone).date === today) continue;
        sent += await this.deliver(tenant.name, r, this.periodFor(r, today), now);
      }
      return { sent };
    });
  }

  private periodFor(r: typeof scheduledReports.$inferSelect, today: string) {
    if (r.cadence === 'WEEKLY') return { from: addDays(today, -7), to: addDays(today, -1) };
    const firstOfMonth = `${today.slice(0, 7)}-01`;
    const prevLast = addDays(firstOfMonth, -1);
    return { from: `${prevLast.slice(0, 7)}-01`, to: prevLast };
  }

  private async deliver(
    tenantName: string,
    r: typeof scheduledReports.$inferSelect,
    period: { from: string; to: string },
    now: Date,
  ) {
    const tx = this.db.current();
    try {
      const groupId = (r.filters as { groupId?: string }).groupId;
      const out = await this.reports.runIn(tx, r.reportKey as ReportKey, { ...period, groupId });
      const filename = `${r.reportKey}_${period.from}_${period.to}.csv`;
      for (const to of r.recipients) {
        await this.email.send({
          to,
          subject: `[${tenantName}] ${out.def.title} — ${period.from} → ${period.to}`,
          text: `Bonjour,\n\nVeuillez trouver en pièce jointe le rapport « ${out.def.title} » (${out.rows.length} ligne(s)) pour la période du ${period.from} au ${period.to}.\n\n${out.def.description}\n\nPolaris — rapport planifié ${r.cadence === 'WEEKLY' ? 'hebdomadaire' : 'mensuel'}.`,
          reference: `scheduled-report:${r.id}:${period.to}`,
          attachments: [
            {
              filename,
              contentType: 'text/csv; charset=utf-8',
              content: Buffer.from(out.csv, 'utf8').toString('base64'),
            },
          ],
        });
      }
      await tx
        .update(scheduledReports)
        .set({ lastSentAt: now, lastError: null })
        .where(eq(scheduledReports.id, r.id));
      return r.recipients.length;
    } catch (e) {
      await tx
        .update(scheduledReports)
        .set({ lastError: (e as Error).message })
        .where(eq(scheduledReports.id, r.id));
      this.logger.error({ msg: 'scheduled report failed', id: r.id, err: (e as Error).message });
      return 0;
    }
  }

  private dto = (r: typeof scheduledReports.$inferSelect): ScheduledReport => ({
    id: r.id,
    reportKey: r.reportKey as ScheduledReport['reportKey'],
    cadence: r.cadence,
    dayOfPeriod: r.dayOfPeriod,
    recipients: r.recipients,
    filters: r.filters as ScheduledReport['filters'],
    enabled: r.enabled,
    lastSentAt: r.lastSentAt?.toISOString() ?? null,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
  });
}
