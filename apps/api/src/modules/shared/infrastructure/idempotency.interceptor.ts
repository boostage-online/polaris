import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { from, lastValueFrom, of, tap } from 'rxjs';
import { sql } from 'drizzle-orm';
import { ErrorCodes } from '@polaris/contracts';
import { META_IDEMPOTENCY_REQUIRED } from '../../../common/decorators';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';

const TTL_HOURS = 24;

/**
 * Idempotency-Key (ADR-0009) : même clé + même corps → même réponse, sans ré-exécution.
 * Même clé + corps différent → 422. Requête concurrente avec la même clé → 409.
 * Portée : (tenant ou 'platform') + utilisateur. Stockage : table idempotency_keys (24 h), pool platform
 * (la table est hors RLS et doit être lue avant que la transaction tenant n'existe).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || !['POST', 'PATCH', 'PUT'].includes(req.method)) {
      if (
        this.reflector.getAllAndOverride<boolean>(META_IDEMPOTENCY_REQUIRED, [
          context.getHandler(),
          context.getClass(),
        ])
      )
        throw AppError.validation([
          {
            path: 'Idempotency-Key',
            message: 'En-tête Idempotency-Key requis pour cette opération',
          },
        ]);
      return next.handle();
    }
    if (key.length > 128)
      throw AppError.validation([{ path: 'Idempotency-Key', message: 'Clé trop longue' }]);

    const ctx = RequestContextStore.require();
    const scope = `${ctx.tenantId ?? 'platform'}:${ctx.actor?.userId ?? 'anon'}:${req.method}:${req.path}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? null))
      .digest('hex');

    const existing = await this.db.withPlatformTx('idempotency lookup', async (tx) => {
      const inserted = await tx.execute(sql`
        insert into idempotency_keys (scope, key, request_hash, status, expires_at)
        values (${scope}, ${key}, ${requestHash}, 'IN_PROGRESS', now() + (${TTL_HOURS} || ' hours')::interval)
        on conflict (scope, key) do nothing
        returning scope`);
      if (inserted.rowCount && inserted.rowCount > 0) return null;
      const rows = await tx.execute<{
        request_hash: string;
        status: string;
        response_status: number | null;
        response_body: unknown;
      }>(
        sql`select request_hash, status, response_status, response_body from idempotency_keys where scope = ${scope} and key = ${key}`,
      );
      return rows.rows[0] ?? null;
    });

    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new AppError(
          422,
          ErrorCodes.IDEMPOTENCY_KEY_REUSED,
          'Idempotency-Key déjà utilisée avec un autre corps',
        );
      }
      if (existing.status === 'IN_PROGRESS') {
        throw AppError.conflict('Requête identique en cours de traitement', ErrorCodes.CONFLICT);
      }
      res.status(existing.response_status ?? 200);
      res.setHeader('Idempotent-Replayed', 'true');
      return of(existing.response_body);
    }

    try {
      const body: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.store(scope, key, res.statusCode, body);
      return of(body);
    } catch (e) {
      // On libère la clé pour qu'un nouvel essai soit possible après une erreur.
      await this.db.withPlatformTx('idempotency release', (tx) =>
        tx.execute(sql`delete from idempotency_keys where scope = ${scope} and key = ${key}`),
      );
      throw e;
    }
  }

  private store(scope: string, key: string, status: number, body: unknown) {
    return lastValueFrom(
      from(
        this.db.withPlatformTx('idempotency store', (tx) =>
          tx.execute(sql`
            update idempotency_keys set status = 'COMPLETED', response_status = ${status},
              response_body = ${JSON.stringify(body ?? null)}::jsonb
            where scope = ${scope} and key = ${key}`),
        ),
      ).pipe(tap(() => undefined)),
    );
  }
}
