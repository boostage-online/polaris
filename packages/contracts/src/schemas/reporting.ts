import { z } from 'zod';
import { UuidSchema } from './common';

/** Reporting et tableaux de bord (Phase 6). Lecture seule, agrégats rafraîchis par le worker. */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ attendue');
const Amount = z.number().int();
const Rate = z.number().int().min(0).max(100).nullable();

export const ReportKeySchema = z.enum([
  'attendance-by-group',
  'students-at-risk',
  'missing-sheets',
  'attendance-corrections',
  'collections-by-channel',
  'recovery-by-group',
  'parent-activation',
  'payment-attempts',
]);
export const ReportPeriodSchema = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  groupId: UuidSchema.optional(),
});
export const ReportDefinitionSchema = z.object({
  key: ReportKeySchema,
  title: z.string(),
  description: z.string(),
  family: z.enum(['attendance', 'finance', 'adoption']),
  permission: z.string(),
  defaultDays: z.number().int(),
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
});
export const ReportResultSchema = z.object({
  key: ReportKeySchema,
  title: z.string(),
  period: z.object({ from: IsoDate, to: IsoDate }),
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  total: z.number().int(),
  truncated: z.boolean(),
});

// --- Tableaux de bord ---
export const TrendPointSchema = z.object({ label: z.string(), value: z.number().nullable() });
export const DirectionDashboardSchema = z.object({
  period: z.object({ from: IsoDate, to: IsoDate }),
  students: z.object({ active: Amount, newLast30d: Amount }),
  attendance: z.object({
    rate7d: Rate,
    rate30d: Rate,
    ratePrev30d: Rate,
    missingSheets7d: Amount,
    atRisk: Amount,
    unjustified30d: Amount,
  }),
  finance: z.object({
    invoiced: Amount,
    paid: Amount,
    outstanding: Amount,
    overdue: Amount,
    recoveryRate: Rate,
    paidThisMonth: Amount,
    paidPrevMonth: Amount,
    onlineShare30d: Rate,
    pendingReviews: Amount,
  }),
  parents: z.object({ total: Amount, activated: Amount, activationRate: Rate }),
  notifications: z.object({ smsThisMonth: Amount, smsCap: Amount, inAppUnread: Amount }),
  trends: z.object({
    attendanceWeekly: z.array(TrendPointSchema),
    collectionsWeekly: z.array(TrendPointSchema),
  }),
  groupsAtRisk: z.array(
    z.object({ groupId: UuidSchema, groupName: z.string(), rate30d: Rate, unjustified30d: Amount }),
  ),
  refreshedAt: z.string().datetime().nullable(),
});
export const PedagogyDashboardSchema = z.object({
  period: z.object({ from: IsoDate, to: IsoDate }),
  byGroup: z.array(
    z.object({
      groupId: UuidSchema,
      groupName: z.string(),
      levelName: z.string().nullable(),
      sessionsHeld: Amount,
      records: Amount,
      presenceRate: Rate,
      absent: Amount,
      late: Amount,
      unjustified: Amount,
      sheetsMissing: Amount,
    }),
  ),
  studentsAtRisk: z.array(
    z.object({
      studentId: UuidSchema,
      firstName: z.string(),
      lastName: z.string(),
      matricule: z.string(),
      groupName: z.string().nullable(),
      sessions: Amount,
      absent: Amount,
      unjustified: Amount,
      late: Amount,
      presenceRate: Rate,
      openAlert: z.boolean(),
    }),
  ),
  missingSheetsByTeacher: z.array(
    z.object({
      staffProfileId: UuidSchema.nullable(),
      teacherName: z.string(),
      missing: Amount,
      sessions: Amount,
    }),
  ),
  lateDistribution: z.array(z.object({ bucket: z.string(), count: Amount })),
  refreshedAt: z.string().datetime().nullable(),
});
export const FinanceChannelsSchema = z.object({
  period: z.object({ from: IsoDate, to: IsoDate }),
  channels: z.array(
    z.object({
      channel: z.string(),
      label: z.string(),
      kind: z.enum(['MANUAL', 'ELECTRONIC']),
      payments: Amount,
      amount: Amount,
      reversedAmount: Amount,
      fees: Amount,
      share: Rate,
    }),
  ),
  online: z.object({
    attempts: Amount,
    succeeded: Amount,
    failed: Amount,
    pending: Amount,
    unknown: Amount,
    successRate: Rate,
    medianConfirmSeconds: z.number().nullable(),
  }),
  daily: z.array(z.object({ day: IsoDate, manual: Amount, online: Amount })),
});

// --- Traçabilité ---
export const SheetTraceSchema = z.object({
  sheet: z.object({
    id: UuidSchema,
    status: z.string(),
    version: z.number().int(),
    retroactive: z.boolean(),
    openedAt: z.string().datetime(),
    openedBy: z.string().nullable(),
    submittedAt: z.string().datetime().nullable(),
    submittedBy: z.string().nullable(),
    lockedAt: z.string().datetime().nullable(),
  }),
  session: z.object({
    id: UuidSchema,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    status: z.string(),
    subjectName: z.string(),
    groupName: z.string(),
    teachers: z.array(z.string()),
  }),
  counts: z.object({
    records: Amount,
    present: Amount,
    absent: Amount,
    late: Amount,
    excused: Amount,
  }),
  revisions: z.array(
    z.object({
      at: z.string().datetime(),
      student: z.string(),
      before: z.string(),
      after: z.string(),
      reason: z.string(),
      outOfWindow: z.boolean(),
      author: z.string().nullable(),
    }),
  ),
  notifications: z.array(
    z.object({
      id: UuidSchema,
      kind: z.string(),
      channel: z.string(),
      status: z.string(),
      recipient: z.string().nullable(),
      sentAt: z.string().datetime().nullable(),
      error: z.string().nullable(),
    }),
  ),
  audit: z.array(
    z.object({ at: z.string().datetime(), action: z.string(), by: z.string().nullable() }),
  ),
});
export const NotificationTraceSchema = z.object({
  notification: z.object({
    id: UuidSchema,
    kind: z.string(),
    channel: z.string(),
    status: z.string(),
    title: z.string(),
    body: z.string(),
    recipient: z.object({
      userId: UuidSchema,
      name: z.string().nullable(),
      address: z.string().nullable(),
    }),
    studentName: z.string().nullable(),
    attempts: Amount,
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
    sentAt: z.string().datetime().nullable(),
    deliveredAt: z.string().datetime().nullable(),
    readAt: z.string().datetime().nullable(),
    providerMessageId: z.string().nullable(),
  }),
  sourceEvent: z
    .object({
      id: z.string(),
      type: z.string(),
      aggregateType: z.string(),
      aggregateId: z.string().nullable(),
      occurredAt: z.string().datetime().nullable(),
      publishedAt: z.string().datetime().nullable(),
    })
    .nullable(),
  siblings: z.array(
    z.object({
      id: UuidSchema,
      channel: z.string(),
      status: z.string(),
      recipient: z.string().nullable(),
    }),
  ),
  preferences: z.array(z.string()).nullable(),
});

// --- Rapports planifiés ---
export const ScheduledReportSchema = z.object({
  id: UuidSchema,
  reportKey: ReportKeySchema,
  cadence: z.enum(['WEEKLY', 'MONTHLY']),
  dayOfPeriod: z.number().int().min(1).max(28),
  recipients: z.array(z.string().email()),
  filters: z.object({ groupId: UuidSchema.optional() }).passthrough(),
  enabled: z.boolean(),
  lastSentAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export const CreateScheduledReportSchema = z.object({
  reportKey: ReportKeySchema,
  cadence: z.enum(['WEEKLY', 'MONTHLY']),
  dayOfPeriod: z.number().int().min(1).max(28).default(1),
  recipients: z.array(z.string().email()).min(1).max(10),
  filters: z.object({ groupId: UuidSchema.optional() }).default({}),
});
export const UpdateScheduledReportSchema = CreateScheduledReportSchema.partial().extend({
  enabled: z.boolean().optional(),
});

// --- Export complet ---
export const TenantExportSchema = z.object({
  id: UuidSchema,
  status: z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']),
  requestedByName: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  sizeBytes: Amount.nullable(),
  entries: z.array(z.object({ name: z.string(), rows: z.number().int() })),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});

// --- Plateforme (Super Admin) ---
export const PlatformOverviewSchema = z.object({
  generatedAt: z.string().datetime(),
  tenants: z.object({ total: Amount, active: Amount, trial: Amount, suspended: Amount }),
  totals: z.object({
    studentsActive: Amount,
    guardians: Amount,
    guardiansActivated: Amount,
    paidToday: Amount,
    paidMonth: Amount,
    attendanceRate7d: Rate,
  }),
  payments24h: z.object({
    attempts: Amount,
    succeeded: Amount,
    failed: Amount,
    pending: Amount,
    unknown: Amount,
    webhooks: Amount,
    byProvider: z.array(z.object({ provider: z.string(), attempts: Amount, succeeded: Amount })),
  }),
  health: z.object({
    database: z.boolean(),
    redis: z.boolean(),
    outboxBacklog: Amount,
    outboxOldestSeconds: z.number().nullable(),
    queues: z.array(
      z.object({
        name: z.string(),
        waiting: Amount,
        active: Amount,
        delayed: Amount,
        failed: Amount,
        oldestWaitingSeconds: z.number().nullable(),
      }),
    ),
    dlq: z.array(z.object({ name: z.string(), count: Amount })),
    staleReports: Amount,
  }),
  errors24h: z.object({
    attemptsUnknown: Amount,
    notificationsFailed: Amount,
    importsFailed: Amount,
    reviewOpen: Amount,
  }),
  perTenant: z.array(
    z.object({
      id: UuidSchema,
      code: z.string(),
      name: z.string(),
      status: z.string(),
      studentsActive: Amount,
      guardiansActivationRate: Rate,
      attendanceRate7d: Rate,
      missingSheets7d: Amount,
      paidMonth: Amount,
      onlineProvider: z.string().nullable(),
      pendingAttempts: Amount,
      reviewOpen: Amount,
      smsMonth: Amount,
      lastRefreshAt: z.string().datetime().nullable(),
    }),
  ),
});

export type ReportKey = z.infer<typeof ReportKeySchema>;
export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>;
export type ReportResult = z.infer<typeof ReportResultSchema>;
export type DirectionDashboard = z.infer<typeof DirectionDashboardSchema>;
export type PedagogyDashboard = z.infer<typeof PedagogyDashboardSchema>;
export type FinanceChannels = z.infer<typeof FinanceChannelsSchema>;
export type SheetTrace = z.infer<typeof SheetTraceSchema>;
export type NotificationTrace = z.infer<typeof NotificationTraceSchema>;
export type ScheduledReport = z.infer<typeof ScheduledReportSchema>;
export type CreateScheduledReportInput = z.input<typeof CreateScheduledReportSchema>;
export type TenantExport = z.infer<typeof TenantExportSchema>;
export type PlatformOverview = z.infer<typeof PlatformOverviewSchema>;
