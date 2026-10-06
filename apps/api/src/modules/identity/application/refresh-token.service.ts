import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ErrorCodes } from '@polaris/contracts';
import { ENV, type Env } from '../../../config/env';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import { refreshTokens, users } from '../../../database/schema';
import { OutboxService, refreshTokenReuseDetected } from '../../shared';
import { generateOpaqueToken, hashToken } from '../domain/tokens';

export interface IssuedRefresh {
  token: string;
  familyId: string;
  expiresAt: Date;
}

/**
 * Refresh tokens opaques rotatifs (ADR-0008).
 *  - Un token = une ligne hachée, membre d'une famille (= un appareil).
 *  - Chaque usage remplace le token (`replaced_by`) ; réutiliser un token déjà remplacé ou révoqué
 *    signifie un vol présumé → toute la famille est révoquée et un événement est publié.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  ttlFor(kind: 'STAFF' | 'GUARDIAN' | 'PLATFORM' | null): number {
    const h = 3600_000;
    if (kind === 'GUARDIAN') return this.env.REFRESH_TOKEN_TTL_DAYS_GUARDIAN * 24 * h;
    if (kind === 'PLATFORM') return this.env.REFRESH_TOKEN_TTL_HOURS_PLATFORM * h;
    return this.env.REFRESH_TOKEN_TTL_DAYS_STAFF * 24 * h;
  }

  async issue(
    tx: Db,
    input: {
      userId: string;
      membershipId: string | null;
      kind: 'STAFF' | 'GUARDIAN' | 'PLATFORM' | null;
      deviceId?: string;
      deviceLabel?: string;
      familyId?: string;
      replaces?: string;
    },
  ): Promise<IssuedRefresh> {
    const ctx = RequestContextStore.get();
    const token = generateOpaqueToken();
    const familyId = input.familyId ?? randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlFor(input.kind));
    const [row] = await tx
      .insert(refreshTokens)
      .values({
        id: randomUUID(),
        userId: input.userId,
        membershipId: input.membershipId,
        familyId,
        tokenHash: hashToken(token),
        deviceId: input.deviceId ?? null,
        deviceLabel: input.deviceLabel ?? null,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent?.slice(0, 512) ?? null,
        expiresAt,
        createdAt: new Date(),
      })
      .returning({ id: refreshTokens.id });
    if (input.replaces && row) {
      await tx
        .update(refreshTokens)
        .set({ replacedBy: row.id, lastUsedAt: new Date() })
        .where(eq(refreshTokens.id, input.replaces));
    }
    return { token, familyId, expiresAt };
  }

  /** Valide et consomme un refresh ; renvoie la ligne (pour ré-émettre) ou lève 401. */
  async consume(tx: Db, rawToken: string) {
    const row = await tx.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, hashToken(rawToken)),
    });
    if (!row) throw AppError.unauthenticated('Session invalide', ErrorCodes.TOKEN_REVOKED);

    if (row.revokedAt || row.replacedBy) {
      // Réutilisation : vol présumé → révocation de toute la famille.
      await this.revokeFamily(tx, row.familyId, 'reuse_detected');
      await this.outbox.publish(
        refreshTokenReuseDetected({
          userId: row.userId,
          familyId: row.familyId,
          ip: RequestContextStore.get()?.ip ?? null,
        }),
      );
      throw AppError.unauthenticated(
        'Session révoquée par mesure de sécurité',
        ErrorCodes.TOKEN_REVOKED,
      );
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw AppError.unauthenticated('Session expirée', ErrorCodes.TOKEN_EXPIRED);
    }
    return row;
  }

  async revokeFamily(tx: Db, familyId: string, reason: string) {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  /** « Tous mes appareils » : révoque toutes les familles et invalide les access tokens via token_version. */
  async revokeAllForUser(tx: Db, userId: string, reason: string): Promise<number> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    const [u] = await tx
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, userId))
      .returning({ tokenVersion: users.tokenVersion });
    return u?.tokenVersion ?? 0;
  }

  async listSessions(tx: Db, userId: string, currentFamilyId: string | null) {
    const rows = await tx
      .select({
        familyId: refreshTokens.familyId,
        deviceLabel: refreshTokens.deviceLabel,
        createdAt: sql<Date>`min(${refreshTokens.createdAt})`,
        lastUsedAt: sql<Date>`max(coalesce(${refreshTokens.lastUsedAt}, ${refreshTokens.createdAt}))`,
      })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          sql`${refreshTokens.expiresAt} > now()`,
        ),
      )
      .groupBy(refreshTokens.familyId, refreshTokens.deviceLabel);
    return rows.map((r) => ({
      familyId: r.familyId,
      deviceLabel: r.deviceLabel,
      createdAt: new Date(r.createdAt).toISOString(),
      lastUsedAt: new Date(r.lastUsedAt).toISOString(),
      current: r.familyId === currentFamilyId,
    }));
  }

  async purgeExpired(tx: Db): Promise<number> {
    const res = await tx.execute(
      sql`delete from refresh_tokens where expires_at < now() - interval '30 days'`,
    );
    return res.rowCount ?? 0;
  }
}
