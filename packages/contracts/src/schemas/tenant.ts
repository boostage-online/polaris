import { z } from 'zod';
import { SlugSchema, UuidSchema } from './common';

export const TenantTypeSchema = z.enum(['SCHOOL', 'UNIVERSITY', 'TRAINING_CENTER']);
export const TenantStatusSchema = z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED']);
export const TenantPlanSchema = z.enum(['PILOT', 'STANDARD', 'PREMIUM']);
export type TenantPlan = z.infer<typeof TenantPlanSchema>;

export const TenantSchema = z.object({
  id: UuidSchema,
  code: SlugSchema,
  name: z.string().min(2).max(120),
  type: TenantTypeSchema,
  status: TenantStatusSchema,
  timezone: z.string().min(3).max(64),
  country: z.string().length(2),
  createdAt: z.string().datetime(),
  /** Lancement (Phase 8) : offre, date de mise en production, fin de l'hypercare. */
  plan: TenantPlanSchema.optional(),
  liveAt: z.string().datetime().nullable().optional(),
  hypercareUntil: z.string().datetime().nullable().optional(),
});
export type Tenant = z.infer<typeof TenantSchema>;

export const CreateTenantSchema = TenantSchema.pick({
  code: true,
  name: true,
  type: true,
  timezone: true,
  country: true,
}).extend({
  timezone: z.string().min(3).max(64).default('Africa/Porto-Novo'),
  country: z.string().length(2).default('BJ'),
  adminEmail: z.string().email().optional(),
});
export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

export const UpdateTenantStatusSchema = z.object({
  status: TenantStatusSchema,
  reason: z.string().min(3).max(500).optional(),
});
