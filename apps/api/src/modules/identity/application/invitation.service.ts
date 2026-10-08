import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import {
  memberships,
  membershipRoles,
  roles,
  tenantInvitations,
  users,
} from '../../../database/schema';
import { AuditService } from '../../audit';
import { OutboxService, userInvited } from '../../shared';
import { generateOpaqueToken, hashToken } from '../domain/tokens';
import { PasswordService } from './password.service';

const INVITATION_TTL_H = 72;

/** Invitation du personnel : lien à usage unique, acceptation = création/rattachement du compte. */
@Injectable()
export class InvitationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly passwords: PasswordService,
  ) {}

  /** Dans une transaction tenant (ou platform avec tenantId explicite). */
  async invite(input: {
    tenantId: string;
    email: string;
    displayName: string;
    roleIds: string[];
    invitedBy: string | null;
  }) {
    const tx = this.db.current();
    const validRoles = await tx.query.roles.findMany({
      where: and(eq(roles.tenantId, input.tenantId), isNull(roles.deletedAt)),
    });
    const known = new Set(validRoles.map((r) => r.id));
    if (!input.roleIds.every((id) => known.has(id)))
      throw AppError.validation([{ path: 'roleIds', message: 'Rôle inconnu' }]);

    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_H * 3600_000);
    const [inv] = await tx
      .insert(tenantInvitations)
      .values({
        id: randomUUID(),
        tenantId: input.tenantId,
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        roleIds: input.roleIds,
        tokenHash: hashToken(token),
        invitedBy: input.invitedBy,
        expiresAt,
        createdAt: new Date(),
      })
      .returning();
    await this.audit.record({
      action: 'member.invited',
      entityType: 'Invitation',
      entityId: inv!.id,
      tenantId: input.tenantId,
      after: { email: inv!.email, roleIds: input.roleIds },
    });
    await this.outbox.publish(
      userInvited({
        tenantId: input.tenantId,
        email: inv!.email,
        displayName: input.displayName,
        token,
        expiresAt: expiresAt.toISOString(),
      }),
    );
    return {
      id: inv!.id,
      email: inv!.email,
      expiresAt: expiresAt.toISOString(),
      ...(process.env['NODE_ENV'] !== 'production' ? { token } : {}),
    };
  }

  /** Route publique : le token identifie l'invitation (lecture plateforme, puis écriture scopée tenant). */
  async accept(input: { token: string; password: string; displayName?: string }) {
    const hash = hashToken(input.token);
    const inv = await this.db.withPlatformTx('invitation lookup by token', (tx) =>
      tx.query.tenantInvitations.findFirst({ where: eq(tenantInvitations.tokenHash, hash) }),
    );
    if (!inv || inv.acceptedAt || inv.expiresAt.getTime() < Date.now())
      throw AppError.notFound('Invitation');

    const passwordHash = await this.passwords.hash(input.password);
    return this.db.withTenantTx(inv.tenantId, async (tx) => {
      let user = await tx.query.users.findFirst({ where: eq(users.email, inv.email) });
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({
            id: randomUUID(),
            email: inv.email,
            phoneE164: null,
            passwordHash,
            displayName: input.displayName ?? inv.displayName,
            status: 'ACTIVE',
            mfaEnabled: false,
            tokenVersion: 0,
            locale: 'fr',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
      } else if (!user.passwordHash) {
        await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      }
      const existing = await tx.query.memberships.findFirst({
        where: and(eq(memberships.userId, user!.id), eq(memberships.tenantId, inv.tenantId)),
      });
      const membershipId = existing?.id ?? randomUUID();
      if (!existing) {
        await tx.insert(memberships).values({
          id: membershipId,
          userId: user!.id,
          tenantId: inv.tenantId,
          kind: 'STAFF',
          status: 'ACTIVE',
          permissionsVersion: 1,
          invitedBy: inv.invitedBy,
          acceptedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        await tx
          .update(memberships)
          .set({
            status: 'ACTIVE',
            acceptedAt: new Date(),
            permissionsVersion: sql`${memberships.permissionsVersion} + 1`,
          })
          .where(eq(memberships.id, membershipId));
        await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, membershipId));
      }
      await tx.insert(membershipRoles).values(
        inv.roleIds.map((roleId) => ({
          tenantId: inv.tenantId,
          membershipId,
          roleId,
          grantedBy: inv.invitedBy,
          grantedAt: new Date(),
          scope: null,
        })),
      );
      await tx
        .update(tenantInvitations)
        .set({ acceptedAt: new Date() })
        .where(eq(tenantInvitations.id, inv.id));
      RequestContextStore.require().actor = {
        userId: user!.id,
        membershipId,
        tenantId: inv.tenantId,
        kind: 'STAFF',
        permissionsVersion: 1,
        tokenVersion: 0,
      };
      await this.audit.record({
        action: 'member.invitation_accepted',
        entityType: 'Membership',
        entityId: membershipId,
        tenantId: inv.tenantId,
        actorUserId: user!.id,
      });
      return { userId: user!.id, membershipId, tenantId: inv.tenantId };
    });
  }
}
