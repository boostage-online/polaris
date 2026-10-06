import { Inject, Injectable } from '@nestjs/common';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { ErrorCodes, type LoginPasswordInput, type Me } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { otpCodes, users } from '../../../database/schema';
import { AuditService } from '../../audit';
import { SMS_GATEWAY, type SmsGateway } from '../../shared';
import { LockoutPolicy } from '../domain/policies';
import { generateOtpCode } from '../domain/tokens';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { PermissionCache } from '../infrastructure/permission.cache';
import { LockoutService } from './lockout.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { SessionService, type DeviceInfo, type IssuedSession } from './session.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly lockout: LockoutService,
    private readonly permCache: PermissionCache,
    private readonly audit: AuditService,
    @Inject(SMS_GATEWAY) private readonly sms: SmsGateway,
  ) {}

  /** Connexion par mot de passe (personnel). Réponse identique que le compte existe ou non. */
  async loginWithPassword(input: LoginPasswordInput): Promise<IssuedSession> {
    const ip = RequestContextStore.get()?.ip ?? null;
    await this.lockout.assertNotLocked(input.identifier, ip);

    return this.db.withIdentityTx(async (tx) => {
      const user = await this.repo.findUserByIdentifier(tx, input.identifier);
      const ok = await this.passwords.verify(user?.passwordHash ?? null, input.password);
      if (!user || !ok || user.status !== 'ACTIVE') {
        await this.lockout.recordFailure(
          input.identifier,
          ip,
          !user ? 'unknown_user' : 'bad_password',
        );
        throw AppError.unauthenticated(
          'Identifiant ou mot de passe incorrect',
          ErrorCodes.INVALID_CREDENTIALS,
        );
      }
      await this.lockout.reset(input.identifier);
      if (this.passwords.needsRehash(user.passwordHash!)) {
        await tx
          .update(users)
          .set({ passwordHash: await this.passwords.hash(input.password) })
          .where(eq(users.id, user.id));
      }
      const all = await this.repo.listMemberships(user.id);
      const membership = this.sessions.pickMembership(all);
      await this.repo.touchLogin(tx, user.id);
      await this.audit.record({
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        tenantId: membership?.tenant?.id ?? null,
        actorUserId: user.id,
        metadata: { method: 'password', membershipId: membership?.id ?? null },
      });
      return this.sessions.issue(tx, { userId: user.id, membership, all, device: input });
    });
  }

  /** Demande d'OTP SMS : toujours 200 (anti-énumération) ; SMS envoyé hors transaction. */
  async requestOtp(phone: string): Promise<void> {
    const ip = RequestContextStore.get()?.ip ?? null;
    await this.lockout.assertNotLocked(phone, ip);
    const code = await this.db.withIdentityTx(async (tx) => {
      const user = await this.repo.findUserByIdentifier(tx, phone);
      if (!user || user.status !== 'ACTIVE') return null;
      const recent = await tx.execute<{ n: string }>(
        sql`select count(*)::text as n from otp_codes where phone_e164 = ${phone} and created_at > now() - interval '1 hour'`,
      );
      if (Number(recent.rows[0]?.n ?? 0) >= LockoutPolicy.otpMaxSendsPerHour) return null;
      const code = generateOtpCode();
      await tx.insert(otpCodes).values({
        id: randomUUID(),
        phoneE164: phone,
        purpose: 'LOGIN',
        codeHash: this.hashOtp(phone, code),
        attempts: 0,
        expiresAt: new Date(Date.now() + LockoutPolicy.otpTtlSeconds * 1000),
        createdAt: new Date(),
      });
      return code;
    });
    if (code) {
      await this.sms.send({
        to: phone,
        body: `Polaris : votre code de connexion est ${code}. Valable 5 minutes.`,
        reference: 'otp',
      });
    }
  }

  async verifyOtp(input: { phone: string; code: string } & DeviceInfo): Promise<IssuedSession> {
    const ip = RequestContextStore.get()?.ip ?? null;
    await this.lockout.assertNotLocked(input.phone, ip);
    return this.db.withIdentityTx(async (tx) => {
      const otp = await tx.query.otpCodes.findFirst({
        where: and(
          eq(otpCodes.phoneE164, input.phone),
          isNull(otpCodes.consumedAt),
          sql`${otpCodes.expiresAt} > now()`,
        ),
        orderBy: desc(otpCodes.createdAt),
      });
      const valid =
        otp &&
        otp.attempts < LockoutPolicy.otpMaxAttempts &&
        otp.codeHash === this.hashOtp(input.phone, input.code);
      if (otp)
        await tx
          .update(otpCodes)
          .set({ attempts: otp.attempts + 1 })
          .where(eq(otpCodes.id, otp.id));
      if (!otp || !valid) {
        await this.lockout.recordFailure(input.phone, ip, 'otp_invalid');
        throw AppError.unauthenticated('Code invalide ou expiré', ErrorCodes.OTP_INVALID);
      }
      await tx.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, otp.id));
      const user = await this.repo.findUserByIdentifier(tx, input.phone);
      if (!user || user.status !== 'ACTIVE')
        throw AppError.unauthenticated('Code invalide ou expiré', ErrorCodes.OTP_INVALID);
      await this.lockout.reset(input.phone);
      const all = await this.repo.listMemberships(user.id);
      const membership = this.sessions.pickMembership(all);
      await this.repo.touchLogin(tx, user.id);
      await this.audit.record({
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        tenantId: membership?.tenant?.id ?? null,
        actorUserId: user.id,
        metadata: { method: 'otp' },
      });
      return this.sessions.issue(tx, { userId: user.id, membership, all, device: input });
    });
  }

  /** Rotation du refresh : nouveau couple, même famille, même membership (re-validé). */
  async refresh(rawToken: string, device: DeviceInfo): Promise<IssuedSession> {
    return this.db.withIdentityTx(async (tx) => {
      const row = await this.refreshTokens.consume(tx, rawToken);
      const user = await this.repo.findUserById(tx, row.userId);
      if (!user || user.status !== 'ACTIVE') throw AppError.unauthenticated();
      const all = await this.repo.listMemberships(user.id);
      const membership = this.sessions.pickMembership(all, row.membershipId);
      return this.sessions.issue(tx, {
        userId: user.id,
        membership,
        all,
        device: {
          deviceId: device.deviceId ?? row.deviceId ?? undefined,
          deviceLabel: device.deviceLabel ?? row.deviceLabel ?? undefined,
        },
        familyId: row.familyId,
        replaces: row.id,
      });
    });
  }

  /** Bascule d'établissement : nouveau couple de tokens sur la famille courante. */
  async switchMembership(
    userId: string,
    membershipId: string,
    currentRefresh: string | null,
    device: DeviceInfo,
  ): Promise<IssuedSession> {
    return this.db.withIdentityTx(async (tx) => {
      const all = await this.repo.listMemberships(userId);
      const target = all.find((m) => m.id === membershipId);
      if (!target) throw AppError.notFound('Appartenance');
      this.sessions.assertUsable(target);
      let familyId: string | undefined;
      let replaces: string | undefined;
      if (currentRefresh) {
        const row = await this.refreshTokens.consume(tx, currentRefresh);
        familyId = row.familyId;
        replaces = row.id;
      }
      await this.audit.record({
        action: 'auth.switch_membership',
        entityType: 'Membership',
        entityId: membershipId,
        tenantId: target.tenant?.id ?? null,
        actorUserId: userId,
      });
      return this.sessions.issue(tx, {
        userId,
        membership: target,
        all,
        device,
        familyId,
        replaces,
      });
    });
  }

  async logout(rawToken: string | null): Promise<void> {
    if (!rawToken) return;
    await this.db.withIdentityTx(async (tx) => {
      const row = await this.repo.findRefreshByHash(
        tx,
        createHash('sha256').update(rawToken).digest('hex'),
      );
      if (row) await this.refreshTokens.revokeFamily(tx, row.familyId, 'logout');
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.db.withIdentityTx(async (tx) => {
      const tv = await this.refreshTokens.revokeAllForUser(tx, userId, 'logout_all');
      await this.permCache.setTokenVersion(userId, tv);
      await this.audit.record({
        action: 'auth.logout_all',
        entityType: 'User',
        entityId: userId,
        tenantId: null,
        actorUserId: userId,
      });
    });
  }

  async revokeSession(userId: string, familyId: string): Promise<void> {
    await this.db.withIdentityTx(async (tx) => {
      const res = await tx.execute(
        sql`update refresh_tokens set revoked_at = now(), revoked_reason = 'user_revoked' where user_id = ${userId} and family_id = ${familyId} and revoked_at is null`,
      );
      if (!res.rowCount) throw AppError.notFound('Session');
    });
  }

  async me(userId: string, membershipId: string | null, permissions: string[]): Promise<Me> {
    return this.db.withIdentityTx(async (tx) => {
      const user = await this.repo.findUserById(tx, userId);
      if (!user) throw AppError.unauthenticated();
      const all = await this.repo.listMemberships(userId);
      const current = all.find((m) => m.id === membershipId) ?? null;
      return {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phoneE164,
          displayName: user.displayName,
          mfaEnabled: user.mfaEnabled,
        },
        membership: current ? this.sessions.toSummary(current) : null,
        memberships: all.map((m) => this.sessions.toSummary(m)),
        permissions,
        tenantTimezone: current?.tenant?.timezone ?? null,
      };
    });
  }

  listSessions(userId: string, currentRefresh: string | null) {
    return this.db.withIdentityTx(async (tx) => {
      const current = currentRefresh
        ? await this.repo.findRefreshByHash(
            tx,
            createHash('sha256').update(currentRefresh).digest('hex'),
          )
        : null;
      return this.refreshTokens.listSessions(tx, userId, current?.familyId ?? null);
    });
  }

  private hashOtp(phone: string, code: string) {
    return createHash('sha256').update(`${phone}:${code}`).digest('hex');
  }
}
