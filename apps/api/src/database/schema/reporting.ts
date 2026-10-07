import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const money = (name: string) => bigint(name, { mode: 'number' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const reportAttendanceDaily = pgTable(
  'report_attendance_daily',
  {
    tenantId: uuid('tenant_id').notNull(),
    day: date('day').notNull(),
    groupId: uuid('group_id').notNull(),
    sessionsPlanned: integer('sessions_planned').notNull(),
    sessionsHeld: integer('sessions_held').notNull(),
    sheetsSubmitted: integer('sheets_submitted').notNull(),
    sheetsMissing: integer('sheets_missing').notNull(),
    records: integer('records').notNull(),
    present: integer('present').notNull(),
    absent: integer('absent').notNull(),
    late: integer('late').notNull(),
    excused: integer('excused').notNull(),
    unjustified: integer('unjustified').notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day, t.groupId] })],
);

export const reportFinanceDaily = pgTable(
  'report_finance_daily',
  {
    tenantId: uuid('tenant_id').notNull(),
    day: date('day').notNull(),
    channel: text('channel').notNull(),
    payments: integer('payments').notNull(),
    amount: money('amount').notNull(),
    reversedCount: integer('reversed_count').notNull(),
    reversedAmount: money('reversed_amount').notNull(),
    fees: money('fees').notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day, t.channel] })],
);

export const reportRefreshes = pgTable('report_refreshes', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  fromDay: date('from_day').notNull(),
  toDay: date('to_day').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  attendanceRows: integer('attendance_rows').notNull(),
  financeRows: integer('finance_rows').notNull(),
  error: text('error'),
});

export const scheduledReports = pgTable('scheduled_reports', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  reportKey: text('report_key').notNull(),
  cadence: text('cadence').$type<'WEEKLY' | 'MONTHLY'>().notNull(),
  dayOfPeriod: integer('day_of_period').notNull(),
  recipients: text('recipients').array().notNull(),
  filters: jsonb('filters').$type<Record<string, unknown>>().notNull(),
  enabled: boolean('enabled').notNull(),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const tenantExports = pgTable('tenant_exports', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  status: text('status').$type<'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'>().notNull(),
  requestedBy: uuid('requested_by'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  sizeBytes: money('size_bytes'),
  entries: jsonb('entries').$type<{ name: string; rows: number }[]>().notNull(),
  file: bytea('file'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
