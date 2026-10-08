import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiDoc, Public } from '../common/decorators';
import { ENV, type Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { migrateStatus } from '../database/migrate';
import { MetricsService, RedisService } from '../modules/shared';
import { raw } from '../common/interceptors/envelope.interceptor';

@Controller()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('health/live')
  @Public()
  @ApiDoc({ summary: 'Le processus répond', tags: ['health'] })
  live() {
    return raw({ status: 'ok', uptime: Math.round(process.uptime()) });
  }

  @Get('health/ready')
  @Public()
  @ApiDoc({ summary: 'Dépendances joignables et migrations à jour', tags: ['health'] })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [db, redis, migrations] = await Promise.all([
      this.db.ping(),
      this.redis.ping(),
      this.migrationsUpToDate(),
    ]);
    const ok = db && redis && migrations;
    res.status(ok ? 200 : 503);
    return raw({ status: ok ? 'ok' : 'degraded', checks: { database: db, redis, migrations } });
  }

  @Get('metrics')
  @Public()
  @ApiDoc({ summary: 'Métriques Prometheus', tags: ['health'] })
  async prometheus(@Res({ passthrough: true }) res: Response) {
    res.type(this.metrics.registry.contentType);
    return raw(await this.metrics.registry.metrics());
  }

  private async migrationsUpToDate(): Promise<boolean> {
    try {
      const status = await migrateStatus({ connectionString: this.env.DATABASE_URL_PLATFORM });
      return status.every((s) => s.appliedAt !== null);
    } catch {
      return false;
    }
  }
}
