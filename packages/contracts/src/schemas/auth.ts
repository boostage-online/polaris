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
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

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
});
export type Me = z.infer<typeof MeSchema>;

export const SessionSchema = z.object({
  familyId: UuidSchema,
  deviceLabel: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime(),
  current: z.boolean(),
});
