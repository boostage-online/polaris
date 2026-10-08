import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { META_NO_TX, META_PUBLIC, META_SCOPE, type RouteScope } from '../../../common/decorators';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';

/**
 * Une requête = une transaction (sauf @NoTransaction ou route publique).
 *  - scope tenant   → withTenantTx(tenantId) : RLS active
 *  - scope platform → withPlatformTx : BYPASSRLS
 *  - scope identity → withIdentityTx : rôle app sans tenant (tables globales uniquement)
 * Toute exception annule la transaction : audit et outbox écrits dans la même transaction
 * disparaissent avec l'état métier (ADR-0003).
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(META_PUBLIC, targets);
    const noTx = this.reflector.getAllAndOverride<boolean>(META_NO_TX, targets);
    if (isPublic || noTx) return next.handle();

    const scope =
      this.reflector.getAllAndOverride<RouteScope | undefined>(META_SCOPE, targets) ?? 'tenant';
    const run = () => lastValueFrom(next.handle(), { defaultValue: undefined });
    const ctx = RequestContextStore.require();

    if (scope === 'platform')
      return from(this.db.withPlatformTx(`http ${context.getHandler().name}`, run));
    if (scope === 'identity') return from(this.db.withIdentityTx(run));
    if (!ctx.tenantId)
      throw new Error('TransactionInterceptor : tenantId absent sur une route tenant');
    return from(this.db.withTenantTx(ctx.tenantId, run));
  }
}
