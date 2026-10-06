import { boolean, inet, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export type MembershipKind = 'STAFF' | 'GUARDIAN' | 'PLATFORM';
export type MembershipStatus = 'PENDING' | 'ACTIVE' | 'DISABLED';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  phoneE164: text('phone_e164'),
  passwordHash: text('password_hash'),
  displayName: text('display_name'),
  status: text('status').$type<'ACTIVE' | 'DISABLED'>().notNull(),
  mfaEnabled: boolean('mfa_enabled').notNull(),
  mfaSecretEncrypted: text('mfa_secret_encrypted'),
  tokenVersion: integer('token_version').notNull(),
  locale: text('locale').notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  tenantId: uuid('tenant_id'),
  kind: text('kind').$type<MembershipKind>().notNull(),
  status: text('status').$type<MembershipStatus>().notNull(),
  permissionsVersion: integer('permissions_version').notNull(),
  invitedBy: uuid('invited_by'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  membershipId: uuid('membership_id'),
  familyId: uuid('family_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  deviceId: text('device_id'),
  deviceLabel: text('device_label'),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  replacedBy: uuid('replaced_by'),
});

export const otpCodes = pgTable('otp_codes', {
  id: uuid('id').primaryKey(),
  phoneE164: text('phone_e164').notNull(),
  purpose: text('purpose').$type<'LOGIN' | 'ACTIVATION'>().notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const tenantInvitations = pgTable('tenant_invitations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  roleIds: uuid('role_ids').array().notNull(),
  tokenHash: text('token_hash').notNull(),
  invitedBy: uuid('invited_by'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
