import {
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

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE';
export type ExcuseStatus = 'NONE' | 'PENDING' | 'EXCUSED' | 'REJECTED';
export type SheetStatus = 'DRAFT' | 'SUBMITTED' | 'LOCKED';
export type JustificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED';
export type NotificationChannel = 'SMS' | 'EMAIL' | 'PUSH' | 'INAPP';
export type NotificationStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED';

export const attendanceSheets = pgTable('attendance_sheets', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  status: text('status').$type<SheetStatus>().notNull(),
  version: integer('version').notNull(),
  retroactive: boolean('retroactive').notNull(),
  openedBy: uuid('opened_by'),
  submittedBy: uuid('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const attendanceRecords = pgTable('attendance_records', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  sheetId: uuid('sheet_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  studentId: uuid('student_id').notNull(),
  status: text('status').$type<AttendanceStatus>().notNull(),
  excuseStatus: text('excuse_status').$type<ExcuseStatus>().notNull(),
  lateMinutes: integer('late_minutes'),
  leftEarlyAt: timestamp('left_early_at', { withTimezone: true }),
  note: text('note'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const attendanceRecordRevisions = pgTable('attendance_record_revisions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  recordId: uuid('record_id').notNull(),
  beforeStatus: text('before_status').$type<AttendanceStatus>().notNull(),
  afterStatus: text('after_status').$type<AttendanceStatus>().notNull(),
  beforeLateMinutes: integer('before_late_minutes'),
  afterLateMinutes: integer('after_late_minutes'),
  reason: text('reason').notNull(),
  outOfWindow: boolean('out_of_window').notNull(),
  authorId: uuid('author_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const absenceJustifications = pgTable('absence_justifications', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  studentId: uuid('student_id').notNull(),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  reason: text('reason').notNull(),
  documentKey: text('document_key'),
  status: text('status').$type<JustificationStatus>().notNull(),
  submittedBy: uuid('submitted_by'),
  submittedByKind: text('submitted_by_kind').$type<'STAFF' | 'GUARDIAN'>().notNull(),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewComment: text('review_comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const justificationRecords = pgTable(
  'justification_records',
  {
    tenantId: uuid('tenant_id').notNull(),
    justificationId: uuid('justification_id').notNull(),
    recordId: uuid('record_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.justificationId, t.recordId] })],
);

export const attendanceDailyStats = pgTable(
  'attendance_daily_stats',
  {
    tenantId: uuid('tenant_id').notNull(),
    studentId: uuid('student_id').notNull(),
    day: date('day').notNull(),
    sessions: integer('sessions').notNull(),
    present: integer('present').notNull(),
    absent: integer('absent').notNull(),
    late: integer('late').notNull(),
    excused: integer('excused').notNull(),
    unjustified: integer('unjustified').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.studentId, t.day] })],
);

export const attendanceAlerts = pgTable('attendance_alerts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  studentId: uuid('student_id').notNull(),
  kind: text('kind').$type<'REPEATED_ABSENCES'>().notNull(),
  windowFrom: date('window_from').notNull(),
  windowTo: date('window_to').notNull(),
  count: integer('count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by'),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  eventId: text('event_id').notNull(),
  kind: text('kind').notNull(),
  channel: text('channel').$type<NotificationChannel>().notNull(),
  status: text('status').$type<NotificationStatus>().notNull(),
  recipientUserId: uuid('recipient_user_id').notNull(),
  recipientAddress: text('recipient_address'),
  studentId: uuid('student_id'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  actionUrl: text('action_url'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  attempts: integer('attempts').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
});

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    channels: text('channels').array().$type<NotificationChannel[]>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.kind] })],
);
