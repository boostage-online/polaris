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
 * 90 s) : on évite les compteurs déjà consommés par ce processus, on essaie la fenêtre courante puis ±1, et en
 * dernier recours on attend la fenêtre suivante (plusieurs fichiers de tests se connectent avec les mêmes comptes).
 */
const usedTotpCounters = new Map<string, Set<number>>();
export async function solveMfa(
  ctx: TestContext,
  email: string,
  challenge: string,
  secret = DEMO_MFA_SECRET,
) {
  const key = Buffer.from(secret).toString('base64');
  const used = usedTotpCounters.get(email) ?? new Set<number>();
  usedTotpCounters.set(email, used);
  for (let attempt = 0; attempt < 6; attempt++) {
    const now = totpCounter();
    const candidates = [now, now + 1, now - 1].filter((c) => !used.has(c));
    for (const c of candidates) {
      used.add(c);
      const res = await ctx.http
        .post('/api/v1/auth/mfa/verify')
        .set('X-Client', 'test/1.0')
        .send({ challenge, code: hotp(base32Decode(secret), c) });
      if (res.status === 200) return res;
      if (res.status !== 401)
        throw new Error(`mfa ${email} (${key}) → ${res.status} ${JSON.stringify(res.body)}`);
    }
    // Tous les codes de la fenêtre ont servi : attendre la fenêtre suivante.
    const wait = 30_000 - (Date.now() % 30_000) + 250;
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(`mfa ${email} : impossible de relever le défi`);
}

export function loginAs(ctx: TestContext, tenant: 'lycee' | 'univ', role: SystemRoleCode) {
  return login(ctx, seed.tenants[tenant].users[role].email);
}
export function loginPlatform(ctx: TestContext) {
  return login(ctx, seed.platformAdmin.email);
}

export const bearer = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });
