import { Injectable } from '@nestjs/common';
import { ErrorCodes } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { MetricsService, RedisService } from '../../shared';
import { LockoutPolicy } from '../domain/policies';

/** Anti-brute-force par compte et par IP (Redis). */
@Injectable()
export class LockoutService {
  constructor(
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  private acctKey(identifier: string) {
    return `bf:acct:${identifier.toLowerCase()}`;
  }
  private ipKey(ip: string | null) {
    return `bf:ip:${ip ?? 'unknown'}`;
  }

  async assertNotLocked(identifier: string, ip: string | null) {
    try {
      const [acct, ipCount, lockedUntil] = await Promise.all([
        this.redis.client.get(this.acctKey(identifier)),
        this.redis.client.get(this.ipKey(ip)),
        this.redis.client.pttl(`${this.acctKey(identifier)}:lock`),
      ]);
      if (lockedUntil > 0) {
        throw new AppError(
          423,
          ErrorCodes.ACCOUNT_LOCKED,
          'Compte temporairement verrouillé',
          undefined,
          {
            retryAfterSeconds: Math.ceil(lockedUntil / 1000),
          },
        );
      }
      if (Number(ipCount ?? 0) >= LockoutPolicy.maxIpFailuresPerHour)
        throw AppError.rateLimited(3600);
      void acct;
    } catch (e) {
      if (e instanceof AppError) throw e; // Redis indisponible : fail-open
    }
  }

  async recordFailure(identifier: string, ip: string | null, reason: string) {
    this.metrics.authFailures.inc({ reason });
    try {
      const failures = await this.redis.client.incr(this.acctKey(identifier));
      if (failures === 1) await this.redis.client.expire(this.acctKey(identifier), 900);
      const delay = LockoutPolicy.delaySeconds(failures);
      if (delay > 0)
        await this.redis.client.set(`${this.acctKey(identifier)}:lock`, '1', 'EX', delay);
      const ipCount = await this.redis.client.incr(this.ipKey(ip));
      if (ipCount === 1) await this.redis.client.expire(this.ipKey(ip), 3600);
    } catch {
      /* fail-open */
    }
  }

  async reset(identifier: string) {
    try {
      await this.redis.client.del(this.acctKey(identifier), `${this.acctKey(identifier)}:lock`);
    } catch {
      /* ignore */
    }
  }
}
