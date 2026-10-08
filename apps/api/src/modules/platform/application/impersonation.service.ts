import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  IMPERSONATION_EXCLUDED,
  SYSTEM_ROLES,
  type ImpersonationGrant,
  type ImpersonationSession,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { impersonationSessions, tenants, users } from '../../../database/schema';
import { AuditService } from '../../audit';
import { ScopeGuard, TokenService } from '../../identity';

const GRANTED = SYSTEM_ROLES.ADMIN.permissions.filter(
  (p) => !(IMPERSONATION_EXCLUDED as readonly string[]).includes(p),
);

/**
 * Impersonation Super Admin (Partie 11) : un jeton d'accès de 30 minutes, sans refresh, qui agit dans
 * l'établissement cible avec les permissions de l'administrateur **moins** toute action financière ou
 * sensible. Chaque session est enregistrée, auditée, visible dans la vue plateforme et clôturable à tout moment.
 */
@Injectable()
export class ImpersonationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly scopeGuard: ScopeGuard,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async start(tenantId: string, reason: string): Promise<ImpersonationGrant> {
    const ctx = RequestContextStore.require();
    const actor = ctx.actor!;
    const tx = this.db.current();
    const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!tenant) throw AppError.notFound('Établissement');
    if (tenant.status === 'SUSPENDED') throw AppError.conflict('Établissement suspendu');
    const ttl = this.env.IMPERSONATION_TTL_MINUTES * 60;
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await tx.insert(impersonationSessions).values({
      id,
      platformUserId: actor.userId,
      tenantId,
      reason,
      startedAt: new Date(),
      expiresAt,
      endedAt: null,
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 512) ?? null,
    });
    const accessToken = await this.tokens.signAccess(
      {
        sub: actor.userId,
        mid: actor.membershipId,
        tid: tenantId,
        kind: 'STAFF',
        pv: 0,
        tv: actor.tokenVersion,
        mfa: actor.mfa === true,
        imp: actor.userId,
        isid: id,
      },
      ttl,
    );
    await this.audit.record({
      action: 'platform.impersonation_started',
      entityType: 'Tenant',
      entityId: tenantId,
      tenantId,
      metadata: { sessionId: id, reason, expiresAt: expiresAt.toISOString() },
    });
    return {
      sessionId: id,
      accessToken,
      expiresAt: expiresAt.toISOString(),
      tenant: { id: tenant.id, code: tenant.code, name: tenant.name },
      permissions: [...GRANTED],
    };
  }

  async end(sessionId: string): Promise<ImpersonationSession> {
    const tx = this.db.current();
    const [row] = await tx
      .update(impersonationSessions)
      .set({ endedAt: new Date() })
      .where(eq(impersonationSessions.id, sessionId))
      .returning();
    if (!row) throw AppError.notFound('Session de support');
    await this.scopeGuard.invalidateImpersonation(sessionId);
    await this.audit.record({
      action: 'platform.impersonation_ended',
      entityType: 'Tenant',
      entityId: row.tenantId,
      tenantId: row.tenantId,
      metadata: { sessionId },
    });
    return (await this.list()).find((s) => s.id === sessionId)!;
  }

  async list(): Promise<ImpersonationSession[]> {
    const tx = this.db.current();
    const rows = await tx
      .select({ s: impersonationSessions, tenantName: tenants.name, userName: users.displayName })
      .from(impersonationSessions)
      .innerJoin(tenants, eq(tenants.id, impersonationSessions.tenantId))
      .leftJoin(users, eq(users.id, impersonationSessions.platformUserId))
      .orderBy(desc(impersonationSessions.startedAt))
      .limit(100);
    const now = Date.now();
    return rows.map((r) => ({
      id: r.s.id,
      platformUserId: r.s.platformUserId,
      platformUserName: r.userName,
      tenantId: r.s.tenantId,
      tenantName: r.tenantName,
      reason: r.s.reason,
      startedAt: r.s.startedAt.toISOString(),
      expiresAt: r.s.expiresAt.toISOString(),
      endedAt: r.s.endedAt?.toISOString() ?? null,
      active: r.s.endedAt === null && r.s.expiresAt.getTime() > now,
    }));
  }
}
