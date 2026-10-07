import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id'),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  attempts: integer('attempts').notNull(),
});

export const processedEvents = pgTable(
  'processed_events',
  {
    handler: text('handler').notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.handler, t.eventId] })],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').$type<'IN_PROGRESS' | 'COMPLETED'>().notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

/** Alertes de supervision (plateforme, hors tenant) : une ligne ouverte par clé. */
export const platformAlerts = pgTable('platform_alerts', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull(),
  severity: text('severity').$type<'WARNING' | 'CRITICAL'>().notNull(),
  title: text('title').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull(),
  tenantId: uuid('tenant_id'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  acknowledgedBy: uuid('acknowledged_by'),
});
