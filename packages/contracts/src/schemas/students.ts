import { z } from 'zod';
import { CursorQuerySchema, E164PhoneSchema, EmailSchema, UuidSchema } from './common';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ attendue');

export const StudentStatusSchema = z.enum(['ACTIVE', 'LEFT', 'GRADUATED']);
export const GenderSchema = z.enum(['F', 'M', 'X']);

export const EnrollmentSchema = z.object({
  id: UuidSchema,
  groupId: UuidSchema,
  groupName: z.string().optional(),
  groupKind: z.enum(['CLASS', 'SUBGROUP']).optional(),
  academicYearId: UuidSchema,
  academicYearLabel: z.string().optional(),
  isPrimary: z.boolean(),
  enrolledAt: IsoDate,
  leftAt: IsoDate.nullable(),
  leftReason: z.string().nullable().optional(),
});

export const StudentSchema = z.object({
  id: UuidSchema,
  matricule: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  birthDate: IsoDate.nullable(),
  gender: GenderSchema.nullable(),
  status: StudentStatusSchema,
  leftAt: IsoDate.nullable(),
  notes: z.string().nullable().optional(),
  currentGroup: z.object({ id: UuidSchema, name: z.string() }).nullable().optional(),
  guardianCount: z.number().int().optional(),
  enrollments: z.array(EnrollmentSchema).optional(),
});
export const CreateStudentSchema = z.object({
  matricule: z.string().min(1).max(40).optional(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  birthDate: IsoDate.nullable().optional(),
  gender: GenderSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /** Inscription immédiate dans une classe (groupe CLASS) de l'année courante. */
  groupId: UuidSchema.optional(),
});
export const UpdateStudentSchema = CreateStudentSchema.omit({ groupId: true }).partial();
export const StudentsQuerySchema = CursorQuerySchema.extend({
  q: z.string().max(80).optional(),
  groupId: UuidSchema.optional(),
  academicYearId: UuidSchema.optional(),
  status: StudentStatusSchema.optional(),
  incomplete: z.coerce.boolean().optional(),
});
export const EnrollStudentSchema = z.object({
  groupId: UuidSchema,
  enrolledAt: IsoDate.optional(),
});
export const TransferStudentSchema = z.object({
  toGroupId: UuidSchema,
  effectiveDate: IsoDate.optional(),
  reason: z.string().max(240).optional(),
});
export const CloseEnrollmentSchema = z.object({
  leftAt: IsoDate.optional(),
  reason: z.string().max(240).optional(),
});
export const LeaveStudentSchema = z.object({
  status: z.enum(['LEFT', 'GRADUATED']),
  leftAt: IsoDate.optional(),
  reason: z.string().max(240).optional(),
});

export const RelationshipSchema = z.enum(['MOTHER', 'FATHER', 'TUTOR', 'OTHER']);
export const GuardianLinkSchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  guardianId: UuidSchema,
  relationship: RelationshipSchema,
  isPrimary: z.boolean(),
  canViewAttendance: z.boolean(),
  canViewFinance: z.boolean(),
  canPay: z.boolean(),
  canJustify: z.boolean(),
  linkedAt: z.string().datetime(),
  student: z
    .object({ id: UuidSchema, firstName: z.string(), lastName: z.string(), matricule: z.string() })
    .optional(),
  guardian: z
    .object({
      id: UuidSchema,
      firstName: z.string(),
      lastName: z.string(),
      phone: z.string(),
      activated: z.boolean(),
    })
    .optional(),
});
export const GuardianSchema = z.object({
  id: UuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  phone: E164PhoneSchema,
  email: z.string().nullable(),
  preferredChannel: z.enum(['SMS', 'PUSH', 'EMAIL', 'WHATSAPP']),
  activated: z.boolean(),
  invitedAt: z.string().datetime().nullable(),
  links: z.array(GuardianLinkSchema).optional(),
});
export const CreateGuardianSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: E164PhoneSchema,
  email: EmailSchema.nullable().optional(),
  preferredChannel: z.enum(['SMS', 'PUSH', 'EMAIL', 'WHATSAPP']).default('SMS'),
});
export const UpdateGuardianSchema = CreateGuardianSchema.partial();
export const GuardiansQuerySchema = CursorQuerySchema.extend({
  q: z.string().max(80).optional(),
  activated: z.coerce.boolean().optional(),
});

const LinkFlags = {
  isPrimary: z.boolean().default(false),
  canViewAttendance: z.boolean().default(true),
  canViewFinance: z.boolean().default(true),
  canPay: z.boolean().default(true),
  canJustify: z.boolean().default(true),
};
export const LinkGuardianSchema = z
  .object({
    /** Tuteur existant… */
    guardianId: UuidSchema.optional(),
    /** …ou création à la volée (réutilisé si le téléphone existe déjà). */
    guardian: CreateGuardianSchema.optional(),
    relationship: RelationshipSchema,
    ...LinkFlags,
  })
  .refine((v) => Boolean(v.guardianId) !== Boolean(v.guardian), {
    message: 'guardianId ou guardian, pas les deux',
  });
export const UpdateLinkSchema = z.object({
  relationship: RelationshipSchema.optional(),
  isPrimary: z.boolean().optional(),
  canViewAttendance: z.boolean().optional(),
  canViewFinance: z.boolean().optional(),
  canPay: z.boolean().optional(),
  canJustify: z.boolean().optional(),
});
export const UnlinkGuardianSchema = z.object({ reason: z.string().min(3).max(240) });

/** Vue parent : ses enfants, avec les droits par lien. */
export const ChildSummarySchema = z.object({
  linkId: UuidSchema,
  student: z.object({
    id: UuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    matricule: z.string(),
    status: StudentStatusSchema,
  }),
  tenant: z.object({ id: UuidSchema, name: z.string(), code: z.string() }),
  currentGroup: z.object({ id: UuidSchema, name: z.string() }).nullable(),
  relationship: RelationshipSchema,
  rights: z.object({
    attendance: z.boolean(),
    finance: z.boolean(),
    pay: z.boolean(),
    justify: z.boolean(),
  }),
});

// --- Imports ---
export const ImportKindSchema = z.enum(['STUDENTS', 'GUARDIANS']);
export const ImportRowReportSchema = z.object({
  line: z.number().int(),
  status: z.enum(['OK', 'ERROR', 'WARNING']),
  message: z.string().optional(),
  key: z.string().optional(),
});
export const ImportJobSchema = z.object({
  id: UuidSchema,
  kind: ImportKindSchema,
  dryRun: z.boolean(),
  status: z.enum(['RUNNING', 'DONE', 'FAILED']),
  rowsTotal: z.number().int(),
  rowsOk: z.number().int(),
  rowsError: z.number().int(),
  report: z.array(ImportRowReportSchema),
  createdAt: z.string().datetime(),
});
export const ImportQuerySchema = z.object({
  dryRun: z.coerce.boolean().default(true),
  academicYearId: UuidSchema.optional(),
});
export const ImportBodySchema = z.object({ csv: z.string().min(1).max(5_000_000) });

// --- Dashboards ---
export const RegistrarDashboardSchema = z.object({
  students: z.object({
    active: z.number().int(),
    left: z.number().int(),
    withoutGuardian: z.number().int(),
    withoutClass: z.number().int(),
    incomplete: z.number().int(),
  }),
  guardians: z.object({ total: z.number().int(), activated: z.number().int() }),
  enrollmentsThisYear: z.number().int(),
  recentImports: z.array(ImportJobSchema.omit({ report: true })),
});
export const AdminDashboardSchema = z.object({
  counts: z.object({
    students: z.number().int(),
    teachers: z.number().int(),
    staff: z.number().int(),
    groups: z.number().int(),
    courses: z.number().int(),
    upcomingSessions7d: z.number().int(),
  }),
  configurationIssues: z.array(
    z.object({ code: z.string(), message: z.string(), count: z.number().int() }),
  ),
});
