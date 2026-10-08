import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { ErrorCodes } from '@polaris/contracts';
import { META_PUBLIC, META_SCOPE, type RouteScope } from '../../../common/decorators';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { impersonationSessions, memberships, tenants } from '../../../database/schema';
import { RedisService } from '../../shared';

interface MembershipState {
  status: string;
  tenantStatus: string | null;
  tenantId: string | null;
  kind: string;
  pv: number;
}

/**
 * Question 1 : es-tu dans le bon périmètre ?
 *  - tenant   : membership STAFF/GUARDIAN actif, tenant non suspendu → ctx.tenantId posé
 *  - platform : membership PLATFORM actif
 *  - identity : rien de plus que l'authentification
 * L'état du membership est relu toutes les 30 s (cache Redis) : une suspension ou une désactivation
 * est effective en moins de 30 s sans attendre l'expiration du JWT.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(META_PUBLIC, targets)) return true;
    const scope =
      this.reflector.getAllAndOverride<RouteScope | undefined>(META_SCOPE, targets) ?? 'tenant';
    const ctx = RequestContextStore.require();
    const actor = ctx.actor;
    if (!actor) throw AppError.unauthenticated();
    ctx.scope = scope;
    if (scope === 'identity') return true;

    // Session de support (impersonation) : appartenance plateforme active, tenant cible non suspendu,
    // session non clôturée ; jamais sur les routes plateforme (le support agit « comme » l'établissement).
    if (actor.impersonatedBy) {
      if (scope === 'platform' || !actor.membershipId || !actor.tenantId) throw AppError.notFound();
      const state = await this.membershipState(actor.membershipId);
      if (!state || state.status !== 'ACTIVE' || state.kind !== 'PLATFORM')
        throw AppError.unauthenticated('Appartenance inactive', ErrorCodes.TOKEN_REVOKED);
      const target = await this.impersonationState(
        actor.impersonationSessionId ?? '',
        actor.tenantId,
      );
      if (!target.alive)
        throw AppError.unauthenticated('Session de support terminée', ErrorCodes.TOKEN_REVOKED);
      if (target.tenantStatus === 'SUSPENDED')
        throw AppError.forbidden('Établissement suspendu', ErrorCodes.TENANT_SUSPENDED);
      ctx.tenantId = actor.tenantId;
      return true;
    }

    if (!actor.membershipId) {
      throw AppError.forbidden(
        'Choisissez un établissement (POST /auth/switch-membership)',
        ErrorCodes.FORBIDDEN,
      );
    }
    const state = await this.membershipState(actor.membershipId);
    if (!state || state.status !== 'ACTIVE')
      throw AppError.unauthenticated('Appartenance inactive', ErrorCodes.TOKEN_REVOKED);
    if (state.pv !== actor.permissionsVersion) {
      // Les rôles ont changé depuis l'émission du token : on force la version courante (le cache de permissions suit).
      actor.permissionsVersion = state.pv;
    }

    if (scope === 'platform') {
      if (state.kind !== 'PLATFORM') throw AppError.notFound();
      return true;
    }
    if (state.kind === 'PLATFORM' || !state.tenantId) throw AppError.notFound();
    if (state.tenantStatus === 'SUSPENDED')
      throw AppError.forbidden('Établissement suspendu', ErrorCodes.TENANT_SUSPENDED);
    ctx.tenantId = state.tenantId;
    return true;
  }

  private async membershipState(membershipId: string): Promise<MembershipState | null> {
    const key = `mship:${membershipId}`;
    try {
      const cached = await this.redis.client.get(key);
      if (cached) return JSON.parse(cached) as MembershipState;
    } catch {
      /* fall through */
    }
    const state = await this.db.withIdentityTx(async (tx) => {
      const [row] = await tx
        .select({
          status: memberships.status,
          kind: memberships.kind,
          tenantId: memberships.tenantId,
          pv: memberships.permissionsVersion,
          tenantStatus: tenants.status,
        })
        .from(memberships)
        .leftJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(eq(memberships.id, membershipId))
        .limit(1);
      return row
        ? {
            status: row.status,
            kind: row.kind,
            tenantId: row.tenantId,
            pv: row.pv,
            tenantStatus: row.tenantStatus,
          }
        : null;
    });
    if (state) {
      try {
        await this.redis.client.set(key, JSON.stringify(state), 'EX', 30);
      } catch {
        /* ignore */
      }
    }
    return state;
  }

  /** État d'une session d'impersonation (clôturée ? expirée ?) et du tenant cible ; cache 30 s. */
  private async impersonationState(
    sessionId: string,
    tenantId: string,
  ): Promise<{ alive: boolean; tenantStatus: string | null }> {
    const key = `imp:${sessionId}`;
    try {
      const cached = await this.redis.client.get(key);
      if (cached) return JSON.parse(cached) as { alive: boolean; tenantStatus: string | null };
    } catch {
      /* fall through */
    }
    const state = await this.db.withIdentityTx(async (tx) => {
      const [row] = await tx
        .select({
          endedAt: impersonationSessions.endedAt,
          expiresAt: impersonationSessions.expiresAt,
          sessionTenant: impersonationSessions.tenantId,
          tenantStatus: tenants.status,
        })
        .from(impersonationSessions)
        .innerJoin(tenants, eq(tenants.id, impersonationSessions.tenantId))
        .where(eq(impersonationSessions.id, sessionId))
        .limit(1);
      if (!row || row.sessionTenant !== tenantId) return { alive: false, tenantStatus: null };
      return {
        alive: row.endedAt === null && row.expiresAt.getTime() > Date.now(),
        tenantStatus: row.tenantStatus,
      };
    });
    try {
      await this.redis.client.set(key, JSON.stringify(state), 'EX', 30);
    } catch {
      /* ignore */
    }
    return state;
  }

  /** À appeler quand un membership ou un tenant change d'état (révocation < 30 s → immédiate). */
  async invalidate(membershipIds: string[]) {
    if (membershipIds.length === 0) return;
    try {
      await this.redis.client.del(...membershipIds.map((id) => `mship:${id}`));
    } catch {
      /* ignore */
    }
  }

  /** Fin anticipée d'une session de support : effective en moins de 30 s. */
  async invalidateImpersonation(sessionId: string) {
    try {
      await this.redis.client.del(`imp:${sessionId}`);
    } catch {
      /* ignore */
    }
  }
}
