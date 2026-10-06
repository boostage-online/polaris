import { z } from 'zod';
import { CursorQuerySchema, UuidSchema } from './common';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ attendue');
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure HH:MM attendue');
const Code = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'Lettres, chiffres, _ . -');

// --- Années et périodes ---
export const AcademicYearSchema = z.object({
  id: UuidSchema,
  label: z.string(),
  startDate: IsoDate,
  endDate: IsoDate,
  isCurrent: z.boolean(),
});
export const CreateAcademicYearSchema = z
  .object({
    label: z.string().min(2).max(40),
    startDate: IsoDate,
    endDate: IsoDate,
    isCurrent: z.boolean().default(false),
  })
  .refine((v) => v.endDate > v.startDate, {
    message: 'La fin doit être après le début',
    path: ['endDate'],
  });
export const UpdateAcademicYearSchema = z.object({
  label: z.string().min(2).max(40).optional(),
  startDate: IsoDate.optional(),
  endDate: IsoDate.optional(),
});
export const TermSchema = z.object({
  id: UuidSchema,
  academicYearId: UuidSchema,
  label: z.string(),
  startDate: IsoDate,
  endDate: IsoDate,
});
export const CreateTermSchema = z
  .object({ label: z.string().min(1).max(40), startDate: IsoDate, endDate: IsoDate })
  .refine((v) => v.endDate > v.startDate, {
    message: 'La fin doit être après le début',
    path: ['endDate'],
  });

// --- Programmes, niveaux, groupes, matières ---
export const ProgramSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  levels: z
    .array(z.object({ id: UuidSchema, name: z.string(), rank: z.number().int() }))
    .optional(),
});
export const CreateProgramSchema = z.object({ code: Code, name: z.string().min(2).max(120) });
export const UpdateProgramSchema = CreateProgramSchema.partial();
export const CreateLevelSchema = z.object({
  name: z.string().min(1).max(60),
  rank: z.number().int().min(0).max(100).default(0),
});
export const UpdateLevelSchema = CreateLevelSchema.partial();

export const GroupKindSchema = z.enum(['CLASS', 'SUBGROUP']);
export const GroupSchema = z.object({
  id: UuidSchema,
  academicYearId: UuidSchema,
  levelId: UuidSchema,
  levelName: z.string().optional(),
  programName: z.string().optional(),
  campusId: UuidSchema.nullable(),
  parentGroupId: UuidSchema.nullable(),
  name: z.string(),
  kind: GroupKindSchema,
  capacity: z.number().int().nullable(),
  studentCount: z.number().int().optional(),
});
export const CreateGroupSchema = z.object({
  academicYearId: UuidSchema,
  levelId: UuidSchema,
  name: z.string().min(1).max(60),
  kind: GroupKindSchema.default('CLASS'),
  parentGroupId: UuidSchema.nullable().optional(),
  campusId: UuidSchema.nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
});
export const UpdateGroupSchema = CreateGroupSchema.omit({ academicYearId: true }).partial();
export const GroupsQuerySchema = z.object({
  academicYearId: UuidSchema.optional(),
  kind: GroupKindSchema.optional(),
  levelId: UuidSchema.optional(),
});

export const SubjectSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  levelId: UuidSchema.nullable(),
});
export const CreateSubjectSchema = z.object({
  code: Code,
  name: z.string().min(1).max(120),
  levelId: UuidSchema.nullable().optional(),
});
export const UpdateSubjectSchema = CreateSubjectSchema.partial();

// --- Personnel, cours, emplois du temps, séances ---
export const StaffSchema = z.object({
  membershipId: UuidSchema,
  staffProfileId: UuidSchema.nullable(),
  userId: UuidSchema,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  isTeacher: z.boolean(),
  employeeNumber: z.string().nullable(),
  title: z.string().nullable(),
  roles: z.array(z.object({ id: UuidSchema, name: z.string() })),
});
export const UpdateStaffSchema = z.object({
  isTeacher: z.boolean().optional(),
  employeeNumber: z.string().max(40).nullable().optional(),
  title: z.string().max(80).nullable().optional(),
});

export const CourseTeacherSchema = z.object({
  staffProfileId: UuidSchema,
  membershipId: UuidSchema.optional(),
  displayName: z.string().nullable().optional(),
  role: z.enum(['MAIN', 'ASSISTANT']),
});
export const CourseSchema = z.object({
  id: UuidSchema,
  subjectId: UuidSchema,
  subjectName: z.string().optional(),
  groupId: UuidSchema,
  groupName: z.string().optional(),
  academicYearId: UuidSchema,
  termId: UuidSchema.nullable(),
  label: z.string().nullable(),
  teachers: z.array(CourseTeacherSchema),
  slots: z
    .array(
      z.object({
        id: UuidSchema,
        weekday: z.number().int(),
        startTime: z.string(),
        endTime: z.string(),
        room: z.string().nullable(),
        validFrom: IsoDate.nullable(),
        validTo: IsoDate.nullable(),
      }),
    )
    .optional(),
});
export const CreateCourseSchema = z.object({
  subjectId: UuidSchema,
  groupId: UuidSchema,
  termId: UuidSchema.nullable().optional(),
  label: z.string().max(120).nullable().optional(),
  teachers: z
    .array(
      z.object({ staffProfileId: UuidSchema, role: z.enum(['MAIN', 'ASSISTANT']).default('MAIN') }),
    )
    .default([]),
});
export const SetCourseTeachersSchema = z.object({
  teachers: z.array(
    z.object({ staffProfileId: UuidSchema, role: z.enum(['MAIN', 'ASSISTANT']).default('MAIN') }),
  ),
});
export const CoursesQuerySchema = z.object({
  academicYearId: UuidSchema.optional(),
  groupId: UuidSchema.optional(),
  teacherStaffProfileId: UuidSchema.optional(),
});

export const CreateScheduleSlotSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startTime: HHMM,
    endTime: HHMM,
    room: z.string().max(40).nullable().optional(),
    validFrom: IsoDate.nullable().optional(),
    validTo: IsoDate.nullable().optional(),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: "L'heure de fin doit suivre l'heure de début",
    path: ['endTime'],
  });

export const SessionStatusSchema = z.enum(['PLANNED', 'HELD', 'CANCELLED']);
export const ClassSessionSchema = z.object({
  id: UuidSchema,
  courseOfferingId: UuidSchema,
  subjectName: z.string().optional(),
  groupName: z.string().optional(),
  groupId: UuidSchema.optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  status: SessionStatusSchema,
  room: z.string().nullable(),
  cancelReason: z.string().nullable().optional(),
  teachers: z
    .array(z.object({ staffProfileId: UuidSchema, displayName: z.string().nullable() }))
    .optional(),
});
export const CreateSessionSchema = z
  .object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    room: z.string().max(40).nullable().optional(),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: 'La fin doit suivre le début',
    path: ['endsAt'],
  });
export const UpdateSessionSchema = z.object({
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  room: z.string().max(40).nullable().optional(),
  status: SessionStatusSchema.optional(),
  cancelReason: z.string().max(240).nullable().optional(),
});
export const SessionsQuerySchema = CursorQuerySchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  groupId: UuidSchema.optional(),
  courseOfferingId: UuidSchema.optional(),
  status: SessionStatusSchema.optional(),
});
export const GenerateSessionsSchema = z.object({
  horizonDays: z.number().int().min(1).max(60).default(14),
});

export type AcademicYear = z.infer<typeof AcademicYearSchema>;
export type Term = z.infer<typeof TermSchema>;
export type Program = z.infer<typeof ProgramSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
export type Staff = z.infer<typeof StaffSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type ClassSession = z.infer<typeof ClassSessionSchema>;
export type CreateAcademicYearInput = z.input<typeof CreateAcademicYearSchema>;
export type CreateGroupInput = z.input<typeof CreateGroupSchema>;
export type CreateCourseInput = z.input<typeof CreateCourseSchema>;
export type CreateScheduleSlotInput = z.input<typeof CreateScheduleSlotSchema>;
