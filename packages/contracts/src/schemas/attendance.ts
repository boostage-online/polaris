import { z } from 'zod';
import { CursorQuerySchema, QueryBoolSchema, UuidSchema } from './common';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ attendue');

// --- ADR-0006 : trois statuts + axe d'excuse + durées ---
export const AttendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'LATE']);
export const ExcuseStatusSchema = z.enum(['NONE', 'PENDING', 'EXCUSED', 'REJECTED']);
export const SheetStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'LOCKED']);

export const AttendanceRecordSchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  student: z
    .object({ firstName: z.string(), lastName: z.string(), matricule: z.string() })
    .optional(),
  status: AttendanceStatusSchema,
  excuseStatus: ExcuseStatusSchema,
  lateMinutes: z.number().int().nullable(),
  leftEarlyAt: z.string().datetime().nullable(),
  note: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const AttendanceSheetSchema = z.object({
  id: UuidSchema,
  sessionId: UuidSchema,
  status: SheetStatusSchema,
  version: z.number().int(),
  retroactive: z.boolean(),
  openedAt: z.string().datetime(),
  submittedAt: z.string().datetime().nullable(),
  submittedBy: z.string().nullable(),
  lockedAt: z.string().datetime().nullable(),
  session: z
    .object({
      id: UuidSchema,
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      subjectName: z.string(),
      groupName: z.string(),
      groupId: UuidSchema,
      room: z.string().nullable(),
      status: z.string(),
    })
    .optional(),
  counts: z
    .object({ present: z.number().int(), absent: z.number().int(), late: z.number().int() })
    .optional(),
  records: z.array(AttendanceRecordSchema).optional(),
});

/** Saisie d'un enregistrement (brouillon ou soumission). */
export const RecordInputSchema = z
  .object({
    studentId: UuidSchema,
    status: AttendanceStatusSchema,
    lateMinutes: z.number().int().min(1).max(600).nullable().optional(),
    leftEarlyAt: z.string().datetime().nullable().optional(),
    note: z.string().max(240).nullable().optional(),
  })
  .refine((r) => r.status !== 'LATE' || (r.lateMinutes ?? 0) > 0, {
    message: 'Durée du retard requise',
    path: ['lateMinutes'],
  });
export const PatchSheetSchema = z.object({
  version: z.number().int(),
  records: z.array(RecordInputSchema).max(500),
});
export const SubmitSheetSchema = z.object({
  version: z.number().int(),
  records: z.array(RecordInputSchema).max(500).optional(),
});
export const CorrectRecordSchema = z
  .object({
    status: AttendanceStatusSchema,
    lateMinutes: z.number().int().min(1).max(600).nullable().optional(),
    leftEarlyAt: z.string().datetime().nullable().optional(),
    note: z.string().max(240).nullable().optional(),
    reason: z.string().min(3).max(240),
  })
  .refine((r) => r.status !== 'LATE' || (r.lateMinutes ?? 0) > 0, {
    message: 'Durée du retard requise',
    path: ['lateMinutes'],
  });
export const RecordRevisionSchema = z.object({
  id: UuidSchema,
  recordId: UuidSchema,
  beforeStatus: AttendanceStatusSchema,
  afterStatus: AttendanceStatusSchema,
  beforeLateMinutes: z.number().int().nullable(),
  afterLateMinutes: z.number().int().nullable(),
  reason: z.string(),
  outOfWindow: z.boolean(),
  authorId: UuidSchema.nullable(),
  authorName: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export const LockSheetsSchema = z.object({
  from: IsoDate,
  to: IsoDate,
  groupId: UuidSchema.optional(),
  action: z.enum(['LOCK', 'UNLOCK']),
});

/** Séance du jour vue par l'enseignant, avec l'état de son appel. */
export const TodaySessionSchema = z.object({
  id: UuidSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  subjectName: z.string(),
  groupName: z.string(),
  groupId: UuidSchema,
  room: z.string().nullable(),
  status: z.string(),
  sheet: z
    .object({
      id: UuidSchema,
      status: SheetStatusSchema,
      counts: z.object({
        present: z.number().int(),
        absent: z.number().int(),
        late: z.number().int(),
      }),
    })
    .nullable(),
  isNext: z.boolean(),
});

export const MissingSheetSchema = z.object({
  sessionId: UuidSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  subjectName: z.string(),
  groupName: z.string(),
  teachers: z.array(z.object({ staffProfileId: UuidSchema, displayName: z.string().nullable() })),
  sheetStatus: SheetStatusSchema.nullable(),
});
export const MissingQuerySchema = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  groupId: UuidSchema.optional(),
});
export const SheetsQuerySchema = CursorQuerySchema.extend({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  groupId: UuidSchema.optional(),
  status: SheetStatusSchema.optional(),
  mine: QueryBoolSchema.optional(),
});

// --- Justificatifs ---
export const JustificationStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'INFO_REQUESTED',
]);
export const JustificationSchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  student: z
    .object({ firstName: z.string(), lastName: z.string(), matricule: z.string() })
    .optional(),
  fromDate: IsoDate,
  toDate: IsoDate,
  reason: z.string(),
  documentName: z.string().nullable(),
  status: JustificationStatusSchema,
  submittedByKind: z.enum(['STAFF', 'GUARDIAN']),
  submittedByName: z.string().nullable(),
  reviewComment: z.string().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  recordCount: z.number().int(),
  createdAt: z.string().datetime(),
});
export const CreateJustificationSchema = z
  .object({
    studentId: UuidSchema,
    fromDate: IsoDate,
    toDate: IsoDate,
    reason: z.string().min(3).max(1000),
    /** Nom du document joint (le dépôt de fichier arrive avec le stockage objet). */
    documentName: z.string().max(200).nullable().optional(),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: 'Intervalle invalide', path: ['toDate'] });
/** Variante parent : l'élève vient de l'URL. */
export const GuardianJustificationSchema = z
  .object({
    fromDate: IsoDate,
    toDate: IsoDate,
    reason: z.string().min(3).max(1000),
    documentName: z.string().max(200).nullable().optional(),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: 'Intervalle invalide', path: ['toDate'] });
export const ReviewJustificationSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'INFO_REQUESTED']),
  comment: z.string().max(1000).optional(),
});
export const JustificationsQuerySchema = CursorQuerySchema.extend({
  status: JustificationStatusSchema.optional(),
  studentId: UuidSchema.optional(),
  groupId: UuidSchema.optional(),
});

// --- Statistiques, alertes, historique ---
export const AttendanceSummarySchema = z.object({
  sessions: z.number().int(),
  present: z.number().int(),
  absent: z.number().int(),
  late: z.number().int(),
  excused: z.number().int(),
  unjustified: z.number().int(),
  /** Taux de présence physique (EXCUSED compte absent), en pourcentage entier. */
  presenceRate: z.number().int().nullable(),
});
export const AttendanceHistoryItemSchema = z.object({
  recordId: UuidSchema,
  sessionId: UuidSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  subjectName: z.string(),
  groupName: z.string(),
  status: AttendanceStatusSchema,
  excuseStatus: ExcuseStatusSchema,
  lateMinutes: z.number().int().nullable(),
  note: z.string().nullable(),
});
export const HistoryQuerySchema = CursorQuerySchema.extend({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  status: AttendanceStatusSchema.optional(),
});
export const WatchlistItemSchema = z.object({
  alertId: UuidSchema,
  student: z.object({
    id: UuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    matricule: z.string(),
    groupName: z.string().nullable(),
  }),
  kind: z.enum(['REPEATED_ABSENCES']),
  count: z.number().int(),
  windowFrom: IsoDate,
  windowTo: IsoDate,
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

export const TeacherDashboardSchema = z.object({
  today: z.array(TodaySessionSchema),
  pendingSheets: z.number().int(),
  submittedToday: z.number().int(),
  absencesToday: z.number().int(),
  lateToday: z.number().int(),
});
export const StudentLifeDashboardSchema = z.object({
  today: z.object({
    sessions: z.number().int(),
    sheetsSubmitted: z.number().int(),
    absent: z.number().int(),
    late: z.number().int(),
    unjustified: z.number().int(),
  }),
  justificationsPending: z.number().int(),
  watchlist: z.number().int(),
  missingSheets: z.number().int(),
});
export const ChildAttendanceSummarySchema = z.object({
  student: z.object({
    id: UuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    matricule: z.string(),
    groupName: z.string().nullable(),
  }),
  canJustify: z.boolean(),
  today: z.array(AttendanceHistoryItemSchema),
  last30Days: AttendanceSummarySchema,
  recent: z.array(AttendanceHistoryItemSchema),
  alerts: z.number().int(),
  pendingJustifications: z.number().int(),
});

// --- Notifications ---
export const NotificationChannelSchema = z.enum(['SMS', 'EMAIL', 'PUSH', 'INAPP']);
export const NotificationStatusSchema = z.enum([
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'SUPPRESSED',
]);
export const NotificationKindSchema = z.enum([
  'STUDENT_ABSENT',
  'STUDENT_LATE',
  'JUSTIFICATION_REVIEWED',
  'JUSTIFICATION_SUBMITTED',
  'REPEATED_ABSENCES',
  'ATTENDANCE_SHEET_MISSING',
  'SMS_CAP_WARNING',
  'PAYMENT_RECEIVED',
  'PAYMENT_REVERSED',
  'INSTALLMENT_DUE_SOON',
  'INSTALLMENT_OVERDUE',
  'LEDGER_INTEGRITY',
  'PAYMENT_FAILED',
  'PAYMENT_REVIEW_NEEDED',
]);
export const NotificationSchema = z.object({
  id: UuidSchema,
  kind: NotificationKindSchema,
  channel: NotificationChannelSchema,
  status: NotificationStatusSchema,
  title: z.string(),
  body: z.string(),
  actionUrl: z.string().nullable(),
  recipientUserId: UuidSchema,
  recipientName: z.string().nullable().optional(),
  studentId: UuidSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
  readAt: z.string().datetime().nullable(),
});
export const NotificationsQuerySchema = CursorQuerySchema.extend({
  studentId: UuidSchema.optional(),
  recipientUserId: UuidSchema.optional(),
  channel: NotificationChannelSchema.optional(),
  status: NotificationStatusSchema.optional(),
  kind: NotificationKindSchema.optional(),
});
export const InboxQuerySchema = CursorQuerySchema.extend({ unread: QueryBoolSchema.optional() });
export const NotificationPreferencesSchema = z.object({
  /** Par type d'événement : canaux souhaités. Absent = défaut (SMS + in-app pour l'assiduité). */
  preferences: z.record(NotificationKindSchema, z.array(NotificationChannelSchema)),
});
export const NotificationUsageSchema = z.object({
  month: z.string(),
  smsSent: z.number().int(),
  smsCap: z.number().int(),
  suppressed: z.number().int(),
  failed: z.number().int(),
});

export type AttendanceSheet = z.infer<typeof AttendanceSheetSchema>;
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;
export type RecordInput = z.infer<typeof RecordInputSchema>;
export type RecordRevision = z.infer<typeof RecordRevisionSchema>;
export type TodaySession = z.infer<typeof TodaySessionSchema>;
export type MissingSheet = z.infer<typeof MissingSheetSchema>;
export type Justification = z.infer<typeof JustificationSchema>;
export type AttendanceSummary = z.infer<typeof AttendanceSummarySchema>;
export type AttendanceHistoryItem = z.infer<typeof AttendanceHistoryItemSchema>;
export type WatchlistItem = z.infer<typeof WatchlistItemSchema>;
export type TeacherDashboard = z.infer<typeof TeacherDashboardSchema>;
export type StudentLifeDashboard = z.infer<typeof StudentLifeDashboardSchema>;
export type ChildAttendanceSummary = z.infer<typeof ChildAttendanceSummarySchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type NotificationKind = z.infer<typeof NotificationKindSchema>;
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
export type NotificationUsage = z.infer<typeof NotificationUsageSchema>;
