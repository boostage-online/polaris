import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { bearer, loginAs, loginPlatform, seed, startApp, type TestContext } from './helpers';
import { WorkerModule } from '../src/worker/worker.module';
import { OutboxRelayService, DOMAIN_EVENTS_QUEUE } from '../src/worker/outbox-relay.service';
import { DomainEventsProcessor } from '../src/worker/domain-events.processor';
import { LogEmailGateway, RedisService } from '../src/modules/shared';
import type { Job } from 'bullmq';

describe('Plateforme, outbox, idempotence', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(() => ctx.close());

  it('un administrateur tenant ne voit pas les routes plateforme (404)', async () => {
    const a = await loginAs(ctx, 'lycee', 'ADMIN');
    expect((await ctx.http.get('/api/v1/platform/tenants').set(bearer(a))).status).toBe(404);
  });

  it('création de tenant : rôles système copiés, audit, événement outbox, invitation admin', async () => {
    const p = await loginPlatform(ctx);
    const res = await ctx.http
      .post('/api/v1/platform/tenants')
      .set(bearer(p))
      .send({
        code: 'college-test',
        name: 'Collège Test',
        type: 'SCHOOL',
        adminEmail: 'dir@college-test.local',
      });
    expect(res.status).toBe(201);
    const tenantId = res.body.data.id as string;
    expect(res.body.data.adminInvitation.email).toBe('dir@college-test.local');
    const roles = await ctx.owner.query(
      `select system_code from roles where tenant_id = $1 order by system_code`,
      [tenantId],
    );
    expect(roles.rows.map((r) => r.system_code)).toEqual([
      'ACADEMIC_HEAD',
      'ADMIN',
      'DIRECTION',
      'FINANCE',
      'REGISTRAR',
      'STUDENT_LIFE',
      'TEACHER',
    ]);
    const audit = await ctx.owner.query(
      `select action from audit_logs where tenant_id = $1 order by occurred_at`,
      [tenantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['tenant.created', 'member.invited']),
    );
    const ob = await ctx.owner.query(`select event_type from outbox_events where tenant_id = $1`, [
      tenantId,
    ]);
    expect(ob.rows.map((r) => r.event_type)).toEqual(
      expect.arrayContaining(['TenantCreated', 'UserInvited']),
    );
  });

  it('suspendre un tenant coupe ses membres en moins de 30 s (cache invalidé immédiatement)', async () => {
    const p = await loginPlatform(ctx);
    const a = await loginAs(ctx, 'lycee', 'ADMIN');
    expect((await ctx.http.get('/api/v1/tenant').set(bearer(a))).status).toBe(200);
    const sus = await ctx.http
      .patch(`/api/v1/platform/tenants/${seed.tenants.lycee.id}/status`)
      .set(bearer(p))
      .send({ status: 'SUSPENDED', reason: 'impayé' });
    expect(sus.status).toBe(200);
    const blocked = await ctx.http.get('/api/v1/tenant').set(bearer(a));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TENANT_SUSPENDED');
    await ctx.http
      .patch(`/api/v1/platform/tenants/${seed.tenants.lycee.id}/status`)
      .set(bearer(p))
      .send({ status: 'ACTIVE' });
    expect((await ctx.http.get('/api/v1/tenant').set(bearer(a))).status).toBe(200);
  });

  it('Idempotency-Key : même clé → même réponse sans second effet ; corps différent → 422', async () => {
    const p = await loginPlatform(ctx);
    const key = randomUUID();
    const body = { code: `idem-${Date.now()}`, name: 'Idempotent', type: 'SCHOOL' };
    const r1 = await ctx.http
      .post('/api/v1/platform/tenants')
      .set(bearer(p))
      .set('Idempotency-Key', key)
      .send(body);
    const r2 = await ctx.http
      .post('/api/v1/platform/tenants')
      .set(bearer(p))
      .set('Idempotency-Key', key)
      .send(body);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.body.data.id).toBe(r1.body.data.id);
    const { rows } = await ctx.owner.query(
      `select count(*)::int as n from tenants where code = $1`,
      [body.code],
    );
    expect(rows[0].n).toBe(1);
    const r3 = await ctx.http
      .post('/api/v1/platform/tenants')
      .set(bearer(p))
      .set('Idempotency-Key', key)
      .send({ ...body, name: 'Autre' });
    expect(r3.status).toBe(422);
    expect(r3.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it("une transaction annulée n'écrit ni audit ni événement (atomicité outbox)", async () => {
    const p = await loginPlatform(ctx);
    const before = await ctx.owner.query(`select count(*)::int as n from outbox_events`);
    const res = await ctx.http
      .post('/api/v1/platform/tenants')
      .set(bearer(p))
      .send({ code: 'lycee-demo', name: 'Doublon', type: 'SCHOOL' });
    expect(res.status).toBe(409);
    const after = await ctx.owner.query(`select count(*)::int as n from outbox_events`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('worker : le relais publie dans BullMQ, le processeur envoie l’e-mail une seule fois même rejoué', async () => {
    const worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    await worker.init();
    try {
      const relay = worker.get(OutboxRelayService);
      const processor = worker.get(DomainEventsProcessor);
      const email = worker.get(LogEmailGateway);
      const redis = worker.get(RedisService);

      const published = await relay.drain();
      expect(published).toBeGreaterThan(0);
      const { rows } = await ctx.owner.query(
        `select count(*)::int as n from outbox_events where published_at is null`,
      );
      expect(rows[0].n).toBe(0);

      const q = new Queue(DOMAIN_EVENTS_QUEUE, { connection: redis.duplicate() });
      const jobs = await q.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
      const invitation = jobs.find((j) => j.name === 'UserInvited');
      expect(invitation).toBeDefined();
      const sentBefore = email.sent.length;
      await processor.process(invitation as Job);
      await processor.process(invitation as Job); // rejeu
      expect(email.sent.length).toBe(sentBefore + 1);
      expect(email.sent.at(-1)!.text).toContain('/invitation?token=');
      await q.close();
    } finally {
      await worker.close();
    }
  });

  it('readiness et métriques répondent', async () => {
    const ready = await ctx.http.get('/api/v1/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks).toEqual({ database: true, redis: true, migrations: true });
    const metrics = await ctx.http.get('/api/v1/metrics');
    expect(metrics.text).toContain('polaris_http_request_duration_seconds');
  });
});
