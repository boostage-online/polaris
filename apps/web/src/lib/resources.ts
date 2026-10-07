'use client';
import type {
  AcademicYear,
  AnonymizationResult,
  AuditLog,
  AuditQuery,
  Adjustment,
  AdminDashboard,
  AssignmentReport,
  AttendanceHistoryItem,
  AttendanceSheet,
  AttendanceSummary,
  AttemptTimeline,
  ChildAttendanceSummary,
  ChildFinanceSummary,
  ChildSummary,
  ClassSession,
  Course,
  CreateAcademicYearInput,
  CreateCourseInput,
  CreateFeeStructureInput,
  CreateGroupInput,
  CreateScheduledReportInput,
  CreateGuardianInput,
  CreateScheduleSlotInput,
  CreateStudentInput,
  DirectionDashboard,
  Enrollment,
  FeeCategory,
  FeeStructure,
  FinanceChannels,
  FinanceDashboard,
  Group,
  Guardian,
  GuardianLink,
  ImpersonationGrant,
  ImpersonationSession,
  ImportJob,
  Justification,
  LinkGuardianInput,
  MfaStatus,
  MissingSheet,
  Installment,
  Notification,
  NotificationChannel,
  NotificationKind,
  NotificationTrace,
  NotificationUsage,
  OnboardingStatus,
  Payment,
  PaymentAttempt,
  PaymentConfig,
  PaymentMethod,
  PaymentOptions,
  PedagogyDashboard,
  PersonalDataExport,
  PlatformAlert,
  PendingPayments,
  PlatformOverview,
  PrivacyRequest,
  Program,
  Receipt,
  ReconciliationRun,
  RecordInput,
  ReportDefinition,
  ReportKey,
  ReportResult,
  RecordManualPaymentInput,
  RecordRevision,
  RegistrarDashboard,
  SessionInfo,
  ScheduledReport,
  SheetTrace,
  Staff,
  Student,
  StudentAccount,
  StudentLifeDashboard,
  Subject,
  TeacherDashboard,
  TenantExport,
  Term,
  TodaySession,
  UnpaidByGroup,
  UpsertPaymentConfigInput,
  WatchlistItem,
} from '@polaris/contracts';
import {
  api,
  apiEnvelope,
  apiPublic,
  del,
  downloadFile,
  json,
  patch,
  put,
  qs,
  type PageMeta,
} from './api';

/** Fonctions d'accès aux ressources Phase 2, une par route, typées par les contrats. */

export const years = {
  list: () => api<AcademicYear[]>('/academic-years'),
  create: (b: CreateAcademicYearInput) => api<AcademicYear>('/academic-years', json(b)),
  update: (id: string, b: Partial<CreateAcademicYearInput>) =>
    api<AcademicYear>(`/academic-years/${id}`, patch(b)),
  setCurrent: (id: string) => api<AcademicYear>(`/academic-years/${id}/set-current`, json({})),
  terms: (id: string) => api<Term[]>(`/academic-years/${id}/terms`),
  addTerm: (id: string, b: { label: string; startDate: string; endDate: string }) =>
    api<Term>(`/academic-years/${id}/terms`, json(b)),
};

export const programs = {
  list: () => api<Program[]>('/programs'),
  create: (b: { code: string; name: string }) => api<Program>('/programs', json(b)),
  update: (id: string, b: { code?: string; name?: string }) =>
    api<Program>(`/programs/${id}`, patch(b)),
  remove: (id: string) => api<void>(`/programs/${id}`, del()),
  addLevel: (id: string, b: { name: string; rank?: number }) =>
    api<Program>(`/programs/${id}/levels`, json(b)),
  updateLevel: (levelId: string, b: { name?: string; rank?: number }) =>
    api<Program>(`/levels/${levelId}`, patch(b)),
};

export const groups = {
  list: (q: { academicYearId?: string; kind?: 'CLASS' | 'SUBGROUP'; levelId?: string } = {}) =>
    api<Group[]>(`/groups${qs(q)}`),
  get: (id: string) => api<Group>(`/groups/${id}`),
  create: (b: CreateGroupInput) => api<Group>('/groups', json(b)),
  update: (id: string, b: Partial<Omit<CreateGroupInput, 'academicYearId'>>) =>
    api<Group>(`/groups/${id}`, patch(b)),
  remove: (id: string) => api<void>(`/groups/${id}`, del()),
};

export const subjects = {
  list: () => api<Subject[]>('/subjects'),
  create: (b: { code: string; name: string; levelId?: string | null }) =>
    api<Subject>('/subjects', json(b)),
  update: (id: string, b: { code?: string; name?: string; levelId?: string | null }) =>
    api<Subject>(`/subjects/${id}`, patch(b)),
  remove: (id: string) => api<void>(`/subjects/${id}`, del()),
};

export const staff = {
  list: () => api<Staff[]>('/staff'),
  update: (
    membershipId: string,
    b: { isTeacher?: boolean; employeeNumber?: string | null; title?: string | null },
  ) => api<Staff>(`/staff/${membershipId}`, patch(b)),
};

export const courses = {
  list: (q: { academicYearId?: string; groupId?: string; teacherStaffProfileId?: string } = {}) =>
    api<Course[]>(`/courses${qs(q)}`),
  get: (id: string) => api<Course>(`/courses/${id}`),
  create: (b: CreateCourseInput) => api<Course>('/courses', json(b)),
  setTeachers: (id: string, teachers: { staffProfileId: string; role?: 'MAIN' | 'ASSISTANT' }[]) =>
    api<Course>(`/courses/${id}/teachers`, put({ teachers })),
  remove: (id: string) => api<void>(`/courses/${id}`, del()),
  addSlot: (id: string, b: CreateScheduleSlotInput) =>
    apiEnvelope<{ id: string }, { warnings?: string[] }>(`/courses/${id}/schedule-slots`, json(b)),
  removeSlot: (slotId: string) => api<void>(`/schedule-slots/${slotId}`, del()),
  addSession: (id: string, b: { startsAt: string; endsAt: string; room?: string | null }) =>
    api<ClassSession>(`/courses/${id}/sessions`, json(b)),
};

export interface SessionsQuery {
  from?: string;
  to?: string;
  groupId?: string;
  courseOfferingId?: string;
  status?: 'PLANNED' | 'HELD' | 'CANCELLED';
  limit?: number;
  cursor?: string;
}
export const sessions = {
  list: (q: SessionsQuery) => apiEnvelope<ClassSession[], PageMeta>(`/sessions${qs(q)}`),
  mine: (q: { from?: string; to?: string; limit?: number; cursor?: string }) =>
    apiEnvelope<ClassSession[], PageMeta>(`/me/schedule${qs(q)}`),
  get: (id: string) => api<ClassSession>(`/sessions/${id}`),
  update: (
    id: string,
    b: {
      startsAt?: string;
      endsAt?: string;
      room?: string | null;
      status?: 'PLANNED' | 'HELD' | 'CANCELLED';
      cancelReason?: string | null;
    },
  ) => api<ClassSession>(`/sessions/${id}`, patch(b)),
  generate: (horizonDays = 14) =>
    api<{ created: number; scanned: number }>('/sessions/generate', json({ horizonDays })),
};

export interface StudentsQuery {
  q?: string;
  groupId?: string;
  academicYearId?: string;
  status?: 'ACTIVE' | 'LEFT' | 'GRADUATED';
  incomplete?: boolean;
  limit?: number;
  cursor?: string;
}
export const students = {
  list: (q: StudentsQuery) => apiEnvelope<Student[], PageMeta>(`/students${qs(q)}`),
  get: (id: string) => api<Student>(`/students/${id}`),
  create: (b: CreateStudentInput) => api<Student>('/students', json(b)),
  update: (id: string, b: Partial<Omit<CreateStudentInput, 'groupId'>>) =>
    api<Student>(`/students/${id}`, patch(b)),
  enroll: (id: string, b: { groupId: string; enrolledAt?: string }) =>
    api<Enrollment>(`/students/${id}/enrollments`, json(b)),
  transfer: (id: string, b: { toGroupId: string; effectiveDate?: string; reason?: string }) =>
    api<Student>(`/students/${id}/transfer`, json(b)),
  leave: (id: string, b: { status: 'LEFT' | 'GRADUATED'; leftAt?: string; reason?: string }) =>
    api<Student>(`/students/${id}/leave`, json(b)),
  closeEnrollment: (enrollmentId: string, b: { leftAt?: string; reason?: string }) =>
    api<Enrollment>(`/enrollments/${enrollmentId}/close`, json(b)),
  guardians: (id: string) => api<GuardianLink[]>(`/students/${id}/guardians`),
  linkGuardian: (id: string, b: LinkGuardianInput) =>
    api<GuardianLink>(`/students/${id}/guardians`, json(b)),
};

export const guardians = {
  list: (q: { q?: string; activated?: boolean; limit?: number; cursor?: string }) =>
    apiEnvelope<Guardian[], PageMeta>(`/guardians${qs(q)}`),
  get: (id: string) => api<Guardian>(`/guardians/${id}`),
  create: (b: CreateGuardianInput) => api<Guardian>('/guardians', json(b)),
  update: (id: string, b: Partial<CreateGuardianInput>) =>
    api<Guardian>(`/guardians/${id}`, patch(b)),
  invite: (id: string) => api<{ invited: boolean }>(`/guardians/${id}/invite`, json({})),
  updateLink: (
    linkId: string,
    b: {
      relationship?: 'MOTHER' | 'FATHER' | 'TUTOR' | 'OTHER';
      isPrimary?: boolean;
      canViewAttendance?: boolean;
      canViewFinance?: boolean;
      canPay?: boolean;
      canJustify?: boolean;
    },
  ) => api<GuardianLink>(`/student-guardians/${linkId}`, patch(b)),
  unlink: (linkId: string, reason: string) =>
    api<void>(`/student-guardians/${linkId}`, del({ reason })),
  myChildren: () => api<ChildSummary[]>('/me/children'),
};

export const imports = {
  students: (csv: string, opts: { dryRun: boolean; academicYearId?: string }) =>
    api<ImportJob>(`/imports/students${qs(opts)}`, json({ csv })),
  guardians: (csv: string, opts: { dryRun: boolean }) =>
    api<ImportJob>(`/imports/guardians${qs(opts)}`, json({ csv })),
  get: (id: string) => api<ImportJob>(`/imports/${id}`),
};

export const dashboards = {
  registrar: () => api<RegistrarDashboard>('/dashboards/registrar'),
  admin: () => api<AdminDashboard>('/dashboards/admin'),
};

// ----------------------------------------------------------------------------- Phase 3 : assiduité

export const attendance = {
  today: (date?: string) => api<TodaySession[]>(`/me/schedule/today${qs({ date })}`),
  open: (sessionId: string) =>
    api<AttendanceSheet>(`/sessions/${sessionId}/attendance-sheet`, json({})),
  bySession: (sessionId: string) => api<AttendanceSheet>(`/sessions/${sessionId}/attendance-sheet`),
  sheet: (id: string) => api<AttendanceSheet>(`/attendance-sheets/${id}`),
  sheets: (q: {
    from?: string;
    to?: string;
    groupId?: string;
    status?: string;
    mine?: boolean;
    limit?: number;
    cursor?: string;
  }) => apiEnvelope<AttendanceSheet[], PageMeta>(`/attendance-sheets${qs(q)}`),
  patch: (id: string, version: number, records: RecordInput[]) =>
    api<AttendanceSheet>(`/attendance-sheets/${id}`, patch({ version, records })),
  submit: (id: string, version: number, records?: RecordInput[]) =>
    api<AttendanceSheet>(`/attendance-sheets/${id}/submit`, json({ version, records })),
  correct: (
    recordId: string,
    b: {
      status: 'PRESENT' | 'ABSENT' | 'LATE';
      lateMinutes?: number | null;
      note?: string | null;
      reason: string;
    },
  ) => api<AttendanceSheet>(`/attendance-records/${recordId}`, patch(b)),
  revisions: (recordId: string) =>
    api<RecordRevision[]>(`/attendance-records/${recordId}/revisions`),
  missing: (q: { from?: string; to?: string; groupId?: string } = {}) =>
    api<MissingSheet[]>(`/attendance-sheets/missing${qs(q)}`),
  lock: (b: { from: string; to: string; groupId?: string; action: 'LOCK' | 'UNLOCK' }) =>
    api<{ count: number }>('/attendance-sheets/lock', json(b)),
  studentHistory: (
    studentId: string,
    q: { from?: string; to?: string; status?: string; limit?: number; cursor?: string } = {},
  ) => apiEnvelope<AttendanceHistoryItem[], PageMeta>(`/students/${studentId}/attendance${qs(q)}`),
  studentSummary: (studentId: string, q: { from?: string; to?: string } = {}) =>
    api<AttendanceSummary>(`/students/${studentId}/attendance/summary${qs(q)}`),
  watchlist: () => api<WatchlistItem[]>('/attendance/watchlist'),
  resolveAlert: (id: string) =>
    api<{ resolved: boolean }>(`/attendance/alerts/${id}/resolve`, json({})),
  teacherDashboard: () => api<TeacherDashboard>('/dashboards/teacher'),
  studentLifeDashboard: () => api<StudentLifeDashboard>('/dashboards/student-life'),
};

export const justifications = {
  list: (
    q: {
      status?: string;
      studentId?: string;
      groupId?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) => apiEnvelope<Justification[], PageMeta>(`/justifications${qs(q)}`),
  get: (id: string) =>
    api<
      Justification & {
        records: { recordId: string; startsAt: string; status: string; excuseStatus: string }[];
      }
    >(`/justifications/${id}`),
  create: (b: {
    studentId: string;
    fromDate: string;
    toDate: string;
    reason: string;
    documentName?: string | null;
  }) => api<Justification>('/justifications', json(b)),
  review: (
    id: string,
    b: { decision: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED'; comment?: string },
  ) => api<Justification>(`/justifications/${id}/review`, json(b)),
};

export const parent = {
  summary: () => api<ChildAttendanceSummary[]>('/me/children/summary'),
  history: (
    studentId: string,
    q: { from?: string; to?: string; limit?: number; cursor?: string } = {},
  ) =>
    apiEnvelope<AttendanceHistoryItem[], PageMeta>(`/me/children/${studentId}/attendance${qs(q)}`),
  justifications: (studentId: string) =>
    api<Justification[]>(`/me/children/${studentId}/justifications`),
  submitJustification: (
    studentId: string,
    b: { fromDate: string; toDate: string; reason: string; documentName?: string | null },
  ) => api<Justification>(`/me/children/${studentId}/justifications`, json(b)),
};

export const notifs = {
  inbox: (q: { unread?: boolean; limit?: number; cursor?: string } = {}) =>
    apiEnvelope<Notification[], PageMeta & { unread: number }>(`/me/notifications${qs(q)}`),
  read: (id: string) => api<{ marked: number }>(`/me/notifications/${id}/read`, json({})),
  readAll: () => api<{ marked: number }>('/me/notifications/read-all', json({})),
  preferences: () =>
    api<{ preferences: Record<string, NotificationChannel[]> }>('/me/notifications/preferences'),
  setPreferences: (preferences: Partial<Record<NotificationKind, NotificationChannel[]>>) =>
    api<{ preferences: Record<string, NotificationChannel[]> }>(
      '/me/notifications/preferences',
      put({ preferences }),
    ),
  journal: (
    q: {
      studentId?: string;
      recipientUserId?: string;
      channel?: string;
      status?: string;
      kind?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) => apiEnvelope<Notification[], PageMeta>(`/notifications${qs(q)}`),
  usage: () => api<NotificationUsage>('/notifications/usage'),
  resend: (id: string) => api<Notification>(`/notifications/${id}/resend`, json({})),
};

export interface TenantInfo {
  id: string;
  code: string;
  name: string;
  type: string;
  timezone: string;
  settings: {
    attendance?: {
      lateToAbsentMinutes?: number;
      correctionWindowHours?: number;
      guardianJustificationsEnabled?: boolean;
      repeatedAbsenceThreshold?: number;
      repeatedAbsenceWindowDays?: number;
    };
    notifications?: { smsMonthlyCap?: number };
    billing?: {
      graceDays?: number;
      reminderDaysBefore?: number[];
      overdueReminderEveryDays?: number;
    };
    payments?: { minAmount?: number; allowOverpayment?: boolean };
  };
}
export const tenant = {
  get: () => api<TenantInfo>('/tenant'),
  updateSettings: (b: TenantInfo['settings']) => api<TenantInfo>('/tenant/settings', patch(b)),
};

// ----------------------------------------------------------------------------- Phase 4 : frais et paiements

export const billing = {
  categories: () => api<FeeCategory[]>('/fee-categories'),
  createCategory: (b: { code: string; name: string }) =>
    api<FeeCategory>('/fee-categories', json(b)),
  updateCategory: (id: string, b: { code?: string; name?: string }) =>
    api<FeeCategory>(`/fee-categories/${id}`, patch(b)),
  removeCategory: (id: string) => api<void>(`/fee-categories/${id}`, del()),

  structures: (q: { academicYearId?: string; categoryId?: string; status?: string } = {}) =>
    api<FeeStructure[]>(`/fee-structures${qs(q)}`),
  structure: (id: string) => api<FeeStructure>(`/fee-structures/${id}`),
  createStructure: (b: CreateFeeStructureInput) => api<FeeStructure>('/fee-structures', json(b)),
  updateStructure: (
    id: string,
    b: Partial<Omit<CreateFeeStructureInput, 'code' | 'academicYearId'>> & {
      status?: 'ACTIVE' | 'ARCHIVED';
    },
  ) => api<FeeStructure>(`/fee-structures/${id}`, patch(b)),
  removeStructure: (id: string) => api<void>(`/fee-structures/${id}`, del()),

  assign: (b: {
    feeStructureId: string;
    target?: {
      groupIds?: string[];
      levelIds?: string[];
      studentIds?: string[];
      useStructureTarget?: boolean;
    };
    asOf?: string;
  }) => api<AssignmentReport>('/fees/assign', json(b)),
  assignToStudent: (studentId: string, feeStructureIds: string[]) =>
    api<StudentAccount>(`/students/${studentId}/fees`, json({ feeStructureIds })),
  adjust: (b: {
    studentFeeId: string;
    installmentId?: string;
    amount: number;
    kind: Adjustment['kind'];
    reason: string;
  }) => api<StudentAccount>('/fees/adjustments', json(b)),
  integrityCheck: () =>
    api<{ checkId: string; mismatches: number; details: unknown[] }>(
      '/fees/integrity-check',
      json({}),
    ),

  account: (studentId: string) => api<StudentAccount>(`/students/${studentId}/fees`),
  /** Encaissement manuel : la clé d'idempotence est générée côté client et conservée pendant les relances. */
  recordManual: (studentId: string, idempotencyKey: string, b: RecordManualPaymentInput) =>
    api<Payment>(`/students/${studentId}/payments/manual`, {
      ...json(b),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  payments: (
    q: {
      studentId?: string;
      from?: string;
      to?: string;
      method?: PaymentMethod;
      status?: 'COMPLETED' | 'REVERSED';
      mine?: boolean;
      limit?: number;
      cursor?: string;
    } = {},
  ) => apiEnvelope<Payment[], PageMeta>(`/payments${qs(q)}`),
  payment: (id: string) => api<Payment>(`/payments/${id}`),
  reverse: (id: string, reason: string) =>
    api<Payment>(`/payments/${id}/reverse`, json({ reason })),
  receipt: (paymentId: string, kind: 'PAYMENT' | 'CANCELLATION' = 'PAYMENT') =>
    api<Receipt>(`/payments/${paymentId}/receipt${qs({ kind })}`),
  downloadReceipt: (paymentId: string, number: string) =>
    downloadFile(`/payments/${paymentId}/receipt.pdf`, `recu-${number}.pdf`),

  unpaid: (
    q: {
      groupId?: string;
      feeStructureId?: string;
      status?: 'DUE' | 'OVERDUE' | 'ALL_OPEN';
      q?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) => apiEnvelope<Installment[], PageMeta>(`/unpaid${qs(q)}`),
  unpaidByGroup: () => api<UnpaidByGroup[]>('/unpaid/by-group'),
  remind: (installmentIds: string[], message?: string) =>
    api<{ installments: number; guardians: number; skipped: number }>(
      '/unpaid/reminders',
      json({ installmentIds, message: message || undefined }),
    ),
  exportCsv: (
    kind: 'payments' | 'aged-balance' | 'unpaid',
    q: { from?: string; to?: string; groupId?: string } = {},
  ) => downloadFile(`/exports/${kind}.csv${qs(q)}`, `${kind}.csv`),

  dashboard: () => api<FinanceDashboard>('/dashboards/finance'),
};

export const parentFinance = {
  children: () => api<ChildFinanceSummary[]>('/me/children/finance'),
  account: (studentId: string) => api<StudentAccount>(`/me/children/${studentId}/fees`),
  receipt: (studentId: string, paymentId: string) =>
    api<Receipt>(`/me/children/${studentId}/payments/${paymentId}/receipt`),
  downloadReceipt: (studentId: string, paymentId: string, number: string) =>
    downloadFile(
      `/me/children/${studentId}/payments/${paymentId}/receipt.pdf`,
      `recu-${number}.pdf`,
    ),
};

// ----------------------------------------------------------------------------- Phase 5 : paiements électroniques

export const payments = {
  /** Espace parent */
  options: (studentId: string) => api<PaymentOptions>(`/me/children/${studentId}/payment-options`),
  start: (
    studentId: string,
    idempotencyKey: string,
    b: { amount: number; installmentIds?: string[]; payerPhone?: string },
  ) =>
    api<PaymentAttempt>(`/me/children/${studentId}/payment-attempts`, {
      ...json(b),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  myAttempts: (studentId: string) =>
    api<PaymentAttempt[]>(`/me/children/${studentId}/payment-attempts`),
  myAttempt: (studentId: string, attemptId: string) =>
    api<PaymentAttempt>(`/me/children/${studentId}/payment-attempts/${attemptId}`),
  confirm: (studentId: string, attemptId: string, externalId?: string) =>
    api<PaymentAttempt>(
      `/me/children/${studentId}/payment-attempts/${attemptId}/confirm`,
      json({ externalId }),
    ),

  /** Finance */
  attempts: (
    q: {
      status?: string;
      studentId?: string;
      review?: 'OPEN' | 'RESOLVED';
      from?: string;
      to?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) => apiEnvelope<PaymentAttempt[], PageMeta>(`/payment-attempts${qs(q)}`),
  pending: () => api<PendingPayments>('/payment-attempts/pending'),
  timeline: (id: string) => api<AttemptTimeline>(`/payment-attempts/${id}`),
  reverify: (id: string) => api<PaymentAttempt>(`/payment-attempts/${id}/reverify`, json({})),
  resolve: (id: string, note: string) =>
    api<PaymentAttempt>(`/payment-attempts/${id}/resolve`, json({ note })),
  reconciliations: () => api<ReconciliationRun[]>('/payment-reconciliation'),
  runReconciliation: (day?: string) =>
    api<ReconciliationRun>('/payment-reconciliation/run', json({ day })),
  resolveOrphan: (runId: string, externalId: string, note: string) =>
    api<ReconciliationRun>(
      `/payment-reconciliation/${runId}/orphans/resolve`,
      json({ externalId, note }),
    ),

  /** Configuration du compte marchand (administrateur) */
  configs: () => api<PaymentConfig[]>('/payment-config'),
  upsertConfig: (b: UpsertPaymentConfigInput) => api<PaymentConfig>('/payment-config', put(b)),
  testConfig: (provider: string) =>
    api<PaymentConfig>(`/payment-config/${provider}/test`, json({})),
  setConfigStatus: (provider: string, status: 'ACTIVE' | 'DISABLED') =>
    api<PaymentConfig>(`/payment-config/${provider}/status`, patch({ status })),
  setFakeOutage: (on: boolean) =>
    api<{ outage: boolean }>('/dev/fake-provider/outage', json({ on })),

  /** Caisse factice (démo, sans authentification) */
  fakeTransaction: (externalId: string) =>
    apiPublic<{ externalId: string; amount: number; status: string }>(
      `/dev/fake-provider/transactions/${externalId}`,
    ),
  fakeComplete: (externalId: string, status: 'SUCCESS' | 'FAILED' | 'CANCELLED') =>
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/dev/fake-provider/transactions/${externalId}/complete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client': 'web/fake-checkout' },
        body: JSON.stringify({ status }),
      },
    ).then(async (r) => {
      if (!r.ok) throw new Error(`Caisse factice : ${r.status}`);
      return (await r.json()) as { data: { status: string; webhook: string } };
    }),
};

// ----------------------------------------------------------------------------- Phase 6 : reporting

export const reporting = {
  catalog: () => api<ReportDefinition[]>('/reports'),
  run: (key: ReportKey, q: { from?: string; to?: string; groupId?: string } = {}) =>
    api<ReportResult>(`/reports/${key}${qs(q)}`),
  downloadCsv: (key: ReportKey, q: { from?: string; to?: string; groupId?: string } = {}) =>
    downloadFile(`/reports/${key}.csv${qs(q)}`, `${key}.csv`),
  refresh: (full = false) =>
    api<{ queued?: boolean; attendanceRows?: number; financeRows?: number }>(
      '/reports/refresh',
      json({ full }),
    ),
  direction: () => api<DirectionDashboard>('/dashboards/direction'),
  pedagogy: (q: { from?: string; to?: string } = {}) =>
    api<PedagogyDashboard>(`/dashboards/pedagogy${qs(q)}`),
  channels: (q: { from?: string; to?: string } = {}) =>
    api<FinanceChannels>(`/dashboards/finance/channels${qs(q)}`),
  sheetTrace: (id: string) => api<SheetTrace>(`/trace/sheets/${id}`),
  notificationTrace: (id: string) => api<NotificationTrace>(`/trace/notifications/${id}`),

  scheduled: () => api<ScheduledReport[]>('/scheduled-reports'),
  createScheduled: (b: CreateScheduledReportInput) =>
    api<ScheduledReport>('/scheduled-reports', json(b)),
  updateScheduled: (id: string, b: Partial<CreateScheduledReportInput> & { enabled?: boolean }) =>
    api<ScheduledReport>(`/scheduled-reports/${id}`, patch(b)),
  removeScheduled: (id: string) => api<void>(`/scheduled-reports/${id}`, del()),
  sendScheduled: (id: string) => api<{ sent: number }>(`/scheduled-reports/${id}/send`, json({})),

  exports: () => api<TenantExport[]>('/tenant-exports'),
  requestExport: () => api<TenantExport>('/tenant-exports', json({})),
  exportStatus: (id: string) => api<TenantExport>(`/tenant-exports/${id}`),
  downloadExport: (id: string) =>
    downloadFile(`/tenant-exports/${id}/download`, 'export-polaris.zip'),
};

export interface PlatformTenant {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  timezone: string;
  activeMembers: number;
  createdAt?: string;
}
export const platform = {
  overview: () => api<PlatformOverview>('/platform/overview'),
  tenants: () => api<PlatformTenant[]>('/platform/tenants'),
  createTenant: (b: {
    code: string;
    name: string;
    type: string;
    timezone?: string;
    country?: string;
    adminEmail?: string;
  }) => api<PlatformTenant>('/platform/tenants', json(b)),
  setStatus: (id: string, status: string, reason?: string) =>
    api<PlatformTenant>(`/platform/tenants/${id}/status`, patch({ status, reason })),
  inviteAdmin: (id: string, email: string) =>
    api<{ invited: boolean }>(`/platform/tenants/${id}/admin-invitations`, json({ email })),
};

// ----------------------------------------------------------------------------- Phase 7 : durcissement

export const security = {
  mfa: () => api<MfaStatus>('/me/mfa'),
  mfaSetup: () =>
    api<{ secret: string; otpauthUrl: string; issuer: string; account: string }>(
      '/me/mfa/setup',
      json({}),
    ),
  mfaEnable: (code: string) =>
    api<{ enabled: true; recoveryCodes: string[] }>('/me/mfa/enable', json({ code })),
  mfaDisable: (factor: { code?: string; recoveryCode?: string }) =>
    api<{ enabled: false }>('/me/mfa/disable', json(factor)),
  mfaRecoveryCodes: (factor: { code?: string; recoveryCode?: string }) =>
    api<{ recoveryCodes: string[] }>('/me/mfa/recovery-codes', json(factor)),
  sessions: () => api<SessionInfo[]>('/me/sessions'),
  revokeSession: (familyId: string) => api<void>(`/me/sessions/${familyId}`, del()),
  logoutAll: () => api<void>('/auth/logout-all', json({})),
};

export const platformOps = {
  alerts: (status: 'open' | 'resolved' | 'all' = 'open') =>
    api<PlatformAlert[]>(`/platform/alerts${qs({ status })}`),
  evaluateAlerts: () =>
    api<{ opened: number; stillOpen: number; resolved: number; notified: number }>(
      '/platform/alerts/evaluate',
      json({}),
    ),
  ackAlert: (id: string) => api<PlatformAlert>(`/platform/alerts/${id}/ack`, json({})),
  impersonate: (tenantId: string, reason: string) =>
    api<ImpersonationGrant>(`/platform/tenants/${tenantId}/impersonate`, json({ reason })),
  impersonations: () => api<ImpersonationSession[]>('/platform/impersonations'),
  endImpersonation: (id: string) =>
    api<ImpersonationSession>(`/platform/impersonations/${id}/end`, json({})),
};

export const privacy = {
  requests: () => api<PrivacyRequest[]>('/privacy/requests'),
  exportStudent: (id: string) => api<PersonalDataExport>(`/privacy/students/${id}`),
  anonymizeStudent: (id: string, reason: string, force = false) =>
    api<AnonymizationResult>(`/privacy/students/${id}/anonymize`, json({ reason, force })),
  exportGuardian: (id: string) => api<PersonalDataExport>(`/privacy/guardians/${id}`),
  anonymizeGuardian: (id: string, reason: string) =>
    api<AnonymizationResult>(`/privacy/guardians/${id}/anonymize`, json({ reason })),
  mine: () => api<PersonalDataExport>('/me/personal-data'),
};

export const onboarding = {
  status: () => api<OnboardingStatus>('/onboarding'),
  dismiss: (dismissed: boolean) => api<OnboardingStatus>('/onboarding', patch({ dismissed })),
};

export const audit = {
  list: (q: Partial<AuditQuery> = {}) => apiEnvelope<AuditLog[], PageMeta>(`/audit-logs${qs(q)}`),
};
