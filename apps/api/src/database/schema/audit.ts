import { inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id'),
  actorUserId: uuid('actor_user_id'),
  actorMembershipId: uuid('actor_membership_id'),
  impersonatedBy: uuid('impersonated_by'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  metadata: jsonb('metadata'),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
});
