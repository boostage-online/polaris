import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import {
  REPORTS_QUEUE,
  ReportRefreshService,
  TenantExportService,
  type ReportsJobData,
} from '../modules/reporting';
import { RedisService } from '../modules/shared';

/** Consomme la file `reports` : exports complets d'établissement et rafraîchissements complets à la demande. */
@Injectable()
export class ReportsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportsProcessor.name);
  private worker!: Worker<ReportsJobData>;

  constructor(
    private readonly redis: RedisService,
    private readonly exports: TenantExportService,
    private readonly refresh: ReportRefreshService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ReportsJobData>(REPORTS_QUEUE, (job) => this.process(job), {
      connection: this.redis.duplicate(),
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.error({ msg: 'reports job failed', kind: job?.data.kind, err: err.message }),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  async process(job: Job<ReportsJobData>) {
    const d = job.data;
    if (d.kind === 'tenant-export') {
      const r = await this.exports.build(d.tenantId, d.exportId);
      return r?.status ?? 'MISSING';
    }
    const r = d.full
      ? await this.refresh.refreshAll(d.tenantId)
      : await this.refresh.refresh(d.tenantId);
    return `${r.attendanceRows}/${r.financeRows}`;
  }
}
