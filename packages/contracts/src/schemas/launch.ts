import { z } from 'zod';
import { UuidSchema } from './common';
import { OnboardingStatusSchema } from './hardening';
import { TenantPlanSchema } from './tenant';

/**
 * Lancement production et hypercare (Phase 8) : mise en production d'un établissement, adoption du parc,
 * revue quotidienne, disponibilité mesurée, consommation mensuelle, outils du support niveau 1.
 */

// --- Mise en production d'un établissement -----------------------------------------------------------

/** Points que seul un humain peut confirmer avant la bascule (contrat, budget, astreinte). */
export const LaunchChecklistSchema = z.object({
  contractSigned: z.boolean().default(false),
  smsBudgetValidated: z.boolean().default(false),
  onCallInformed: z.boolean().default(false),
  dataValidatedByTenant: z.boolean().default(false),
});
export type LaunchChecklist = z.infer<typeof LaunchChecklistSchema>;

export const LaunchCheckSchema = z.object({
  key: z.string(),
  title: z.string(),
  ok: z.boolean(),
  /** Un point bloquant empêche la mise en production ; les autres sont des avertissements. */
  blocking: z.boolean(),
  detail: z.string().nullable(),
});
export const LaunchReadinessSchema = z.object({
  tenant: z.object({
    id: UuidSchema,
    code: z.string(),
    name: z.string(),
    status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED']),
    plan: TenantPlanSchema,
    liveAt: z.string().datetime().nullable(),
    hypercareUntil: z.string().datetime().nullable(),
  }),
  onboarding: OnboardingStatusSchema,
  checklist: LaunchChecklistSchema,
  checks: z.array(LaunchCheckSchema),
  ready: z.boolean(),
  live: z.boolean(),
  inHypercare: z.boolean(),
});
export type LaunchReadiness = z.infer<typeof LaunchReadinessSchema>;

export const GoLiveSchema = z.object({
  plan: TenantPlanSchema,
  checklist: LaunchChecklistSchema,
  /** Durée de l'hypercare après la bascule (revue quotidienne renforcée). */
  hypercareDays: z.number().int().min(7).max(60).default(28),
  notes: z.string().max(1000).optional(),
});
export type GoLiveInput = z.infer<typeof GoLiveSchema>;

// --- Adoption du parc ------------------------------------------------------------------------------------

export const AdoptionTenantSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED']),
  plan: TenantPlanSchema,
  liveAt: z.string().datetime().nullable(),
  daysLive: z.number().int().nullable(),
  inHypercare: z.boolean(),
  students: z.number().int(),
  guardians: z.number().int(),
  guardiansActivated: z.number().int(),
  /** % de tuteurs ayant activé leur espace (G8 : ≥ 70 %). */
  activationRate: z.number().nullable(),
  teachers: z.number().int(),
  teachersActive7d: z.number().int(),
  sheetsExpected7d: z.number().int(),
  sheetsSubmitted7d: z.number().int(),
  /** % de séances tenues avec appel soumis sur 7 jours. */
  sheetRate7d: z.number().nullable(),
  onlineShare30d: z.number().nullable(),
  smsMonth: z.number().int(),
  smsCap: z.number().int(),
  openAlerts: z.number().int(),
  meetsG8: z.boolean(),
});
export const AdoptionWeekSchema = z.object({
  weekStart: z.string(),
  guardiansActivated: z.number().int(),
  sheetRate: z.number().nullable(),
  onlinePayments: z.number().int(),
});
export const AdoptionOverviewSchema = z.object({
  generatedAt: z.string().datetime(),
  fleet: z.object({
    tenants: z.number().int(),
    live: z.number().int(),
    inHypercare: z.number().int(),
    students: z.number().int(),
    guardians: z.number().int(),
    guardiansActivated: z.number().int(),
    activationRate: z.number().nullable(),
    sheetRate7d: z.number().nullable(),
    tenantsMeetingG8: z.number().int(),
  }),
  tenants: z.array(AdoptionTenantSchema),
  weekly: z.array(AdoptionWeekSchema),
});
export type AdoptionOverview = z.infer<typeof AdoptionOverviewSchema>;

// --- Revue quotidienne (hypercare) ------------------------------------------------------------------------

export const DailyReviewTenantSchema = z.object({
  tenantId: UuidSchema,
  code: z.string(),
  name: z.string(),
  inHypercare: z.boolean(),
  openAlerts: z.number().int(),
  unknownAttempts: z.number().int(),
  pendingOver1h: z.number().int(),
  reconciliation: z.enum(['OK', 'DISCREPANCIES', 'NONE', 'ERROR']),
  ledgerMismatches: z.number().int().nullable(),
  smsRatio: z.number().nullable(),
  importsFailed: z.number().int(),
  notificationsFailed: z.number().int(),
  sheetsMissing: z.number().int(),
  guardiansActivatedDelta: z.number().int(),
  /** Points d'attention lisibles (vide = journée saine). */
  flags: z.array(z.string()),
});
export const DailyReviewSchema = z.object({
  day: z.string(),
  generatedAt: z.string().datetime(),
  summary: z.object({
    availability24h: z.number().nullable(),
    availabilityChecks: z.number().int(),
    openAlerts: z.number().int(),
    criticalAlerts: z.number().int(),
    unknownAttempts: z.number().int(),
    reconciliationGaps: z.number().int(),
    ledgerMismatches: z.number().int(),
    tenantsOverSmsBudget: z.number().int(),
    importsFailed: z.number().int(),
    notificationsFailed: z.number().int(),
    tenantsInHypercare: z.number().int(),
    tenantsFlagged: z.number().int(),
    /** Jour « sain » : aucun indicateur ne demande d'action. */
    healthy: z.boolean(),
  }),
  tenants: z.array(DailyReviewTenantSchema),
  reviewedAt: z.string().datetime().nullable(),
  reviewedBy: z.string().nullable(),
  notes: z.string().nullable(),
});
export type DailyReview = z.infer<typeof DailyReviewSchema>;
export const DailyReviewAckSchema = z.object({ notes: z.string().max(2000).optional() });
export const DailyReviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(90).default(30),
});
export const DayParamsSchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

// --- Disponibilité mesurée (G8 : ≥ 99,5 % sur le mois) -----------------------------------------------------

export const AvailabilityDaySchema = z.object({
  day: z.string(),
  checks: z.number().int(),
  failures: z.number().int(),
  availability: z.number().nullable(),
  p95LatencyMs: z.number().int().nullable(),
});
export const AvailabilitySchema = z.object({
  windowDays: z.number().int(),
  checks: z.number().int(),
  failures: z.number().int(),
  availability: z.number().nullable(),
  /** Objectif G8. */
  target: z.number(),
  meetsTarget: z.boolean().nullable(),
  lastCheckAt: z.string().datetime().nullable(),
  lastCheckOk: z.boolean().nullable(),
  days: z.array(AvailabilityDaySchema),
});
export type Availability = z.infer<typeof AvailabilitySchema>;
export const AvailabilityQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export const ProbeResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int(),
  detail: z.string().nullable(),
  checkedAt: z.string().datetime(),
});

/** Page publique d'état du service : aucune donnée nominative, aucune information sur un établissement. */
export const PublicStatusSchema = z.object({
  status: z.enum(['OPERATIONAL', 'DEGRADED', 'OUTAGE', 'UNKNOWN']),
  checkedAt: z.string().datetime().nullable(),
  availability30d: z.number().nullable(),
  days: z.array(
    z.object({ day: z.string(), availability: z.number().nullable(), checks: z.number().int() }),
  ),
});
export type PublicStatus = z.infer<typeof PublicStatusSchema>;

// --- Consommation mensuelle (mesure pour la tarification, Partie 18) -------------------------------------------

export const UsageMonthSchema = z.object({
  tenantId: UuidSchema,
  code: z.string(),
  name: z.string(),
  plan: TenantPlanSchema,
  month: z.string(),
  activeStudents: z.number().int(),
  guardians: z.number().int(),
  guardiansActivated: z.number().int(),
  staffActive: z.number().int(),
  sheetsSubmitted: z.number().int(),
  smsSent: z.number().int(),
  emailsSent: z.number().int(),
  onlinePayments: z.number().int(),
  onlineAmount: z.number().int(),
  manualPayments: z.number().int(),
  manualAmount: z.number().int(),
  computedAt: z.string().datetime(),
});
export type UsageMonth = z.infer<typeof UsageMonthSchema>;
export const UsageQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

// --- Support niveau 1 ---------------------------------------------------------------------------------------

export const SupportLookupQuerySchema = z.object({ q: z.string().trim().min(3).max(120) });
export const SupportUserSchema = z.object({
  id: UuidSchema,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  displayName: z.string().nullable(),
  status: z.enum(['ACTIVE', 'DISABLED']),
  mfaEnabled: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  /** Verrouillage anti-force-brute en cours (secondes restantes), par identifiant. */
  lockedFor: z.number().int().nullable(),
  activeSessions: z.number().int(),
  memberships: z.array(
    z.object({
      id: UuidSchema,
      kind: z.enum(['STAFF', 'GUARDIAN', 'PLATFORM']),
      status: z.string(),
      tenantId: UuidSchema.nullable(),
      tenantCode: z.string().nullable(),
      tenantName: z.string().nullable(),
      roles: z.array(z.string()),
    }),
  ),
  pendingInvitations: z.number().int(),
  guardianLinks: z.number().int(),
});
export const SupportLookupSchema = z.object({
  query: z.string(),
  users: z.array(SupportUserSchema),
  /** Tuteurs trouvés par téléphone qui n'ont pas encore de compte (invitation à relancer par l'établissement). */
  guardiansWithoutAccount: z.array(
    z.object({
      tenantCode: z.string(),
      tenantName: z.string(),
      displayName: z.string(),
      phone: z.string().nullable(),
      invitedAt: z.string().datetime().nullable(),
    }),
  ),
});
export type SupportLookup = z.infer<typeof SupportLookupSchema>;
export const SupportUnlockSchema = z.object({ identifier: z.string().trim().min(3).max(200) });
export const SupportMfaResetSchema = z.object({
  reason: z.string().min(5).max(500),
});
export const MfaResetResultSchema = z.object({
  userId: UuidSchema,
  mfaEnabled: z.literal(false),
  sessionsRevoked: z.number().int(),
});
