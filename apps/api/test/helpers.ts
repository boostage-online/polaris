import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { Pool } from 'pg';
import type { SystemRoleCode } from '@polaris/contracts';
import { createApp } from '../src/bootstrap';
import { LogEmailGateway, LogSmsGateway, RedisService } from '../src/modules/shared';
import { DEMO_PASSWORD, type SeedResult } from '../src/seed/seed';
import { SEED_FILE, TEST_APP_URL, TEST_OWNER_URL } from './global-setup';

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = TEST_APP_URL;
process.env['DATABASE_URL_PLATFORM'] = TEST_OWNER_URL;
process.env['REDIS_URL'] ??= 'redis://localhost:6379';
process.env['LOG_LEVEL'] = 'silent';
process.env['ACCESS_TOKEN_TTL_SECONDS'] = '600';

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
  await app.init();
  const redis = app.get(RedisService);
  await redis.client.flushdb();
  const owner = new Pool({ connectionString: TEST_OWNER_URL, max: 3 });
  return {
    app,
    http: request(app.getHttpServer() as Parameters<typeof request>[0]),
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
  const res = await ctx.http
    .post('/api/v1/auth/login')
    .set('X-Client', 'test/1.0')
    .send({ identifier: email, password, deviceId: 'test-device-0001' });
  if (res.status !== 200)
    throw new Error(`login ${email} → ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as {
    data: { accessToken: string; refreshToken: string; membership: { id: string } | null };
  };
  return {
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
    membershipId: body.data.membership?.id ?? null,
  };
}

export function loginAs(ctx: TestContext, tenant: 'lycee' | 'univ', role: SystemRoleCode) {
  return login(ctx, seed.tenants[tenant].users[role].email);
}
export function loginPlatform(ctx: TestContext) {
  return login(ctx, seed.platformAdmin.email);
}

export const bearer = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });
