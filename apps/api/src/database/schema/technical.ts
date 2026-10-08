import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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

/** Revue quotidienne de la plateforme (hypercare, Phase 8) : une ligne par jour. */
export const platformDailyReviews = pgTable('platform_daily_reviews', {
  day: date('day').primaryKey(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
  tenants: jsonb('tenants').$type<unknown[]>().notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: uuid('reviewed_by'),
  notes: text('notes'),
});

/** Sondes de disponibilité (une par minute, worker → /health/ready). */
export const availabilityChecks = pgTable('availability_checks', {
  id: uuid('id').primaryKey(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
  ok: boolean('ok').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  detail: text('detail'),
});

/** Consommation mensuelle par établissement (table tenant sous RLS forcée). */
export const tenantUsageMonthly = pgTable(
  'tenant_usage_monthly',
  {
    tenantId: uuid('tenant_id').notNull(),
    month: date('month').notNull(),
    activeStudents: integer('active_students').notNull(),
    guardians: integer('guardians').notNull(),
    guardiansActivated: integer('guardians_activated').notNull(),
    staffActive: integer('staff_active').notNull(),
    sheetsSubmitted: integer('sheets_submitted').notNull(),
    smsSent: integer('sms_sent').notNull(),
    emailsSent: integer('emails_sent').notNull(),
    onlinePayments: integer('online_payments').notNull(),
    onlineAmount: bigint('online_amount', { mode: 'number' }).notNull(),
    manualPayments: integer('manual_payments').notNull(),
    manualAmount: bigint('manual_amount', { mode: 'number' }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.month] })],
);
