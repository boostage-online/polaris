import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../../database/database.service';
import type { Db } from '../../../database/request-context';
import {
  memberships,
  membershipRoles,
  refreshTokens,
  roles,
  rolePermissions,
  tenants,
  users,
} from '../../../database/schema';

export interface MembershipRow {
  id: string;
  kind: 'STAFF' | 'GUARDIAN' | 'PLATFORM';
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  permissionsVersion: number;
  tenant: { id: string; code: string; name: string; status: string; timezone: string } | null;
  roles: { id: string; name: string }[];
}

/**
 * Lectures d'identité. Les requêtes croisant plusieurs tenants (liste des appartenances d'un
 * utilisateur avec le nom des rôles) utilisent explicitement le pool plateforme : c'est le seul
 * endroit hors module Platform où BYPASSRLS est légitime, et il ne lit que les données du
 * compte authentifié.
 */
@Injectable()
export class IdentityRepository {
  constructor(private readonly db: DatabaseService) {}

  findUserByIdentifier(tx: Db, identifier: string) {
    const isEmail = identifier.includes('@');
    return tx.query.users.findFirst({
      where: isEmail ? eq(users.email, identifier.toLowerCase()) : eq(users.phoneE164, identifier),
    });
  }

  findUserById(tx: Db, id: string) {
    return tx.query.users.findFirst({ where: eq(users.id, id) });
  }

  async listMemberships(userId: string): Promise<MembershipRow[]> {
    return this.db.withPlatformTx('list memberships of authenticated user', async (tx) => {
      const rows = await tx
        .select({
          id: memberships.id,
          kind: memberships.kind,
          status: memberships.status,
          permissionsVersion: memberships.permissionsVersion,
          tenantId: tenants.id,
          tenantCode: tenants.code,
          tenantName: tenants.name,
          tenantStatus: tenants.status,
          tenantTimezone: tenants.timezone,
        })
        .from(memberships)
        .leftJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(
          and(eq(memberships.userId, userId), inArray(memberships.status, ['ACTIVE', 'PENDING'])),
        );
      if (rows.length === 0) return [];
      const roleRows = await tx
        .select({ membershipId: membershipRoles.membershipId, id: roles.id, name: roles.name })
        .from(membershipRoles)
        .innerJoin(roles, and(eq(roles.id, membershipRoles.roleId), isNull(roles.deletedAt)))
        .where(
          inArray(
            membershipRoles.membershipId,
            rows.map((r) => r.id),
          ),
        );
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        permissionsVersion: r.permissionsVersion,
        tenant: r.tenantId
          ? {
              id: r.tenantId,
              code: r.tenantCode!,
              name: r.tenantName!,
              status: r.tenantStatus!,
              timezone: r.tenantTimezone!,
            }
          : null,
        roles: roleRows
          .filter((x) => x.membershipId === r.id)
          .map((x) => ({ id: x.id, name: x.name })),
      }));
    });
  }

  /** Permissions effectives d'un membership (dans une transaction tenant : RLS active sur role_permissions). */
  async permissionsOf(tx: Db, membershipId: string): Promise<string[]> {
    const rows = await tx
      .selectDistinct({ code: rolePermissions.permissionCode })
      .from(membershipRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, membershipRoles.roleId))
      .innerJoin(roles, and(eq(roles.id, membershipRoles.roleId), isNull(roles.deletedAt)))
      .where(eq(membershipRoles.membershipId, membershipId));
    return rows.map((r) => r.code);
  }

  async touchLogin(tx: Db, userId: string) {
    await tx
      .update(users)
      .set({ lastLoginAt: sql`now()` })
      .where(eq(users.id, userId));
  }

  findRefreshByHash(tx: Db, hash: string) {
    return tx.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, hash) });
  }
}
