import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export type MembershipKind = 'STAFF' | 'GUARDIAN' | 'PLATFORM';

/** Acteur authentifié, résolu une fois par requête par AuthGuard. */
export interface Actor {
  userId: string;
  membershipId: string | null;
  tenantId: string | null;
  kind: MembershipKind | null;
  permissionsVersion: number;
  tokenVersion: number;
  impersonatedBy?: string | null;
  /** Permissions effectives, résolues à la demande par PermissionGuard (cache Redis versionné). */
  permissions?: string[];
}

export interface RequestContext {
  requestId: string;
  traceId: string;
  ip: string | null;
  userAgent: string | null;
  actor: Actor | null;
  /** Tenant effectif de la requête (posé par TenantGuard ou explicitement par un job). */
  tenantId: string | null;
  /** Transaction courante (posée par withTenantTx / withPlatformTx). */
  tx: Db | null;
  /** 'app' = rôle sans BYPASSRLS ; 'platform' = BYPASSRLS, réservé au module Platform et aux jobs listés. */
  pool: 'app' | 'platform' | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  require(): RequestContext {
    const ctx = storage.getStore();
    if (!ctx) throw new Error('Aucun contexte de requête : appel hors requête HTTP ou hors job');
    return ctx;
  },
  /** Crée un contexte vide (jobs, scripts, tests). */
  blank(partial: Partial<RequestContext> = {}): RequestContext {
    return {
      requestId: partial.requestId ?? randomUUID(),
      traceId: partial.traceId ?? randomUUID(),
      ip: partial.ip ?? null,
      userAgent: partial.userAgent ?? null,
      actor: partial.actor ?? null,
      tenantId: partial.tenantId ?? null,
      tx: partial.tx ?? null,
      pool: partial.pool ?? null,
    };
  },
};
