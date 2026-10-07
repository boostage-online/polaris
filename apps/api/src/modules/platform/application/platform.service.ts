import { Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { CreateTenantInput } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { memberships, tenants } from '../../../database/schema';
import { AuditService } from '../../audit';
import { InvitationService, RoleService, ScopeGuard } from '../../identity';
import { OutboxService, tenantCreated, tenantStatusChanged } from '../../shared';
import { TenantService } from '../../tenancy';

/** Opérations inter-tenant du Super Admin. Toujours dans une transaction plateforme (BYPASSRLS), toujours auditées. */
@Injectable()
export class PlatformService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly roles: RoleService,
    private readonly invitations: InvitationService,
    private readonly tenantService: TenantService,
    private readonly scopeGuard: ScopeGuard,
  ) {}

  async listTenants() {
    const tx = this.db.current();
    const rows = await tx
      .select({
        tenant: tenants,
        members: sql<number>`(select count(*)::int from memberships m where m.tenant_id = ${tenants.id} and m.status = 'ACTIVE')`,
      })
      .from(tenants)
      .orderBy(desc(tenants.createdAt));
    return rows.map((r) => ({ ...this.tenantService.toDto(r.tenant), activeMembers: r.members }));
  }

  async createTenant(input: CreateTenantInput) {
    const tx = this.db.current();
    const id = randomUUID();
    try {
      await tx.insert(tenants).values({
        id,
        code: input.code,
        name: input.name,
        type: input.type,
        status: 'TRIAL',
        timezone: input.timezone,
        country: input.country,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw AppError.conflict(`Le code « ${input.code} » est déjà utilisé`);
      throw e;
    }
    const roleIds = await this.roles.seedSystemRoles(tx, id);
    await this.audit.record({
      action: 'tenant.created',
      entityType: 'Tenant',
      entityId: id,
      tenantId: id,
      after: { code: input.code, name: input.name, type: input.type },
    });
    await this.outbox.publish(tenantCreated({ tenantId: id, code: input.code, name: input.name }));
    let invitation: { id: string; email: string; expiresAt: string; token?: string } | null = null;
    if (input.adminEmail) {
      invitation = await this.invitations.invite({
        tenantId: id,
        email: input.adminEmail,
        displayName: 'Administrateur',
        roleIds: [roleIds.ADMIN],
        invitedBy: RequestContextStore.require().actor?.userId ?? null,
      });
    }
    const row = await tx.query.tenants.findFirst({ where: eq(tenants.id, id) });
    return { ...this.tenantService.toDto(row!), adminInvitation: invitation };
  }

  async updateStatus(tenantId: string, status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED', reason?: string) {
    const tx = this.db.current();
    const before = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!before) throw AppError.notFound('Établissement');
    const [after] = await tx
      .update(tenants)
      .set({
        status,
        suspendedAt: status === 'SUSPENDED' ? new Date() : null,
        suspensionReason: status === 'SUSPENDED' ? (reason ?? null) : null,
      })
      .where(eq(tenants.id, tenantId))
      .returning();
    const affected = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.tenantId, tenantId));
    await this.scopeGuard.invalidate(affected.map((m) => m.id));
    await this.audit.record({
      action: 'tenant.status_changed',
      entityType: 'Tenant',
      entityId: tenantId,
      tenantId,
      before: { status: before.status },
      after: { status, reason },
    });
    await this.outbox.publish(
      tenantStatusChanged({ tenantId, from: before.status, to: status, reason }),
    );
    return this.tenantService.toDto(after!);
  }

  async inviteAdmin(tenantId: string, email: string) {
    const tx = this.db.current();
    const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!tenant) throw AppError.notFound('Établissement');
    const adminRole = await tx.execute<{ id: string }>(
      sql`select id from roles where tenant_id = ${tenantId} and system_code = 'ADMIN' and deleted_at is null`,
    );
    const roleId = adminRole.rows[0]?.id;
    if (!roleId) throw AppError.conflict('Rôle Administrateur introuvable pour cet établissement');
    return this.invitations.invite({
      tenantId,
      email,
      displayName: 'Administrateur',
      roleIds: [roleId],
      invitedBy: RequestContextStore.require().actor?.userId ?? null,
    });
  }
}
