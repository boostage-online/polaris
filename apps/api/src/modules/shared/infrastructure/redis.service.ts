import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../../../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      enableOfflineQueue: true,
    });
    this.client.on('error', (err) => this.logger.warn({ msg: 'redis error', err: err.message }));
  }

  /** Nouveau client (BullMQ exige des connexions dédiées). */
  duplicate(): Redis {
    return this.client.duplicate({ maxRetriesPerRequest: null });
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
