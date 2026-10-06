import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS, type Permission } from '@polaris/contracts';
import { META_PERMISSION, META_PUBLIC } from '../../../common/decorators';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { IdentityRepository } from './identity.repository';
import { PermissionCache } from './permission.cache';

const PLATFORM_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('PLATFORM_'));

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
    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      META_PERMISSION,
      targets,
    );
    const ctx = RequestContextStore.require();
    const actor = ctx.actor;
    if (!actor) throw AppError.unauthenticated();
    if (!required) return true;

    const permissions = await this.resolve(
      actor.membershipId,
      actor.kind,
      actor.tenantId ?? ctx.tenantId,
      actor.permissionsVersion,
    );
    actor.permissions = permissions;
    if (!permissions.includes(required))
      throw AppError.forbidden(`Permission requise : ${required}`);
    return true;
  }

  async resolve(
    membershipId: string | null,
    kind: string | null,
    tenantId: string | null,
    pv: number,
  ): Promise<string[]> {
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
