import { z } from 'zod';
import { CursorQuerySchema, QueryBoolSchema, UuidSchema } from './common';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ attendue');
/** Montants entiers en XOF (ADR-0005) ; positifs sauf ajustements (signés). */
const Amount = z.number().int().min(0).max(1_000_000_000_000);
const SignedAmount = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
const Code = z
  .string()
  .min(1)
  .max(30)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Code en majuscules, chiffres, - ou _');

// --- Catalogue : catégories et grilles ---
export const FeeCategorySchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  structureCount: z.number().int().optional(),
});
export const CreateFeeCategorySchema = z.object({ code: Code, name: z.string().min(1).max(120) });
export const UpdateFeeCategorySchema = CreateFeeCategorySchema.partial();

export const ScheduleItemSchema = z.object({
  id: UuidSchema.optional(),
  seq: z.number().int().min(1),
  label: z.string().min(1).max(80),
  amount: Amount,
  dueDate: IsoDate,
});
export const FeeTargetSchema = z.object({
  programIds: z.array(UuidSchema).default([]),
  levelIds: z.array(UuidSchema).default([]),
  groupIds: z.array(UuidSchema).default([]),
});
export const FeeStructureSchema = z.object({
  id: UuidSchema,
  academicYearId: UuidSchema,
  categoryId: UuidSchema,
  categoryName: z.string().optional(),
  code: z.string(),
  name: z.string(),
  totalAmount: Amount,
  currency: z.string(),
  appliesTo: FeeTargetSchema,
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  schedule: z.array(ScheduleItemSchema),
  assignedCount: z.number().int().optional(),
});
export const CreateFeeStructureSchema = z
  .object({
    academicYearId: UuidSchema.optional(),
    categoryId: UuidSchema,
    code: Code,
    name: z.string().min(1).max(120),
    appliesTo: FeeTargetSchema.default({ programIds: [], levelIds: [], groupIds: [] }),
    schedule: z
      .array(ScheduleItemSchema.omit({ id: true }))
      .min(1)
      .max(24),
  })
  .refine((v) => new Set(v.schedule.map((s) => s.seq)).size === v.schedule.length, {
    message: 'Numéros d’échéance en double',
    path: ['schedule'],
  });
export const UpdateFeeStructureSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  categoryId: UuidSchema.optional(),
  appliesTo: FeeTargetSchema.optional(),
  /** Remplace l'échéancier ; refusé si des créances existent déjà (les créances sont figées). */
  schedule: z
    .array(ScheduleItemSchema.omit({ id: true }))
    .min(1)
    .max(24)
    .optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export const FeeStructuresQuerySchema = z.object({
  academicYearId: UuidSchema.optional(),
  categoryId: UuidSchema.optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

// --- Affectation ---
export const AssignFeesSchema = z.object({
  feeStructureId: UuidSchema,
  target: z
    .object({
      groupIds: z.array(UuidSchema).default([]),
      levelIds: z.array(UuidSchema).default([]),
      studentIds: z.array(UuidSchema).default([]),
      /** Sans cible explicite : la cible `appliesTo` de la grille. */
      useStructureTarget: z.boolean().default(true),
    })
    .default({ groupIds: [], levelIds: [], studentIds: [], useStructureTarget: true }),
  /** Date de référence des inscriptions actives (défaut : aujourd'hui). */
  asOf: IsoDate.optional(),
});
export const AssignmentReportSchema = z.object({
  assignmentId: UuidSchema,
  feeStructureId: UuidSchema,
  targeted: z.number().int(),
  created: z.number().int(),
  skipped: z.number().int(),
  creditsApplied: z.number().int(),
});
export const AssignStudentFeesSchema = z.object({ feeStructureIds: z.array(UuidSchema).min(1) });

// --- Créances ---
export const InstallmentStatusSchema = z.enum([
  'PENDING',
  'DUE',
  'OVERDUE',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
]);
export const StudentFeeStatusSchema = z.enum(['OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']);
export const InstallmentSchema = z.object({
  id: UuidSchema,
  studentFeeId: UuidSchema,
  seq: z.number().int(),
  label: z.string(),
  amountDue: Amount,
  adjustmentsTotal: SignedAmount,
  amountAllocated: Amount,
  /** dû + ajustements − alloué */
  balance: SignedAmount,
  dueDate: IsoDate,
  status: InstallmentStatusSchema,
  feeName: z.string().optional(),
  student: z
    .object({
      id: UuidSchema,
      firstName: z.string(),
      lastName: z.string(),
      matricule: z.string(),
      groupName: z.string().nullable(),
    })
    .optional(),
  remindersCount: z.number().int().optional(),
});
export const StudentFeeSchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  feeStructureId: UuidSchema,
  feeName: z.string(),
  categoryName: z.string().nullable().optional(),
  academicYearId: UuidSchema,
  totalAmount: Amount,
  adjustmentsTotal: SignedAmount,
  amountAllocated: Amount,
  balance: SignedAmount,
  status: StudentFeeStatusSchema,
  installments: z.array(InstallmentSchema).optional(),
  createdAt: z.string().datetime(),
});
export const AdjustmentKindSchema = z.enum([
  'DISCOUNT',
  'SCHOLARSHIP',
  'WAIVER',
  'PENALTY',
  'CORRECTION',
]);
export const CreateAdjustmentSchema = z.object({
  studentFeeId: UuidSchema,
  installmentId: UuidSchema.optional(),
  amount: SignedAmount.refine((a) => a !== 0, 'Montant non nul requis'),
  kind: AdjustmentKindSchema,
  reason: z.string().min(3).max(500),
});
export const AdjustmentSchema = z.object({
  id: UuidSchema,
  studentFeeId: UuidSchema,
  installmentId: UuidSchema.nullable(),
  amount: SignedAmount,
  kind: AdjustmentKindSchema,
  reason: z.string(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

// --- Paiements ---
export const PaymentMethodSchema = z.enum([
  'CASH',
  'BANK_TRANSFER',
  'CHEQUE',
  'MOBILE_MONEY_OFFLINE',
  'MOBILE_MONEY',
  'CARD',
]);
export const PaymentSchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  student: z
    .object({ firstName: z.string(), lastName: z.string(), matricule: z.string() })
    .optional(),
  amount: Amount,
  currency: z.string(),
  source: z.enum(['MANUAL', 'ELECTRONIC']),
  method: PaymentMethodSchema,
  status: z.enum(['COMPLETED', 'REVERSED']),
  payerName: z.string().nullable(),
  valueDate: IsoDate,
  reference: z.string().nullable(),
  comment: z.string().nullable(),
  recordedByName: z.string().nullable().optional(),
  allocatedAmount: Amount.optional(),
  creditAmount: Amount.optional(),
  receiptNumber: z.string().nullable().optional(),
  reversedAt: z.string().datetime().nullable(),
  reversalReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  allocations: z
    .array(
      z.object({
        installmentId: UuidSchema,
        label: z.string(),
        feeName: z.string(),
        amount: SignedAmount,
      }),
    )
    .optional(),
});
export const RecordManualPaymentSchema = z.object({
  amount: Amount.min(1),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_MONEY_OFFLINE']),
  valueDate: IsoDate.optional(),
  payerName: z.string().max(120).nullable().optional(),
  reference: z.string().max(80).nullable().optional(),
  comment: z.string().max(500).nullable().optional(),
  /** Échéances ciblées (ordre d'imputation) ; sinon les plus anciennes d'abord. */
  installmentIds: z.array(UuidSchema).max(50).default([]),
});
export const ReversePaymentSchema = z.object({ reason: z.string().min(3).max(500) });
export const PaymentsQuerySchema = CursorQuerySchema.extend({
  studentId: UuidSchema.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  method: PaymentMethodSchema.optional(),
  source: z.enum(['MANUAL', 'ELECTRONIC']).optional(),
  status: z.enum(['COMPLETED', 'REVERSED']).optional(),
  recordedBy: UuidSchema.optional(),
  mine: QueryBoolSchema.optional(),
});

export const StudentCreditSchema = z.object({
  id: UuidSchema,
  paymentId: UuidSchema,
  amount: Amount,
  remaining: Amount,
  status: z.enum(['OPEN', 'APPLIED', 'REFUNDED']),
  createdAt: z.string().datetime(),
});

/** Compte d'un élève : tout ce qu'il faut pour répondre « combien doit-il, qu'a-t-il payé ? » */
export const StudentAccountSchema = z.object({
  student: z.object({
    id: UuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    matricule: z.string(),
    groupName: z.string().nullable(),
  }),
  totals: z.object({
    due: Amount,
    paid: Amount,
    balance: SignedAmount,
    dueNow: Amount,
    overdue: Amount,
    credit: Amount,
  }),
  fees: z.array(StudentFeeSchema),
  payments: z.array(PaymentSchema),
  credits: z.array(StudentCreditSchema),
  adjustments: z.array(AdjustmentSchema),
});

// --- Reçus ---
export const ReceiptSchema = z.object({
  id: UuidSchema,
  number: z.string(),
  kind: z.enum(['PAYMENT', 'CANCELLATION']),
  paymentId: UuidSchema,
  amount: Amount,
  issuedAt: z.string().datetime(),
  verifyUrl: z.string(),
  snapshot: z.record(z.string(), z.unknown()),
});
export const ReceiptVerificationSchema = z.object({
  number: z.string(),
  valid: z.boolean(),
  status: z.enum(['VALID', 'CANCELLED', 'UNKNOWN']),
  amount: Amount.nullable(),
  currency: z.string().nullable(),
  issuedAt: z.string().datetime().nullable(),
  tenantName: z.string().nullable(),
});

// --- Impayés, rappels, exports ---
export const UnpaidQuerySchema = CursorQuerySchema.extend({
  groupId: UuidSchema.optional(),
  feeStructureId: UuidSchema.optional(),
  status: z.enum(['DUE', 'OVERDUE', 'ALL_OPEN']).default('ALL_OPEN'),
  q: z.string().max(80).optional(),
});
export const UnpaidByGroupSchema = z.object({
  groupId: UuidSchema,
  groupName: z.string(),
  students: z.number().int(),
  due: Amount,
  paid: Amount,
  balance: SignedAmount,
  overdue: Amount,
  recoveryRate: z.number().int().nullable(),
});
export const SendRemindersSchema = z.object({
  installmentIds: z.array(UuidSchema).min(1).max(500),
  message: z.string().max(240).optional(),
});
export const ReminderReportSchema = z.object({
  installments: z.number().int(),
  guardians: z.number().int(),
  skipped: z.number().int(),
});
export const ExportQuerySchema = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  groupId: UuidSchema.optional(),
});

// --- Tableaux de bord ---
export const FinanceDashboardSchema = z.object({
  year: z.object({
    invoiced: Amount,
    paid: Amount,
    outstanding: SignedAmount,
    overdue: Amount,
    credits: Amount,
    recoveryRate: z.number().int().nullable(),
  }),
  today: z.object({
    count: z.number().int(),
    amount: Amount,
    byMethod: z.array(
      z.object({ method: PaymentMethodSchema, amount: Amount, count: z.number().int() }),
    ),
    byCashier: z.array(
      z.object({
        userId: UuidSchema.nullable(),
        name: z.string().nullable(),
        amount: Amount,
        count: z.number().int(),
      }),
    ),
  }),
  month: z.object({ amount: Amount, count: Amount }),
  upcoming7d: z.object({ installments: z.number().int(), amount: Amount }),
  byGroup: z.array(UnpaidByGroupSchema),
  integrity: z.object({
    checkedAt: z.string().datetime().nullable(),
    mismatches: z.number().int(),
  }),
  studentsWithoutFees: z.number().int(),
});
export const ChildFinanceSummarySchema = z.object({
  student: z.object({
    id: UuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    matricule: z.string(),
    groupName: z.string().nullable(),
  }),
  canPay: z.boolean(),
  totals: StudentAccountSchema.shape.totals,
  nextInstallment: InstallmentSchema.nullable(),
  openInstallments: z.array(InstallmentSchema),
  recentPayments: z.array(PaymentSchema),
});

export type FeeCategory = z.infer<typeof FeeCategorySchema>;
export type FeeStructure = z.infer<typeof FeeStructureSchema>;
export type CreateFeeStructureInput = z.input<typeof CreateFeeStructureSchema>;
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;
export type AssignmentReport = z.infer<typeof AssignmentReportSchema>;
export type Installment = z.infer<typeof InstallmentSchema>;
export type StudentFee = z.infer<typeof StudentFeeSchema>;
export type Adjustment = z.infer<typeof AdjustmentSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type StudentCredit = z.infer<typeof StudentCreditSchema>;
export type StudentAccount = z.infer<typeof StudentAccountSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type ReceiptVerification = z.infer<typeof ReceiptVerificationSchema>;
export type UnpaidByGroup = z.infer<typeof UnpaidByGroupSchema>;
export type FinanceDashboard = z.infer<typeof FinanceDashboardSchema>;
export type ChildFinanceSummary = z.infer<typeof ChildFinanceSummarySchema>;
export type RecordManualPaymentInput = z.input<typeof RecordManualPaymentSchema>;
