import {
  boolean,
  date,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const programs = pgTable('programs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const levels = pgTable('levels', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  programId: uuid('program_id').notNull(),
  name: text('name').notNull(),
  rank: integer('rank').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  academicYearId: uuid('academic_year_id').notNull(),
  levelId: uuid('level_id').notNull(),
  campusId: uuid('campus_id'),
  parentGroupId: uuid('parent_group_id'),
  name: text('name').notNull(),
  kind: text('kind').$type<'CLASS' | 'SUBGROUP'>().notNull(),
  capacity: integer('capacity'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const subjects = pgTable('subjects', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  levelId: uuid('level_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const staffProfiles = pgTable('staff_profiles', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  employeeNumber: text('employee_number'),
  title: text('title'),
  isTeacher: boolean('is_teacher').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const courseOfferings = pgTable('course_offerings', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  subjectId: uuid('subject_id').notNull(),
  groupId: uuid('group_id').notNull(),
  academicYearId: uuid('academic_year_id').notNull(),
  termId: uuid('term_id'),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const courseTeachers = pgTable(
  'course_teachers',
  {
    tenantId: uuid('tenant_id').notNull(),
    courseOfferingId: uuid('course_offering_id').notNull(),
    staffProfileId: uuid('staff_profile_id').notNull(),
    role: text('role').$type<'MAIN' | 'ASSISTANT'>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.courseOfferingId, t.staffProfileId] })],
);

export const scheduleSlots = pgTable('schedule_slots', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  courseOfferingId: uuid('course_offering_id').notNull(),
  weekday: smallint('weekday').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  room: text('room'),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  courseOfferingId: uuid('course_offering_id').notNull(),
  scheduleSlotId: uuid('schedule_slot_id'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  status: text('status').$type<'PLANNED' | 'HELD' | 'CANCELLED'>().notNull(),
  room: text('room'),
  cancelReason: text('cancel_reason'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
