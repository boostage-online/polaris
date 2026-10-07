import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic';
import { AuditModule } from '../audit';
import { DashboardsService } from './application/dashboards.service';
import { PlatformOverviewService } from './application/platform-overview.service';
import { ReportRefreshService } from './application/refresh.service';
import { ReportsQueue } from './application/reports.queue';
import { ReportsService } from './application/reports.service';
import { ScheduledReportsService } from './application/scheduled-reports.service';
import { TenantExportService } from './application/tenant-export.service';
import { TraceService } from './application/trace.service';
import {
  PlatformOverviewController,
  ReportingDashboardsController,
  ReportsController,
  ScheduledReportsController,
  TenantExportsController,
  TraceController,
} from './controllers/reporting.controller';

@Module({
  imports: [AuditModule, AcademicModule],
  controllers: [
    ReportsController,
    ReportingDashboardsController,
    TraceController,
    ScheduledReportsController,
    TenantExportsController,
    PlatformOverviewController,
  ],
  providers: [
    ReportRefreshService,
    ReportsService,
    DashboardsService,
    TraceService,
    ScheduledReportsService,
    TenantExportService,
    PlatformOverviewService,
    ReportsQueue,
  ],
  exports: [
    ReportRefreshService,
    ReportsService,
    ScheduledReportsService,
    TenantExportService,
    ReportsQueue,
  ],
})
export class ReportingModule {}
