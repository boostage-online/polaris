import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { Pool } from 'pg';
import type { SystemRoleCode } from '@polaris/contracts';
import { createApp } from '../src/bootstrap';
import { LogEmailGateway, LogSmsGateway, RedisService } from '../src/modules/shared';
import { base32Decode, hotp, totpCounter } from '../src/modules/identity/domain/totp';
import { DEMO_MFA_SECRET, DEMO_PASSWORD, type SeedResult } from '../src/seed/seed';
import { SEED_FILE, TEST_APP_URL, TEST_OWNER_URL } from './global-setup';

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = TEST_APP_URL;
process.env['DATABASE_URL_PLATFORM'] = TEST_OWNER_URL;
process.env['REDIS_URL'] ??= 'redis://localhost:6379';
process.env['LOG_LEVEL'] = 'silent';
process.env['ACCESS_TOKEN_TTL_SECONDS'] = '600';
// La matrice de permissions joue chaque route pour chaque rôle : bien au-delà du plafond de production.
process.env['RATE_LIMIT_GLOBAL_PER_MINUTE'] = '100000';

export const seed: SeedResult = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as SeedResult;

export interface TestContext {
  app: INestApplication;
  http: ReturnType<typeof request>;
  sms: LogSmsGateway;
  email: LogEmailGateway;
  owner: Pool;
  redis: RedisService;
  close(): Promise<void>;
}

export async function startApp(): Promise<TestContext> {
  const app = await createApp();
  // Le serveur écoute réellement : supertest ne gère alors pas son cycle de vie (évite la course
  // « address of null » quand il ferme/rouvre le serveur entre deux requêtes).
  await app.listen(0, '127.0.0.1');
  const redis = app.get(RedisService);
  await redis.client.flushdb();
  const owner = new Pool({ connectionString: TEST_OWNER_URL, max: 3 });
  return {
    app,
    http: request(app.getHttpServer()),
    sms: app.get(LogSmsGateway),
    email: app.get(LogEmailGateway),
    owner,
    redis,
    close: async () => {
      await owner.end();
      await app.close();
    },
  };
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  membershipId: string | null;
}

/** Connexion « mobile » (refresh dans le corps) pour un utilisateur seedé. */
export async function login(
  ctx: TestContext,
  email: string,
  password = DEMO_PASSWORD,
): Promise<Session> {
  let res = await ctx.http
    .post('/api/v1/auth/login')
    .set('X-Client', 'test/1.0')
    .send({ identifier: email, password, deviceId: 'test-device-0001' });
  if (res.status !== 200)
    throw new Error(`login ${email} → ${res.status} ${JSON.stringify(res.body)}`);
  // Comptes avec MFA (super admin, administrateur, finance) : relever le défi avec le secret de démonstration.
  if ((res.body as { data: { mfaRequired?: boolean } }).data.mfaRequired) {
    const challenge = (res.body as { data: { challenge: string } }).data.challenge;
    res = await solveMfa(ctx, email, challenge);
  }
  const body = res.body as {
    data: { accessToken: string; refreshToken: string; membership: { id: string } | null };
  };
  return {
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
    membershipId: body.data.membership?.id ?? null,
  };
}

/**
 * Relève un défi MFA avec le secret de démonstration. L'API refuse la réutilisation d'un code TOTP (anti-rejeu,
 * 90 s) : pour les comptes seedés, les marqueurs Redis du compteur courant sont effacés avant l'essai (les tests
 * disposent de Redis), ce qui évite d'attendre la fenêtre suivante entre deux connexions rapprochées.
 */
export async function solveMfa(
  ctx: TestContext,
  email: string,
  challenge: string,
  secret = DEMO_MFA_SECRET,
): Promise<request.Response> {
  const userId = userIdOf(email);
  const tried: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = totpCounter();
    if (userId)
      await ctx.redis.client.del(
        `mfa:used:${userId}:${now - 1}`,
        `mfa:used:${userId}:${now}`,
        `mfa:used:${userId}:${now + 1}`,
      );
    const res = await ctx.http
      .post('/api/v1/auth/mfa/verify')
      .set('X-Client', 'test/1.0')
      .send({ challenge, code: hotp(base32Decode(secret), now) });
    if (res.status === 200) return res;
    tried.push(`${now}:${res.status}`);
    if (res.status !== 401)
      throw new Error(
        `mfa ${email} → ${res.status} ${JSON.stringify(res.body)} retry-after=${String(res.headers['retry-after'])} tried=${tried.join(',')}`,
      );
  }
  throw new Error(`mfa ${email} : impossible de relever le défi (${tried.join(',')})`);
}

function userIdOf(email: string): string | null {
  if (email === seed.platformAdmin.email) return seed.platformAdmin.userId;
  for (const t of Object.values(seed.tenants))
    for (const u of Object.values(t.users)) if (u.email === email) return u.userId;
  return null;
}

/**
 * Les comptes avec MFA (admin, finance, super admin) ne disposent que de trois codes TOTP par fenêtre de 30 s
 * (anti-rejeu) : leurs sessions sont réutilisées pendant 25 s au sein d'un même fichier de tests
 * (même application, donc mêmes clés JWT). `login()` reste toujours une connexion neuve.
 */
const mfaSessionCache = new WeakMap<TestContext, Map<string, { session: Session; at: number }>>();
async function cachedLogin(
  ctx: TestContext,
  email: string,
  mfaEnrolled: boolean,
): Promise<Session> {
  if (!mfaEnrolled) return login(ctx, email);
  const map = mfaSessionCache.get(ctx) ?? new Map<string, { session: Session; at: number }>();
  mfaSessionCache.set(ctx, map);
  const hit = map.get(email);
  if (hit && Date.now() - hit.at < 25_000) return { ...hit.session };
  const session = await login(ctx, email);
  map.set(email, { session, at: Date.now() });
  return { ...session };
}

export function loginAs(ctx: TestContext, tenant: 'lycee' | 'univ', role: SystemRoleCode) {
  const u = seed.tenants[tenant].users[role];
  return cachedLogin(ctx, u.email, u.mfaEnrolled);
}
export function loginPlatform(ctx: TestContext) {
  return cachedLogin(ctx, seed.platformAdmin.email, seed.platformAdmin.mfaEnrolled);
}

export const bearer = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });
