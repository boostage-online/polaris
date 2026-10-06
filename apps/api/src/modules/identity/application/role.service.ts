import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ALL_PERMISSIONS,
  ErrorCodes,
  SYSTEM_ROLES,
  type Permission,
  type SystemRoleCode,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  memberships,
  membershipRoles,
  rolePermissions,
  roles,
  users,
} from '../../../database/schema';
import { AuditService } from '../../audit';
import { OutboxService, roleChanged } from '../../shared';
import { RolePolicy } from '../domain/policies';
import { ScopeGuard } from '../infrastructure/scope.guard';

const KNOWN = new Set<string>(ALL_PERMISSIONS);

@Injectable()
export class RoleService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly scopeGuard: ScopeGuard,
  ) {}

  /** Copie les rôles système dans un tenant (création de tenant). Fonctionne dans toute transaction (app ou platform). */
  async seedSystemRoles(tx: Db, tenantId: string): Promise<Record<SystemRoleCode, string>> {
    const ids = {} as Record<SystemRoleCode, string>;
    for (const [code, def] of Object.entries(SYSTEM_ROLES) as [
      SystemRoleCode,
      (typeof SYSTEM_ROLES)[SystemRoleCode],
    ][]) {
      const id = randomUUID();
      await tx.insert(roles).values({
        id,
        tenantId,
        name: def.name,
        description: def.description,
        systemCode: code,
        isLocked: code === 'ADMIN',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await tx
        .insert(rolePermissions)
        .values(def.permissions.map((p) => ({ tenantId, roleId: id, permissionCode: p })));
      ids[code] = id;
    }
    return ids;
  }

  async list() {
    const tx = this.db.current();
    const rows = await tx.query.roles.findMany({
      where: isNull(roles.deletedAt),
      orderBy: roles.name,
    });
    const perms = rows.length
      ? await tx
          .select()
          .from(rolePermissions)
          .where(
            inArray(
              rolePermissions.roleId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return rows.map((r) =>
      this.toDto(
        r,
        perms.filter((p) => p.roleId === r.id).map((p) => p.permissionCode as Permission),
      ),
    );
  }

  async get(roleId: string) {
    const tx = this.db.current();
    const role = await tx.query.roles.findFirst({
      where: and(eq(roles.id, roleId), isNull(roles.deletedAt)),
    });
    if (!role) throw AppError.notFound('Rôle');
    const perms = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    return this.toDto(
      role,
      perms.map((p) => p.permissionCode as Permission),
    );
  }

  async updatePermissions(roleId: string, permissions: Permission[]) {
    const tx = this.db.current();
    const before = await this.get(roleId);
    if (!RolePolicy.canEditPermissions({ isLocked: before.systemCode === 'ADMIN' })) {
      throw AppError.conflict('Le rôle Administrateur ne peut pas être modifié');
    }
    const errors = RolePolicy.validateTenantPermissions(permissions, KNOWN);
    if (errors.length)
      throw AppError.validation(errors.map((e) => ({ path: 'permissions', message: e })));

    if (before.permissions.includes('MANAGE_ROLES') && !permissions.includes('MANAGE_ROLES')) {
      await this.assertManageRolesSurvives(tx, { excludeRoleId: roleId });
    }
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    const tenantId = RequestContextStore.require().tenantId!;
    await tx
      .insert(rolePermissions)
      .values([...new Set(permissions)].map((p) => ({ tenantId, roleId, permissionCode: p })));
    await tx.update(roles).set({ updatedAt: new Date() }).where(eq(roles.id, roleId));
    await this.bumpPermissionsVersionForRole(tx, roleId);
    const after = await this.get(roleId);
    await this.audit.record({
      action: 'role.permissions_updated',
      entityType: 'Role',
      entityId: roleId,
      before,
      after,
    });
    return after;
  }

  async duplicate(roleId: string, name: string) {
    const tx = this.db.current();
    const source = await this.get(roleId);
    const tenantId = RequestContextStore.require().tenantId!;
    const id = randomUUID();
    try {
      await tx.insert(roles).values({
        id,
        tenantId,
        name,
        description: source.description,
        systemCode: null,
        isLocked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw AppError.conflict(`Un rôle nommé « ${name} » existe déjà`);
      throw e;
    }
    await tx
      .insert(rolePermissions)
      .values(source.permissions.map((p) => ({ tenantId, roleId: id, permissionCode: p })));
    const created = await this.get(id);
    await this.audit.record({
      action: 'role.duplicated',
      entityType: 'Role',
      entityId: id,
      after: created,
      metadata: { sourceRoleId: roleId },
    });
    return created;
  }

  async listMembers() {
    const tx = this.db.current();
    const tenantId = RequestContextStore.require().tenantId!;
    const rows = await tx
      .select({
        id: memberships.id,
        kind: memberships.kind,
        status: memberships.status,
        userId: users.id,
        email: users.email,
        phone: users.phoneE164,
        displayName: users.displayName,
        acceptedAt: memberships.acceptedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.kind, 'STAFF')))
      .orderBy(users.displayName);
    const mr = rows.length
      ? await tx
          .select({
            membershipId: membershipRoles.membershipId,
            roleId: roles.id,
            name: roles.name,
          })
          .from(membershipRoles)
          .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
          .where(
            inArray(
              membershipRoles.membershipId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return rows.map((r) => ({
      ...r,
      roles: mr.filter((x) => x.membershipId === r.id).map((x) => ({ id: x.roleId, name: x.name })),
    }));
  }

  async assignRoles(membershipId: string, roleIds: string[]) {
    const tx = this.db.current();
    const tenantId = RequestContextStore.require().tenantId!;
    const m = await tx.query.memberships.findFirst({
      where: and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId)),
    });
    if (!m || m.kind !== 'STAFF') throw AppError.notFound('Membre');
    const valid = await tx.query.roles.findMany({
      where: and(inArray(roles.id, roleIds), isNull(roles.deletedAt)),
    });
    if (valid.length !== new Set(roleIds).size)
      throw AppError.validation([
        { path: 'roleIds', message: 'Un ou plusieurs rôles sont inconnus' },
      ]);

    const currentPerms = await this.permissionsOfMembership(tx, membershipId);
    const nextPerms = await this.permissionsOfRoles(tx, roleIds);
    if (currentPerms.has('MANAGE_ROLES') && !nextPerms.has('MANAGE_ROLES')) {
      await this.assertManageRolesSurvives(tx, { excludeMembershipId: membershipId });
    }
    const before = await tx
      .select({ roleId: membershipRoles.roleId })
      .from(membershipRoles)
      .where(eq(membershipRoles.membershipId, membershipId));
    await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, membershipId));
    const actor = RequestContextStore.require().actor;
    await tx.insert(membershipRoles).values(
      [...new Set(roleIds)].map((roleId) => ({
        tenantId,
        membershipId,
        roleId,
        grantedBy: actor?.userId ?? null,
        grantedAt: new Date(),
        scope: null,
      })),
    );
    await tx
      .update(memberships)
      .set({ permissionsVersion: sql`${memberships.permissionsVersion} + 1` })
      .where(eq(memberships.id, membershipId));
    await this.scopeGuard.invalidate([membershipId]);
    await this.audit.record({
      action: 'membership.roles_assigned',
      entityType: 'Membership',
      entityId: membershipId,
      before: { roleIds: before.map((b) => b.roleId) },
      after: { roleIds },
    });
    await this.outbox.publish(roleChanged({ tenantId, membershipId, roleIds }));
    return { membershipId, roleIds };
  }

  private async permissionsOfRoles(tx: Db, roleIds: string[]) {
    if (roleIds.length === 0) return new Set<string>();
    const rows = await tx
      .select({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, roleIds));
    return new Set(rows.map((r) => r.code));
  }
  private async permissionsOfMembership(tx: Db, membershipId: string) {
    const rows = await tx
      .select({ code: rolePermissions.permissionCode })
      .from(membershipRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, membershipId));
    return new Set(rows.map((r) => r.code));
  }

  /** Garde-fou : il doit rester au moins un membre actif détenant MANAGE_ROLES après le changement. */
  private async assertManageRolesSurvives(
    tx: Db,
    opts: { excludeRoleId?: string; excludeMembershipId?: string },
  ) {
    const res = await tx.execute<{ n: string }>(sql`
      select count(distinct m.id)::text as n
      from memberships m
      join membership_roles mr on mr.membership_id = m.id
      join role_permissions rp on rp.role_id = mr.role_id and rp.permission_code = 'MANAGE_ROLES'
      join roles r on r.id = mr.role_id and r.deleted_at is null
      where m.status = 'ACTIVE' and m.tenant_id = app_current_tenant()
        and (${opts.excludeRoleId ?? null}::uuid is null or mr.role_id <> ${opts.excludeRoleId ?? null}::uuid)
        and (${opts.excludeMembershipId ?? null}::uuid is null or m.id <> ${opts.excludeMembershipId ?? null}::uuid)`);
    if (!RolePolicy.canRemoveManageRoles(Number(res.rows[0]?.n ?? 0))) {
      throw AppError.conflict(
        'Impossible : plus personne ne pourrait gérer les rôles',
        ErrorCodes.LAST_ROLE_HOLDER,
      );
    }
  }

  private async bumpPermissionsVersionForRole(tx: Db, roleId: string) {
    const affected = await tx
      .update(memberships)
      .set({ permissionsVersion: sql`${memberships.permissionsVersion} + 1` })
      .where(
        inArray(
          memberships.id,
          tx
            .select({ id: membershipRoles.membershipId })
            .from(membershipRoles)
            .where(eq(membershipRoles.roleId, roleId)),
        ),
      )
      .returning({ id: memberships.id });
    await this.scopeGuard.invalidate(affected.map((a) => a.id));
  }

  private toDto(r: typeof roles.$inferSelect, permissions: Permission[]) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      systemCode: r.systemCode,
      permissions: permissions.sort(),
    };
  }
}
