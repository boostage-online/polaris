import { Injectable } from '@nestjs/common';
import { ErrorCodes, type MembershipSummarySchema, type TokenPair } from '@polaris/contracts';
import type { z } from 'zod';
import { AppError } from '../../../common/errors/app-error';
import type { Db } from '../../../database/request-context';
import { users } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import type { MembershipRow } from '../infrastructure/identity.repository';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';
import { PermissionCache } from '../infrastructure/permission.cache';

type MembershipSummary = z.infer<typeof MembershipSummarySchema>;

export interface DeviceInfo {
  deviceId?: string;
  deviceLabel?: string;
}

export interface IssuedSession {
  pair: TokenPair;
  refresh: { token: string; familyId: string; expiresAt: Date };
}

/** Émission d'une session complète (access + refresh) pour un utilisateur et un membership actif. */
@Injectable()
export class SessionService {
  constructor(
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly permCache: PermissionCache,
  ) {}

  toSummary(m: MembershipRow): MembershipSummary {
    return {
      id: m.id,
      kind: m.kind,
      tenant: m.tenant
        ? { id: m.tenant.id, code: m.tenant.code, name: m.tenant.name, status: m.tenant.status }
        : null,
      roles: m.roles,
    };
  }

  /** Choix du membership actif : unique membership utilisable, sinon `preferredId`, sinon aucun (le client choisira). */
  pickMembership(all: MembershipRow[], preferredId?: string | null): MembershipRow | null {
    const usable = all.filter(
      (m) => m.status === 'ACTIVE' && (m.tenant === null || m.tenant.status !== 'SUSPENDED'),
    );
    if (preferredId) return usable.find((m) => m.id === preferredId) ?? null;
    if (usable.length === 1) return usable[0]!;
    return null;
  }

  assertUsable(m: MembershipRow) {
    if (m.status !== 'ACTIVE') throw AppError.forbidden('Appartenance inactive');
    if (m.tenant && m.tenant.status === 'SUSPENDED') {
      throw AppError.forbidden('Établissement suspendu', ErrorCodes.TENANT_SUSPENDED);
    }
  }

  async issue(
    tx: Db,
    input: {
      userId: string;
      membership: MembershipRow | null;
      all: MembershipRow[];
      device: DeviceInfo;
      familyId?: string;
      replaces?: string;
    },
  ): Promise<IssuedSession> {
    const user = await tx.query.users.findFirst({
      where: eq(users.id, input.userId),
      columns: { tokenVersion: true },
    });
    if (!user) throw AppError.unauthenticated();
    await this.permCache.setTokenVersion(input.userId, user.tokenVersion);
    const kind = input.membership?.kind ?? null;
    const accessToken = await this.tokens.signAccess({
      sub: input.userId,
      mid: input.membership?.id ?? null,
      tid: input.membership?.tenant?.id ?? null,
      kind,
      pv: input.membership?.permissionsVersion ?? 0,
      tv: user.tokenVersion,
    });
    const refresh = await this.refreshTokens.issue(tx, {
      userId: input.userId,
      membershipId: input.membership?.id ?? null,
      kind,
      deviceId: input.device.deviceId,
      deviceLabel: input.device.deviceLabel,
      familyId: input.familyId,
      replaces: input.replaces,
    });
    return {
      pair: {
        accessToken,
        accessTokenExpiresIn: this.tokens.accessTtlSeconds,
        membership: input.membership ? this.toSummary(input.membership) : null,
        memberships: input.all.map((m) => this.toSummary(m)),
      },
      refresh,
    };
  }
}
