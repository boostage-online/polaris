import { boolean, date, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const students = pgTable('students', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  matricule: text('matricule').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  birthDate: date('birth_date'),
  gender: text('gender').$type<'F' | 'M' | 'X'>(),
  photoKey: text('photo_key'),
  status: text('status').$type<'ACTIVE' | 'LEFT' | 'GRADUATED'>().notNull(),
  leftAt: date('left_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const enrollments = pgTable('enrollments', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  studentId: uuid('student_id').notNull(),
  groupId: uuid('group_id').notNull(),
  academicYearId: uuid('academic_year_id').notNull(),
  isPrimary: boolean('is_primary').notNull(),
  enrolledAt: date('enrolled_at').notNull(),
  leftAt: date('left_at'),
  leftReason: text('left_reason'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const guardians = pgTable('guardians', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phoneE164: text('phone_e164').notNull(),
  email: text('email'),
  preferredChannel: text('preferred_channel')
    .$type<'SMS' | 'PUSH' | 'EMAIL' | 'WHATSAPP'>()
    .notNull(),
  locale: text('locale').notNull(),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const studentGuardians = pgTable('student_guardians', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  studentId: uuid('student_id').notNull(),
  guardianId: uuid('guardian_id').notNull(),
  relationship: text('relationship').$type<'MOTHER' | 'FATHER' | 'TUTOR' | 'OTHER'>().notNull(),
  isPrimary: boolean('is_primary').notNull(),
  canViewAttendance: boolean('can_view_attendance').notNull(),
  canViewFinance: boolean('can_view_finance').notNull(),
  canPay: boolean('can_pay').notNull(),
  canJustify: boolean('can_justify').notNull(),
  linkedBy: uuid('linked_by'),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull(),
  unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
  unlinkedBy: uuid('unlinked_by'),
  unlinkReason: text('unlink_reason'),
});

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  kind: text('kind').$type<'STUDENTS' | 'GUARDIANS'>().notNull(),
  dryRun: boolean('dry_run').notNull(),
  status: text('status').$type<'RUNNING' | 'DONE' | 'FAILED'>().notNull(),
  rowsTotal: integer('rows_total').notNull(),
  rowsOk: integer('rows_ok').notNull(),
  rowsError: integer('rows_error').notNull(),
  report: jsonb('report').$type<unknown[]>().notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
