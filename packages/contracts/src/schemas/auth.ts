import { z } from 'zod';
import { E164PhoneSchema, EmailSchema, UuidSchema } from './common';
import { PERMISSION_DEFINITIONS } from '../permissions';

export const PasswordSchema = z.string().min(10).max(256);
export const MembershipKindSchema = z.enum(['STAFF', 'GUARDIAN', 'PLATFORM']);

export const LoginPasswordSchema = z.object({
  identifier: z.union([EmailSchema, E164PhoneSchema]),
  password: PasswordSchema,
  /** Identifiant d'appareil stable généré par le client (mobile, ou navigateur). */
  deviceId: z.string().min(8).max(128).optional(),
  deviceLabel: z.string().max(120).optional(),
});
export type LoginPasswordInput = z.infer<typeof LoginPasswordSchema>;

export const RequestOtpSchema = z.object({ phone: E164PhoneSchema });
export const VerifyOtpSchema = z.object({
  phone: E164PhoneSchema,
  code: z.string().regex(/^\d{6}$/),
  deviceId: z.string().min(8).max(128).optional(),
  deviceLabel: z.string().max(120).optional(),
});

export const RefreshSchema = z.object({
  /** Absent côté web : le refresh est lu dans le cookie. */
  refreshToken: z.string().min(32).max(512).optional(),
});

export const SwitchMembershipSchema = z.object({ membershipId: UuidSchema });

export const MembershipSummarySchema = z.object({
  id: UuidSchema,
  kind: MembershipKindSchema,
  tenant: z
    .object({ id: UuidSchema, code: z.string(), name: z.string(), status: z.string() })
    .nullable(),
  roles: z.array(z.object({ id: UuidSchema, name: z.string() })),
});

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int(),
  /** Renvoyé dans le corps uniquement hors cookie (clients mobiles). */
  refreshToken: z.string().optional(),
  membership: MembershipSummarySchema.nullable(),
  memberships: z.array(MembershipSummarySchema),
  /** La session a passé la MFA (TOTP ou code de récupération). */
  mfa: z.boolean().optional(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

// --- MFA TOTP (ADR-0008, Partie 11) ---
/** Réponse de connexion quand la MFA est activée : pas de jetons, un défi à relever en 5 minutes. */
export const MfaChallengeSchema = z.object({
  mfaRequired: z.literal(true),
  challenge: z.string(),
  expiresIn: z.number().int(),
});
export type MfaChallenge = z.infer<typeof MfaChallengeSchema>;
export const LoginResponseSchema = z.union([TokenPairSchema, MfaChallengeSchema]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const TotpCodeSchema = z.string().regex(/^\d{6}$/, 'Code à 6 chiffres attendu');
export const RecoveryCodeSchema = z
  .string()
  .regex(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/i, 'Code de récupération XXXXX-XXXXX attendu');
export const MfaVerifySchema = z
  .object({
    challenge: z.string().min(16),
    code: TotpCodeSchema.optional(),
    recoveryCode: RecoveryCodeSchema.optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'Fournir un code TOTP ou un code de récupération',
  });
export const MfaSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
  issuer: z.string(),
  account: z.string(),
});
export const MfaEnableSchema = z.object({ code: TotpCodeSchema });
export const MfaEnableResponseSchema = z.object({
  enabled: z.literal(true),
  recoveryCodes: z.array(z.string()),
});
export const MfaDisableSchema = z.object({
  code: TotpCodeSchema.optional(),
  recoveryCode: RecoveryCodeSchema.optional(),
});
export const MfaStatusSchema = z.object({
  enabled: z.boolean(),
  enrolledAt: z.string().datetime().nullable(),
  /** La MFA est exigée pour ce compte (super admin ou permission sensible détenue). */
  required: z.boolean(),
  /** La session courante a passé la MFA. */
  sessionVerified: z.boolean(),
  recoveryCodesLeft: z.number().int(),
});
export type MfaStatus = z.infer<typeof MfaStatusSchema>;

export const PermissionCodeSchema = z.enum(
  PERMISSION_DEFINITIONS.map((p) => p.code) as [string, ...string[]],
);

export const MeSchema = z.object({
  user: z.object({
    id: UuidSchema,
    email: z.string().nullable(),
    phone: z.string().nullable(),
    displayName: z.string().nullable(),
    mfaEnabled: z.boolean(),
  }),
  membership: MembershipSummarySchema.nullable(),
  memberships: z.array(MembershipSummarySchema),
  permissions: z.array(z.string()),
  tenantTimezone: z.string().nullable(),
  /** La session courante a passé la MFA. */
  mfa: z.boolean().optional(),
  /** Session de support Super Admin (impersonation) : bannière obligatoire côté client. */
  impersonation: z
    .object({
      sessionId: UuidSchema,
      tenantId: UuidSchema,
      tenantName: z.string(),
      reason: z.string(),
      expiresAt: z.string().datetime(),
    })
    .nullable()
    .optional(),
});
export type Me = z.infer<typeof MeSchema>;

export const SessionSchema = z.object({
  familyId: UuidSchema,
  deviceLabel: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime(),
  current: z.boolean(),
});
