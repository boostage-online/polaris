import { z } from 'zod';
import { UuidSchema } from './common';

/** Durcissement (Phase 7) : impersonation Super Admin, alertes de supervision, RGPD, onboarding. */

// --- Impersonation Super Admin (Partie 11 : 30 min, bannière, journalisée, sans action financière) ---
export const ImpersonateSchema = z.object({
  reason: z.string().min(5).max(500),
});
export const ImpersonationGrantSchema = z.object({
  sessionId: UuidSchema,
  accessToken: z.string(),
  expiresAt: z.string().datetime(),
  tenant: z.object({ id: UuidSchema, code: z.string(), name: z.string() }),
  /** Permissions effectives de la session de support (sans action financière). */
  permissions: z.array(z.string()),
});
export type ImpersonationGrant = z.infer<typeof ImpersonationGrantSchema>;
export const ImpersonationSessionSchema = z.object({
  id: UuidSchema,
  platformUserId: UuidSchema,
  platformUserName: z.string().nullable(),
  tenantId: UuidSchema,
  tenantName: z.string(),
  reason: z.string(),
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  active: z.boolean(),
});
export type ImpersonationSession = z.infer<typeof ImpersonationSessionSchema>;

// --- Alertes de supervision ---
export const AlertSeveritySchema = z.enum(['WARNING', 'CRITICAL']);
export const PlatformAlertSchema = z.object({
  id: UuidSchema,
  key: z.string(),
  severity: AlertSeveritySchema,
  title: z.string(),
  detail: z.record(z.string(), z.unknown()),
  tenantId: UuidSchema.nullable(),
  tenantName: z.string().nullable(),
  openedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  notifiedAt: z.string().datetime().nullable(),
  acknowledgedAt: z.string().datetime().nullable(),
  acknowledgedByName: z.string().nullable(),
});
export type PlatformAlert = z.infer<typeof PlatformAlertSchema>;
export const AlertsQuerySchema = z.object({
  status: z.enum(['open', 'resolved', 'all']).default('open'),
});
export const AlertsEvaluationSchema = z.object({
  evaluatedAt: z.string().datetime(),
  opened: z.number().int(),
  stillOpen: z.number().int(),
  resolved: z.number().int(),
  notified: z.number().int(),
});

// --- Données personnelles (RGPD / loi 2017-20) ---
export const PersonalDataExportSchema = z.object({
  generatedAt: z.string().datetime(),
  subject: z.object({
    type: z.enum(['STUDENT', 'GUARDIAN']),
    id: UuidSchema,
  }),
  tenant: z.object({ id: UuidSchema, code: z.string(), name: z.string() }),
  /** Sections nommées : identité, inscriptions, tuteurs, assiduité, justificatifs, finance, notifications, audit. */
  sections: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  counts: z.record(z.string(), z.number().int()),
});
export type PersonalDataExport = z.infer<typeof PersonalDataExportSchema>;
export const AnonymizeSchema = z.object({
  reason: z.string().min(5).max(500),
  /** Anonymiser même si le délai de conservation n'est pas écoulé (demande explicite, décision documentée). */
  force: z.boolean().default(false),
});
export const AnonymizationResultSchema = z.object({
  subjectType: z.enum(['STUDENT', 'GUARDIAN']),
  subjectId: UuidSchema,
  anonymizedAt: z.string().datetime(),
  /** Nombre de lignes touchées par table. */
  touched: z.record(z.string(), z.number().int()),
});
export type AnonymizationResult = z.infer<typeof AnonymizationResultSchema>;
export const PrivacyRequestSchema = z.object({
  id: UuidSchema,
  kind: z.enum(['EXPORT', 'ERASURE']),
  subjectType: z.enum(['STUDENT', 'GUARDIAN']),
  subjectId: UuidSchema,
  requestedByName: z.string().nullable(),
  reason: z.string().nullable(),
  source: z.enum(['MANUAL', 'RETENTION', 'SELF_SERVICE']),
  summary: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type PrivacyRequest = z.infer<typeof PrivacyRequestSchema>;
export const RetentionRunSchema = z.object({
  ranAt: z.string().datetime(),
  studentsAnonymized: z.number().int(),
  guardiansAnonymized: z.number().int(),
  skipped: z.boolean(),
});

// --- Onboarding self-service d'un établissement ---
export const OnboardingStepSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  done: z.boolean(),
  optional: z.boolean(),
  /** Chemin de l'écran web qui permet de réaliser l'étape. */
  href: z.string(),
  /** Permission nécessaire pour réaliser l'étape. */
  permission: z.string(),
  detail: z.string().nullable(),
});
export const OnboardingStatusSchema = z.object({
  steps: z.array(OnboardingStepSchema),
  completed: z.number().int(),
  required: z.number().int(),
  total: z.number().int(),
  /** Toutes les étapes obligatoires sont faites. */
  ready: z.boolean(),
  dismissedAt: z.string().datetime().nullable(),
});
export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;
export const OnboardingDismissSchema = z.object({ dismissed: z.boolean() });
