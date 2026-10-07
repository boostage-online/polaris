import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { ErrorCodes } from '@polaris/contracts';
import { META_PUBLIC } from '../../../common/decorators';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { users } from '../../../database/schema';
import { TokenService } from '../application/token.service';
import { PermissionCache } from './permission.cache';

/**
 * Question 0 : qui es-tu ? Vérifie le JWT, le token_version (déconnexion globale) et pose `ctx.actor`.
 * La question « es-tu dans le bon tenant ? » est posée par ScopeGuard, « as-tu le droit ? » par PermissionGuard.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly permCache: PermissionCache,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(META_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw AppError.unauthenticated();
    const claims = await this.tokens.verifyAccess(header.slice(7));

    const cachedTv = await this.permCache.getTokenVersion(claims.sub);
    const tv: number = cachedTv ?? (await this.loadTokenVersion(claims.sub));
    if (cachedTv === null) await this.permCache.setTokenVersion(claims.sub, tv);
    if (tv !== claims.tv)
      throw AppError.unauthenticated('Session révoquée', ErrorCodes.TOKEN_REVOKED);

    const ctx = RequestContextStore.require();
    ctx.actor = {
      userId: claims.sub,
      membershipId: claims.mid,
      tenantId: claims.tid,
      kind: claims.kind,
      permissionsVersion: claims.pv,
      tokenVersion: claims.tv,
    };
    return true;
  }

  /** token_version en base (cache Redis absent ou expiré) ; refuse les comptes désactivés. */
  private loadTokenVersion(userId: string): Promise<number> {
    return this.db.withIdentityTx(async (tx) => {
      const u = await tx.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { tokenVersion: true, status: true },
      });
      if (!u || u.status !== 'ACTIVE')
        throw AppError.unauthenticated('Compte désactivé', ErrorCodes.TOKEN_REVOKED);
      return u.tokenVersion;
    });
  }
}
