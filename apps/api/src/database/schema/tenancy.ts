import { boolean, char, date, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  type: text('type').$type<'SCHOOL' | 'UNIVERSITY' | 'TRAINING_CENTER'>().notNull(),
  status: text('status').$type<'TRIAL' | 'ACTIVE' | 'SUSPENDED'>().notNull(),
  timezone: text('timezone').notNull(),
  country: char('country', { length: 2 }).notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  suspensionReason: text('suspension_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  /** Lancement (Phase 8). */
  plan: text('plan').$type<'PILOT' | 'STANDARD' | 'PREMIUM'>().notNull(),
  liveAt: timestamp('live_at', { withTimezone: true }),
  hypercareUntil: timestamp('hypercare_until', { withTimezone: true }),
  launchChecklist: jsonb('launch_checklist').$type<Record<string, unknown>>().notNull(),
});

export const campuses = pgTable('campuses', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  address: text('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const academicYears = pgTable('academic_years', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  label: text('label').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  isCurrent: boolean('is_current').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const terms = pgTable('terms', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  academicYearId: uuid('academic_year_id').notNull(),
  label: text('label').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
