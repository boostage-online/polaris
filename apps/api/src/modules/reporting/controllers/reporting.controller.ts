import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  CreateScheduledReportSchema,
  DirectionDashboardSchema,
  FinanceChannelsSchema,
  NotificationTraceSchema,
  PedagogyDashboardSchema,
  PlatformOverviewSchema,
  ReportDefinitionSchema,
  ReportKeySchema,
  ReportPeriodSchema,
  ReportResultSchema,
  ScheduledReportSchema,
  SheetTraceSchema,
  TenantExportSchema,
  UpdateScheduledReportSchema,
} from '@polaris/contracts';
import {
  ApiDoc,
  NoTransaction,
  RequirePermission,
  Scope,
  ZodBody,
  ZodParams,
  ZodQuery,
} from '../../../common/decorators';
import { AppError } from '../../../common/errors/app-error';
import { raw } from '../../../common/interceptors/envelope.interceptor';
import { RequestContextStore } from '../../../database/request-context';
import { DashboardsService } from '../application/dashboards.service';
import { PlatformOverviewService } from '../application/platform-overview.service';
import { ReportRefreshService } from '../application/refresh.service';
import { ReportsQueue } from '../application/reports.queue';
import { ReportsService } from '../application/reports.service';
import { ScheduledReportsService } from '../application/scheduled-reports.service';
import { TenantExportService } from '../application/tenant-export.service';
import { TraceService } from '../application/trace.service';

const T = ['reporting'];
const Id = z.object({ id: z.string().uuid() });
const KeyP = z.object({ key: ReportKeySchema });
const RangeQ = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly refresh: ReportRefreshService,
    private readonly queue: ReportsQueue,
  ) {}

  @Get()
  @RequirePermission('VIEW_REPORTS', 'VIEW_ATTENDANCE_REPORTS', 'VIEW_FINANCIAL_REPORTS')
  @ApiDoc({
    summary: 'Catalogue des rapports accessibles (8 rapports MVP)',
    tags: T,
    response: z.array(ReportDefinitionSchema),
  })
  catalog() {
    const perms = RequestContextStore.require().actor?.permissions ?? [];
    return this.reports.catalog(perms);
  }

  @Post('refresh')
  @HttpCode(200)
  @NoTransaction()
  @RequirePermission('VIEW_REPORTS', 'VIEW_FINANCIAL_REPORTS', 'VIEW_ATTENDANCE_REPORTS')
  @ApiDoc({
    summary: 'Rafraîchir les agrégats (derniers jours ; `full` = depuis le début de l’année)',
    tags: T,
    body: z.object({ full: z.boolean().optional() }),
  })
  async refreshNow(@ZodBody(z.object({ full: z.boolean().optional() })) b: { full?: boolean }) {
    const tenantId = RequestContextStore.require().tenantId!;
    if (b.full) {
      await this.queue.enqueue({ kind: 'refresh', tenantId, full: true });
      return { queued: true };
    }
    return this.refresh.refresh(tenantId);
  }

  /** Déclaré avant `:key` : Express fait correspondre `:key` à « clé.csv » sinon. */
  @Get(':key.csv')
  @RequirePermission('VIEW_REPORTS', 'VIEW_ATTENDANCE_REPORTS', 'VIEW_FINANCIAL_REPORTS')
  @ApiDoc({
    summary: 'Exporter un rapport en CSV',
    tags: T,
    params: KeyP,
    query: ReportPeriodSchema,
  })
  async csv(
    @ZodParams(KeyP) p: z.infer<typeof KeyP>,
    @ZodQuery(ReportPeriodSchema) q: z.infer<typeof ReportPeriodSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertAllowed(p.key);
    const out = await this.reports.csv(p.key, q);
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    return raw(out.content);
  }

  @Get(':key')
  @RequirePermission('VIEW_REPORTS', 'VIEW_ATTENDANCE_REPORTS', 'VIEW_FINANCIAL_REPORTS')
  @ApiDoc({
    summary: 'Exécuter un rapport (aperçu JSON, 5 000 lignes max.)',
    tags: T,
    params: KeyP,
    query: ReportPeriodSchema,
    response: ReportResultSchema,
  })
  run(
    @ZodParams(KeyP) p: z.infer<typeof KeyP>,
    @ZodQuery(ReportPeriodSchema) q: z.infer<typeof ReportPeriodSchema>,
  ) {
    this.assertAllowed(p.key);
    return this.reports.run(p.key, q);
  }

  /** La permission du rapport prime sur la permission d'entrée du contrôleur (un pédagogue ne voit pas la finance). */
  private assertAllowed(key: z.infer<typeof ReportKeySchema>) {
    const perms = RequestContextStore.require().actor?.permissions ?? [];
    const def = this.reports.definition(key);
    if (!perms.includes(def.permission)) throw AppError.forbidden();
  }
}

@Controller('dashboards')
export class ReportingDashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('direction')
  @RequirePermission('VIEW_REPORTS')
  @ApiDoc({
    summary: 'Tableau de bord de direction : KPI synthétiques et tendances',
    tags: T,
    response: DirectionDashboardSchema,
  })
  direction() {
    return this.dashboards.direction();
  }

  @Get('pedagogy')
  @RequirePermission('VIEW_ATTENDANCE_REPORTS')
  @ApiDoc({
    summary: 'Tableau de bord pédagogique : taux par classe, élèves à risque, appels non réalisés',
    tags: T,
    query: RangeQ,
    response: PedagogyDashboardSchema,
  })
  pedagogy(@ZodQuery(RangeQ) q: z.infer<typeof RangeQ>) {
    return this.dashboards.pedagogy(q);
  }

  @Get('finance/channels')
  @RequirePermission('VIEW_FINANCIAL_REPORTS')
  @ApiDoc({
    summary: 'Encaissements par canal et par provider, tentatives en ligne',
    tags: T,
    query: RangeQ,
    response: FinanceChannelsSchema,
  })
  channels(@ZodQuery(RangeQ) q: z.infer<typeof RangeQ>) {
    return this.dashboards.financeChannels(q);
  }
}

@Controller('trace')
export class TraceController {
  constructor(private readonly trace: TraceService) {}

  @Get('sheets/:id')
  @RequirePermission('VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS', 'VIEW_AUDIT_LOG')
  @ApiDoc({
    summary:
      "Traçabilité d'une feuille d'appel : séance, soumission, corrections, notifications, audit",
    tags: T,
    params: Id,
    response: SheetTraceSchema,
  })
  sheet(@ZodParams(Id) p: z.infer<typeof Id>) {
    return this.trace.sheet(p.id);
  }

  @Get('notifications/:id')
  @RequirePermission('MANAGE_TENANT_SETTINGS', 'VIEW_AUDIT_LOG')
  @ApiDoc({
    summary: "Traçabilité d'une notification : événement source, rendu, envois, préférences",
    tags: T,
    params: Id,
    response: NotificationTraceSchema,
  })
  notification(@ZodParams(Id) p: z.infer<typeof Id>) {
    return this.trace.notification(p.id);
  }
}

@Controller('scheduled-reports')
export class ScheduledReportsController {
  constructor(private readonly scheduled: ScheduledReportsService) {}

  @Get()
  @RequirePermission('VIEW_REPORTS')
  @ApiDoc({
    summary: 'Rapports planifiés par e-mail',
    tags: T,
    response: z.array(ScheduledReportSchema),
  })
  list() {
    return this.scheduled.list();
  }

  @Post()
  @RequirePermission('VIEW_REPORTS')
  @ApiDoc({
    summary: 'Planifier un rapport (hebdomadaire ou mensuel) vers des destinataires',
    tags: T,
    body: CreateScheduledReportSchema,
    response: ScheduledReportSchema,
    status: 201,
  })
  create(@ZodBody(CreateScheduledReportSchema) b: z.infer<typeof CreateScheduledReportSchema>) {
    return this.scheduled.create(b);
  }

  @Patch(':id')
  @RequirePermission('VIEW_REPORTS')
  @ApiDoc({
    summary: 'Modifier ou suspendre un rapport planifié',
    tags: T,
    params: Id,
    body: UpdateScheduledReportSchema,
    response: ScheduledReportSchema,
  })
  update(
    @ZodParams(Id) p: z.infer<typeof Id>,
    @ZodBody(UpdateScheduledReportSchema) b: z.infer<typeof UpdateScheduledReportSchema>,
  ) {
    return this.scheduled.update(p.id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('VIEW_REPORTS')
  @ApiDoc({ summary: 'Supprimer un rapport planifié', tags: T, params: Id })
  remove(@ZodParams(Id) p: z.infer<typeof Id>) {
    return this.scheduled.remove(p.id);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermission('VIEW_REPORTS')
  @ApiDoc({ summary: 'Envoyer maintenant', tags: T, params: Id })
  send(@ZodParams(Id) p: z.infer<typeof Id>) {
    return this.scheduled.sendNow(p.id);
  }
}

@Controller('tenant-exports')
export class TenantExportsController {
  constructor(private readonly exports: TenantExportService) {}

  @Get()
  @RequirePermission('MANAGE_TENANT_SETTINGS')
  @ApiDoc({
    summary: 'Exports complets de l’établissement (20 derniers)',
    tags: T,
    response: z.array(TenantExportSchema),
  })
  list() {
    return this.exports.list();
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('MANAGE_TENANT_SETTINGS')
  @ApiDoc({
    summary: 'Demander un export complet (archive ZIP de CSV, construite par le worker)',
    tags: T,
    response: TenantExportSchema,
  })
  request() {
    return this.exports.request();
  }

  @Get(':id')
  @RequirePermission('MANAGE_TENANT_SETTINGS')
  @ApiDoc({ summary: 'État d’un export', tags: T, params: Id, response: TenantExportSchema })
  get(@ZodParams(Id) p: z.infer<typeof Id>) {
    return this.exports.get(p.id);
  }

  @Get(':id/download')
  @RequirePermission('MANAGE_TENANT_SETTINGS')
  @ApiDoc({ summary: 'Télécharger l’archive', tags: T, params: Id })
  async download(@ZodParams(Id) p: z.infer<typeof Id>, @Res({ passthrough: true }) res: Response) {
    const f = await this.exports.file(p.id);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    return raw(new StreamableFile(f.file, { type: 'application/zip' }));
  }
}

@Controller('platform/overview')
@Scope('platform')
export class PlatformOverviewController {
  constructor(private readonly overview: PlatformOverviewService) {}

  @Get()
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary:
      'Vue Super Admin : parc, volumétrie, paiements 24 h, santé, erreurs, par établissement',
    tags: ['platform'],
    response: PlatformOverviewSchema,
  })
  get() {
    return this.overview.overview();
  }
}
