import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { ErrorCodes, SENSITIVE_PERMISSIONS, type MfaStatus } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import { mfaRecoveryCodes, refreshTokens, users } from '../../../database/schema';
import { AuditService } from '../../audit';
import { LocalKeyWrapper, RedisService, openSecrets, sealSecrets } from '../../shared';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from '../domain/totp';
import { hashToken } from '../domain/tokens';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { LockoutService } from './lockout.service';
import { SessionService, type DeviceInfo, type IssuedSession } from './session.service';
import { TokenService } from './token.service';

const PENDING_TTL_SECONDS = 600;
const ISSUER = 'Polaris';
const invalidCode = () => AppError.validation([{ path: 'code', message: 'Code incorrect' }]);

/**
 * MFA TOTP (ADR-0008, Partie 11) : enrôlement en deux temps (secret provisoire en Redis, activé par un
 * premier code valide), codes de récupération à usage unique, défi de connexion signé (5 min, usage unique),
 * anti-rejeu du code TOTP (un compteur accepté ne l'est plus pendant 90 s). Le secret est chiffré par enveloppe.
 */
@Injectable()
export class MfaService {
  private readonly wrapper: LocalKeyWrapper;

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly repo: IdentityRepository,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly lockout: LockoutService,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.wrapper = new LocalKeyWrapper(env.APP_MASTER_KEY ?? env.PAYMENT_MASTER_KEY);
  }

  // ------------------------------------------------------------------ état et exigence

  /** La MFA est exigée pour un super admin et pour tout membre détenant une permission sensible. */
  static required(kind: string | null, permissions: string[]): boolean {
    if (kind === 'PLATFORM') return true;
    return permissions.some((p) => (SENSITIVE_PERMISSIONS as readonly string[]).includes(p));
  }

  async status(
    userId: string,
    kind: string | null,
    permissions: string[],
    sessionVerified: boolean,
  ): Promise<MfaStatus> {
    return this.db.withIdentityTx(async (tx) => {
      const user = await this.repo.findUserById(tx, userId);
      if (!user) throw AppError.unauthenticated();
      const left = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from mfa_recovery_codes where user_id = ${userId} and used_at is null`,
      );
      return {
        enabled: user.mfaEnabled,
        enrolledAt: user.mfaEnrolledAt?.toISOString() ?? null,
        required: MfaService.required(kind, permissions),
        sessionVerified,
        recoveryCodesLeft: left.rows[0]?.n ?? 0,
      };
    });
  }

  // ------------------------------------------------------------------ enrôlement

  async setup(userId: string) {
    const user = await this.db.withIdentityTx((tx) => this.repo.findUserById(tx, userId));
    if (!user) throw AppError.unauthenticated();
    const secret = generateTotpSecret();
    await this.redis.client.set(`mfa:pending:${userId}`, secret, 'EX', PENDING_TTL_SECONDS);
    const account = user.email ?? user.phoneE164 ?? userId;
    return { secret, otpauthUrl: otpauthUrl(ISSUER, account, secret), issuer: ISSUER, account };
  }

  /**
   * Active la MFA après un premier code valide. La famille de refresh courante (cookie) est marquée
   * « MFA vérifiée » : le prochain `/auth/refresh` émet un access token porteur du claim `mfa`.
   */
  async enable(userId: string, code: string, currentRefresh: string | null) {
    const pending = await this.redis.client.get(`mfa:pending:${userId}`);
    if (!pending)
      throw AppError.validation([
        { path: 'code', message: 'Aucun enrôlement en cours : relancez la configuration' },
      ]);
    const counter = verifyTotp(pending, code);
    if (counter === null) throw AppError.validation([{ path: 'code', message: 'Code incorrect' }]);
    const recovery = generateRecoveryCodes();
    await this.db.withIdentityTx(async (tx) => {
      await tx
        .update(users)
        .set({
          mfaEnabled: true,
          mfaSecretEncrypted: sealSecrets(this.wrapper, { secret: pending }),
          mfaEnrolledAt: new Date(),
        })
        .where(eq(users.id, userId));
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
      await tx.insert(mfaRecoveryCodes).values(
        recovery.map((c) => ({
          id: randomUUID(),
          userId,
          codeHash: this.hashRecovery(userId, c),
          usedAt: null,
          createdAt: new Date(),
        })),
      );
      if (currentRefresh) {
        const row = await this.repo.findRefreshByHash(tx, hashToken(currentRefresh));
        if (row)
          await tx
            .update(refreshTokens)
            .set({ mfaVerified: true })
            .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      }
      await this.audit.record({
        action: 'auth.mfa_enabled',
        entityType: 'User',
        entityId: userId,
        tenantId: null,
        actorUserId: userId,
      });
    });
    await this.redis.client.del(`mfa:pending:${userId}`);
    await this.markUsed(userId, counter);
    return { enabled: true as const, recoveryCodes: recovery };
  }

  async disable(userId: string, input: { code?: string; recoveryCode?: string }) {
    await this.db.withIdentityTx(async (tx) => {
      const user = await this.repo.findUserById(tx, userId);
      if (!user?.mfaEnabled) throw AppError.conflict("La MFA n'est pas activée");
      await this.checkFactor(tx, user, input, invalidCode);
      await tx
        .update(users)
        .set({ mfaEnabled: false, mfaSecretEncrypted: null, mfaEnrolledAt: null })
        .where(eq(users.id, userId));
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
      await tx
        .update(refreshTokens)
        .set({ mfaVerified: false })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      await this.audit.record({
        action: 'auth.mfa_disabled',
        entityType: 'User',
        entityId: userId,
        tenantId: null,
        actorUserId: userId,
      });
    });
    return { enabled: false as const };
  }

  /** Régénère les codes de récupération (les anciens sont invalidés) après preuve d'un facteur. */
  async regenerateRecoveryCodes(userId: string, input: { code?: string; recoveryCode?: string }) {
    const recovery = generateRecoveryCodes();
    await this.db.withIdentityTx(async (tx) => {
      const user = await this.repo.findUserById(tx, userId);
      if (!user?.mfaEnabled) throw AppError.conflict("La MFA n'est pas activée");
      await this.checkFactor(tx, user, input, invalidCode);
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
      await tx.insert(mfaRecoveryCodes).values(
        recovery.map((c) => ({
          id: randomUUID(),
          userId,
          codeHash: this.hashRecovery(userId, c),
          usedAt: null,
          createdAt: new Date(),
        })),
      );
      await this.audit.record({
        action: 'auth.mfa_recovery_regenerated',
        entityType: 'User',
        entityId: userId,
        tenantId: null,
        actorUserId: userId,
      });
    });
    return { recoveryCodes: recovery };
  }

  // ------------------------------------------------------------------ défi de connexion

  async issueChallenge(input: {
    userId: string;
    device: DeviceInfo;
    preferredMembershipId?: string | null;
  }) {
    const c = await this.tokens.signMfaChallenge({
      sub: input.userId,
      deviceId: input.device.deviceId,
      deviceLabel: input.device.deviceLabel,
      preferredMembershipId: input.preferredMembershipId ?? null,
    });
    await this.redis.client.set(`mfa:challenge:${c.jti}`, '1', 'EX', c.expiresIn);
    return { mfaRequired: true as const, challenge: c.token, expiresIn: c.expiresIn };
  }

  /** Relève le défi (TOTP ou code de récupération) et ouvre la session, marquée MFA. */
  async verifyChallenge(input: {
    challenge: string;
    code?: string;
    recoveryCode?: string;
  }): Promise<IssuedSession> {
    const ch = await this.tokens.verifyMfaChallenge(input.challenge);
    const ip = RequestContextStore.get()?.ip ?? null;
    const lockKey = `mfa:${ch.sub}`;
    await this.lockout.assertNotLocked(lockKey, ip);
    const live = await this.redis.client.get(`mfa:challenge:${ch.jti}`);
    if (!live)
      throw AppError.unauthenticated('Défi MFA invalide ou expiré', ErrorCodes.MFA_REQUIRED);

    return this.db.withIdentityTx(async (tx) => {
      const user = await this.repo.findUserById(tx, ch.sub);
      if (!user || user.status !== 'ACTIVE' || !user.mfaEnabled)
        throw AppError.unauthenticated('Défi MFA invalide ou expiré', ErrorCodes.MFA_REQUIRED);
      try {
        await this.checkFactor(tx, user, input, () =>
          AppError.unauthenticated('Code MFA incorrect', ErrorCodes.MFA_REQUIRED),
        );
      } catch (e) {
        await this.lockout.recordFailure(lockKey, ip, 'mfa_invalid');
        throw e;
      }
      await this.lockout.reset(lockKey);
      await this.redis.client.del(`mfa:challenge:${ch.jti}`);
      const all = await this.repo.listMemberships(user.id);
      const membership = this.sessions.pickMembership(all, ch.preferredMembershipId);
      await this.repo.touchLogin(tx, user.id);
      await this.audit.record({
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        tenantId: membership?.tenant?.id ?? null,
        actorUserId: user.id,
        metadata: {
          method: input.recoveryCode ? 'password+recovery' : 'password+totp',
          membershipId: membership?.id ?? null,
        },
      });
      return this.sessions.issue(tx, {
        userId: user.id,
        membership,
        all,
        device: { deviceId: ch.deviceId, deviceLabel: ch.deviceLabel },
        mfa: true,
      });
    });
  }

  // ------------------------------------------------------------------ interne

  /** Vérifie un code TOTP (anti-rejeu) ou consomme un code de récupération ; lève `onFail()` sinon. */
  private async checkFactor(
    tx: Db,
    user: typeof users.$inferSelect,
    input: { code?: string; recoveryCode?: string },
    onFail: () => AppError,
  ) {
    if (input.code) {
      const secret = openSecrets<{ secret: string }>(this.wrapper, user.mfaSecretEncrypted!).secret;
      const counter = verifyTotp(secret, input.code);
      if (counter === null || (await this.wasUsed(user.id, counter))) throw onFail();
      await this.markUsed(user.id, counter);
      return;
    }
    if (input.recoveryCode) {
      const hash = this.hashRecovery(user.id, input.recoveryCode);
      const res = await tx.execute(
        sql`update mfa_recovery_codes set used_at = now() where user_id = ${user.id} and code_hash = ${hash} and used_at is null`,
      );
      if (!res.rowCount) throw onFail();
      return;
    }
    throw AppError.validation([{ path: 'code', message: 'Code requis' }]);
  }

  private hashRecovery(userId: string, code: string) {
    return createHash('sha256')
      .update(`${userId}:${normalizeRecoveryCode(code)}`)
      .digest('hex');
  }
  private async wasUsed(userId: string, counter: number) {
    return (await this.redis.client.exists(`mfa:used:${userId}:${counter}`)) === 1;
  }
  private async markUsed(userId: string, counter: number) {
    await this.redis.client.set(`mfa:used:${userId}:${counter}`, '1', 'EX', 90);
  }
}
