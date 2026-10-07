import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SupportLookup } from '@polaris/contracts';
import { DatabaseService } from '../../../database/database.service';
import { AuditService } from '../../audit';
import { MfaService } from '../../identity';
import { RedisService } from '../../shared';

const n = (v: unknown) => Number(v ?? 0);

/**
 * Outils du support niveau 1 (Phase 8) : retrouver une personne par e-mail, téléphone ou nom à travers tous
 * les établissements, voir d'un coup d'œil pourquoi elle ne peut pas se connecter (compte désactivé,
 * verrouillage anti-force-brute, MFA, invitation non acceptée, tuteur jamais invité), déverrouiller, et
 * réinitialiser une MFA après vérification d'identité. Lecture plateforme (BYPASSRLS), aucune donnée
 * d'assiduité ni financière : le support voit *qui* et *quel état*, pas *quoi*.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
  ) {}

  async lookup(q: string): Promise<SupportLookup> {
    const tx = this.db.current();
    const needle = q.trim();
    const like = `%${needle.toLowerCase()}%`;
    const phone = needle.replace(/[\s.-]/g, '');
    const users = await tx.execute<{
      id: string;
      email: string | null;
      phone_e164: string | null;
      display_name: string | null;
      status: 'ACTIVE' | 'DISABLED';
      mfa_enabled: boolean;
      last_login_at: Date | null;
      created_at: Date;
      active_sessions: number;
      pending_invitations: number;
      guardian_links: number;
    }>(sql`
      select u.id, u.email, u.phone_e164, u.display_name, u.status, u.mfa_enabled, u.last_login_at, u.created_at,
             (select count(distinct family_id) from refresh_tokens r where r.user_id = u.id and r.revoked_at is null and r.expires_at > now())::int as active_sessions,
             (select count(*) from tenant_invitations i where u.email is not null and lower(i.email) = lower(u.email) and i.accepted_at is null and i.expires_at > now())::int as pending_invitations,
             (select count(*) from guardians g join student_guardians sg on sg.guardian_id = g.id and sg.unlinked_at is null where g.user_id = u.id and g.deleted_at is null)::int as guardian_links
      from users u
      where lower(coalesce(u.email, '')) like ${like}
         or lower(coalesce(u.display_name, '')) like ${like}
         or (${phone} <> '' and coalesce(u.phone_e164, '') like ${'%' + phone + '%'})
      order by u.last_login_at desc nulls last, u.created_at desc
      limit 10`);
    const ids = users.rows.map((u) => u.id);
    const memberships = ids.length
      ? await tx.execute<{
          id: string;
          user_id: string;
          kind: 'STAFF' | 'GUARDIAN' | 'PLATFORM';
          status: string;
          tenant_id: string | null;
          tenant_code: string | null;
          tenant_name: string | null;
          roles: string[] | null;
        }>(sql`
          select m.id, m.user_id, m.kind, m.status, m.tenant_id, t.code as tenant_code, t.name as tenant_name,
                 (select array_agg(r.name order by r.name) from membership_roles mr join roles r on r.id = mr.role_id where mr.membership_id = m.id) as roles
          from memberships m left join tenants t on t.id = m.tenant_id
          where m.user_id = any(${ids}::uuid[])
          order by m.created_at`)
      : { rows: [] };
    const guardiansNoAccount = await tx.execute<{
      tenant_code: string;
      tenant_name: string;
      display_name: string;
      phone_e164: string | null;
      invited_at: Date | null;
    }>(sql`
      select t.code as tenant_code, t.name as tenant_name, g.first_name || ' ' || g.last_name as display_name, g.phone_e164, g.invited_at
      from guardians g join tenants t on t.id = g.tenant_id
      where g.deleted_at is null and g.user_id is null and g.anonymized_at is null
        and (lower(g.first_name || ' ' || g.last_name) like ${like}
             or lower(coalesce(g.email, '')) like ${like}
             or (${phone} <> '' and g.phone_e164 like ${'%' + phone + '%'}))
      limit 10`);
    const lockedFor = async (identifiers: (string | null)[]) => {
      let max = 0;
      for (const id of identifiers) {
        if (!id) continue;
        try {
          const ttl = await this.redis.client.pttl(`bf:acct:${id.toLowerCase()}:lock`);
          if (ttl > max) max = ttl;
        } catch {
          /* Redis indisponible : pas d'information de verrouillage */
        }
      }
      return max > 0 ? Math.ceil(max / 1000) : null;
    };
    const out: SupportLookup['users'] = [];
    for (const u of users.rows) {
      out.push({
        id: u.id,
        email: u.email,
        phone: u.phone_e164,
        displayName: u.display_name,
        status: u.status,
        mfaEnabled: u.mfa_enabled,
        lastLoginAt: u.last_login_at ? new Date(u.last_login_at).toISOString() : null,
        createdAt: new Date(u.created_at).toISOString(),
        lockedFor: await lockedFor([u.email, u.phone_e164]),
        activeSessions: n(u.active_sessions),
        memberships: memberships.rows
          .filter((m) => m.user_id === u.id)
          .map((m) => ({
            id: m.id,
            kind: m.kind,
            status: m.status,
            tenantId: m.tenant_id,
            tenantCode: m.tenant_code,
            tenantName: m.tenant_name,
            roles: m.roles ?? [],
          })),
        pendingInvitations: n(u.pending_invitations),
        guardianLinks: n(u.guardian_links),
      });
    }
    await this.audit.record({
      action: 'support.lookup',
      entityType: 'Support',
      entityId: 'lookup',
      tenantId: null,
      after: { query: needle, results: out.length },
    });
    return {
      query: needle,
      users: out,
      guardiansWithoutAccount: guardiansNoAccount.rows.map((g) => ({
        tenantCode: g.tenant_code,
        tenantName: g.tenant_name,
        displayName: g.display_name,
        phone: g.phone_e164,
        invitedAt: g.invited_at ? new Date(g.invited_at).toISOString() : null,
      })),
    };
  }

  /** Lève le verrouillage anti-force-brute d'un identifiant (e-mail ou téléphone) ; journalisé. */
  async unlock(identifier: string) {
    const key = `bf:acct:${identifier.trim().toLowerCase()}`;
    let wasLocked = false;
    try {
      wasLocked = (await this.redis.client.pttl(`${key}:lock`)) > 0;
      await this.redis.client.del(key, `${key}:lock`);
    } catch {
      /* fail-open : rien à lever */
    }
    await this.audit.record({
      action: 'support.unlocked',
      entityType: 'Support',
      entityId: identifier.trim().toLowerCase(),
      tenantId: null,
      after: { wasLocked },
    });
    return { identifier: identifier.trim(), wasLocked };
  }

  /** Réinitialisation de MFA par le support (identité vérifiée hors ligne, motif obligatoire). */
  async resetMfa(userId: string, reason: string) {
    return this.mfa.resetByAdmin({ userId }, reason);
  }
}
