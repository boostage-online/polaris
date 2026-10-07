import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { META_RATE_LIMIT, type RateLimitOptions } from '../../../common/decorators';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { RequestContextStore } from '../../../database/request-context';
import { RedisService } from './redis.service';

/**
 * Rate limiting fenêtre fixe dans Redis (INCR + EXPIRE). Suffisant pour protéger auth/OTP/paiements ;
 * une fenêtre glissante (Lua) remplacera ce guard si les métriques montrent des rafales en bord de fenêtre.
 * Si Redis est indisponible, on laisse passer (fail-open) et on compte l'incident : la disponibilité
 * de l'appel prime sur la protection anti-abus, qui est aussi assurée par le verrouillage de compte.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly global: RateLimitOptions;

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    @Inject(ENV) env: Env,
  ) {
    this.global = {
      points: env.RATE_LIMIT_GLOBAL_PER_MINUTE,
      duration: 60,
      keyBy: 'ip',
      name: 'global',
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const opts =
      this.reflector.getAllAndOverride<RateLimitOptions | undefined>(META_RATE_LIMIT, [
        context.getHandler(),
        context.getClass(),
      ]) ?? this.global;
    const req = context.switchToHttp().getRequest<Request>();
    const key = this.keyFor(opts, req);
    if (!key) return true;
    const redisKey = `rl:${opts.name ?? 'route'}:${key}`;
    try {
      const count = await this.redis.client.incr(redisKey);
      if (count === 1) await this.redis.client.expire(redisKey, opts.duration);
      if (count > opts.points) {
        const ttl = await this.redis.client.ttl(redisKey);
        throw AppError.rateLimited(Math.max(ttl, 1));
      }
      return true;
    } catch (e) {
      if (e instanceof AppError) throw e;
      return true; // fail-open
    }
  }

  private keyFor(opts: RateLimitOptions, req: Request): string | null {
    const ctx = RequestContextStore.get();
    switch (opts.keyBy ?? 'ip') {
      case 'ip':
        return req.ip ?? 'unknown';
      case 'user':
        return ctx?.actor?.userId ?? req.ip ?? 'anon';
      case 'tenant':
        return ctx?.tenantId ?? ctx?.actor?.userId ?? req.ip ?? 'anon';
      case 'identifier': {
        const body = req.body as Record<string, unknown> | undefined;
        const id = body?.['identifier'] ?? body?.['phone'] ?? body?.['email'];
        return typeof id === 'string'
          ? `${req.ip ?? 'ip'}:${id.toLowerCase()}`
          : (req.ip ?? 'unknown');
      }
    }
  }
}
