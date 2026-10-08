import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALL_PERMISSIONS,
  ErrorCodes,
  IMPERSONATION_EXCLUDED,
  SENSITIVE_PERMISSIONS,
  SYSTEM_ROLES,
  type Permission,
} from '@polaris/contracts';
import { META_PERMISSION, META_PUBLIC } from '../../../common/decorators';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { IdentityRepository } from './identity.repository';
import { PermissionCache } from './permission.cache';

const PLATFORM_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('PLATFORM_'));
/** Session de support Super Admin : l'administrateur sans aucune action financière ni sensible (Partie 11). */
const IMPERSONATION_PERMISSIONS = SYSTEM_ROLES.ADMIN.permissions.filter(
  (p) => !(IMPERSONATION_EXCLUDED as readonly string[]).includes(p),
);
const SENSITIVE = new Set<string>(SENSITIVE_PERMISSIONS);

/** Question 2 : as-tu la permission ? (la question 3, « sur cette ressource », vit dans les policies des cas d'usage). */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
    private readonly repo: IdentityRepository,
    private readonly cache: PermissionCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(META_PUBLIC, targets)) return true;
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      META_PERMISSION,
      targets,
    );
    const ctx = RequestContextStore.require();
    const actor = ctx.actor;
    if (!actor) throw AppError.unauthenticated();

    // Résolues pour toute requête authentifiée (cache Redis versionné) : les policies de portée
    // s'en servent même quand la route n'exige aucune permission (ex. GET /me/schedule).
    const permissions = await this.resolve(
      actor.membershipId,
      actor.kind,
      actor.tenantId ?? ctx.tenantId,
      actor.permissionsVersion,
      actor.impersonatedBy ?? null,
    );
    actor.permissions = permissions;
    if (required) {
      const granted = required.filter((p) => permissions.includes(p));
      if (granted.length === 0)
        throw AppError.forbidden(`Permission requise : ${required.join(' ou ')}`);
      // MFA (ADR-0008) : une action accessible uniquement par une permission sensible exige une session MFA.
      if (!actor.mfa && granted.every((p) => SENSITIVE.has(p)))
        throw AppError.forbidden(
          'Cette action exige une session avec authentification à deux facteurs (MFA)',
          ErrorCodes.MFA_REQUIRED,
        );
    }
    // Super Admin : la MFA est obligatoire sur toute route plateforme (hors /me, portée identité).
    if (
      actor.kind === 'PLATFORM' &&
      !actor.impersonatedBy &&
      !actor.mfa &&
      ctx.scope === 'platform'
    )
      throw AppError.forbidden(
        'Le compte plateforme exige une session MFA : activez-la depuis votre profil',
        ErrorCodes.MFA_REQUIRED,
      );
    return true;
  }

  async resolve(
    membershipId: string | null,
    kind: string | null,
    tenantId: string | null,
    pv: number,
    impersonatedBy: string | null = null,
  ): Promise<string[]> {
    if (impersonatedBy) return [...IMPERSONATION_PERMISSIONS];
    if (!membershipId) return [];
    if (kind === 'PLATFORM') return [...PLATFORM_PERMISSIONS];
    const cached = await this.cache.get(membershipId, pv);
    if (cached) return cached;
    if (!tenantId) return [];
    const perms = await this.db.withTenantTx(tenantId, (tx) =>
      this.repo.permissionsOf(tx, membershipId),
    );
    await this.cache.set(membershipId, pv, perms);
    return perms;
  }
}
