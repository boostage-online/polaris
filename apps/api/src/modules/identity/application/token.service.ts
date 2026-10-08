import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
  type KeyLike,
} from 'jose';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../../../config/env';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '@polaris/contracts';
import type { AccessTokenClaims } from '../domain/tokens';

/** Access token JWT ES256, 10 minutes (ADR-0008). Pas de permissions dans le token. */
@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private privateKey!: KeyLike;
  private publicKey!: KeyLike;
  private kid!: string;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async onModuleInit() {
    if (this.env.JWT_PRIVATE_JWK && this.env.JWT_PUBLIC_JWK) {
      const priv = JSON.parse(this.env.JWT_PRIVATE_JWK) as JWK;
      const pub = JSON.parse(this.env.JWT_PUBLIC_JWK) as JWK;
      this.privateKey = (await importJWK(priv, 'ES256')) as KeyLike;
      this.publicKey = (await importJWK(pub, 'ES256')) as KeyLike;
      this.kid = priv.kid ?? this.env.JWT_KID;
      return;
    }
    if (this.env.NODE_ENV === 'production') throw new Error('Clés JWT manquantes en production');
    const pair = await generateKeyPair('ES256');
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    this.kid = `ephemeral-${randomUUID().slice(0, 8)}`;
    this.logger.warn('Clés JWT éphémères générées (dev/test) : les tokens expirent au redémarrage');
  }

  get accessTtlSeconds() {
    return this.env.ACCESS_TOKEN_TTL_SECONDS;
  }

  async signAccess(claims: AccessTokenClaims, ttlSeconds = this.accessTtlSeconds): Promise<string> {
    return new SignJWT({
      mid: claims.mid,
      tid: claims.tid,
      kind: claims.kind,
      pv: claims.pv,
      tv: claims.tv,
      mfa: claims.mfa,
      ...(claims.imp ? { imp: claims.imp, isid: claims.isid } : {}),
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.kid, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience('polaris-api')
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.privateKey);
  }

  /** Défi MFA (5 min) : prouve que le mot de passe a été vérifié, sans ouvrir de session. */
  async signMfaChallenge(input: {
    sub: string;
    deviceId?: string;
    deviceLabel?: string;
    preferredMembershipId?: string | null;
  }): Promise<{ token: string; jti: string; expiresIn: number }> {
    const jti = randomUUID();
    const expiresIn = 300;
    const token = await new SignJWT({
      did: input.deviceId ?? null,
      dlb: input.deviceLabel ?? null,
      pmid: input.preferredMembershipId ?? null,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.kid, typ: 'mfa+jwt' })
      .setSubject(input.sub)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience('polaris-mfa')
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.privateKey);
    return { token, jti, expiresIn };
  }

  async verifyMfaChallenge(token: string): Promise<{
    sub: string;
    jti: string;
    deviceId?: string;
    deviceLabel?: string;
    preferredMembershipId: string | null;
  }> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: this.env.JWT_ISSUER,
        audience: 'polaris-mfa',
        algorithms: ['ES256'],
        clockTolerance: 5,
      });
      return {
        sub: payload.sub!,
        jti: payload.jti!,
        deviceId: (payload['did'] as string | null) ?? undefined,
        deviceLabel: (payload['dlb'] as string | null) ?? undefined,
        preferredMembershipId: (payload['pmid'] as string | null) ?? null,
      };
    } catch {
      throw AppError.unauthenticated('Défi MFA invalide ou expiré', ErrorCodes.MFA_REQUIRED);
    }
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: this.env.JWT_ISSUER,
        audience: 'polaris-api',
        algorithms: ['ES256'],
        clockTolerance: 5,
      });
      return {
        sub: payload.sub!,
        mid: (payload['mid'] as string | null) ?? null,
        tid: (payload['tid'] as string | null) ?? null,
        kind: (payload['kind'] as AccessTokenClaims['kind']) ?? null,
        pv: Number(payload['pv'] ?? 0),
        tv: Number(payload['tv'] ?? 0),
        mfa: payload['mfa'] === true,
        imp: (payload['imp'] as string | null) ?? null,
        isid: (payload['isid'] as string | null) ?? null,
      };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'ERR_JWT_EXPIRED')
        throw AppError.unauthenticated('Session expirée', ErrorCodes.TOKEN_EXPIRED);
      throw AppError.unauthenticated('Jeton invalide');
    }
  }

  async publicJwks() {
    const jwk = await exportJWK(this.publicKey);
    return { keys: [{ ...jwk, kid: this.kid, use: 'sig', alg: 'ES256' }] };
  }
}
