import { z } from 'zod';

export const UuidSchema = z.string().uuid();
export const E164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Numéro au format E.164 attendu (+229…)');
export const EmailSchema = z
  .string()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase().trim());
export const SlugSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Lettres minuscules, chiffres et tirets');

/** Pagination par curseur (ADR-0009). */
export const CursorQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CursorQuery = z.infer<typeof CursorQuerySchema>;

export const PageMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  limit: z.number().int(),
});

export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: z.record(z.unknown()).optional() });
}
export function pageEnvelope<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), meta: PageMetaSchema });
}

/** Erreur RFC 9457 (application/problem+json). */
export const ProblemDetailsSchema = z.object({
  type: z.string().url().or(z.literal('about:blank')),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string(),
  traceId: z.string().optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string(), code: z.string().optional() }))
    .optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/** Codes d'erreur stables exposés aux clients (ne jamais renommer : additif seulement). */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  RATE_LIMITED: 'RATE_LIMITED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  OTP_INVALID: 'OTP_INVALID',
  LAST_ROLE_HOLDER: 'LAST_ROLE_HOLDER',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
