import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { auditLogs } from '../../../database/schema';
import { decodeCursor, page } from '../../../common/http/cursor';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Par défaut : tenant du contexte. `null` explicite = action plateforme. */
  tenantId?: string | null;
  actorUserId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Journal immuable (trigger PostgreSQL). Écrit dans la transaction courante : une action annulée
 * n'est jamais auditée, une action auditée a forcément eu lieu.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async record(entry: AuditEntry): Promise<string> {
    const tx = this.db.current();
    const ctx = RequestContextStore.require();
    const id = randomUUID();
    await tx.insert(auditLogs).values({
      id,
      tenantId: entry.tenantId === undefined ? ctx.tenantId : entry.tenantId,
      actorUserId: entry.actorUserId ?? ctx.actor?.userId ?? null,
      actorMembershipId: ctx.actor?.membershipId ?? null,
      impersonatedBy: ctx.actor?.impersonatedBy ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before === undefined ? null : entry.before,
      after: entry.after === undefined ? null : entry.after,
      metadata: entry.metadata ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 512) ?? null,
      requestId: ctx.requestId,
      occurredAt: new Date(),
    });
    return id;
  }

  async list(query: {
    cursor?: string;
    limit: number;
    entityType?: string;
    entityId?: string;
    actorUserId?: string;
    from?: string;
    to?: string;
  }) {
    const tx = this.db.current();
    const cur = decodeCursor<{ t: string; id: string }>(query.cursor);
    const conditions = [
      query.entityType ? eq(auditLogs.entityType, query.entityType) : undefined,
      query.entityId ? eq(auditLogs.entityId, query.entityId) : undefined,
      query.actorUserId ? eq(auditLogs.actorUserId, query.actorUserId) : undefined,
      query.from ? gte(auditLogs.occurredAt, new Date(query.from)) : undefined,
      query.to ? lte(auditLogs.occurredAt, new Date(query.to)) : undefined,
      cur
        ? or(
            lt(auditLogs.occurredAt, new Date(cur.t)),
            and(eq(auditLogs.occurredAt, new Date(cur.t)), lt(auditLogs.id, cur.id)),
          )
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const rows = await tx
      .select()
      .from(auditLogs)
      .where(conditions.length ? and(...conditions) : sql`true`)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(query.limit + 1);
    return page(
      rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString(), ip: r.ip })),
      query.limit,
      (last) => ({ t: last.occurredAt, id: last.id }),
    );
  }
}
