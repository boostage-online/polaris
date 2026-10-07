import { z } from 'zod';
import { CursorQuerySchema, UuidSchema } from './common';

export const AuditLogSchema = z.object({
  id: UuidSchema,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actorMembershipId: UuidSchema.nullable(),
  actorUserId: UuidSchema.nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  occurredAt: z.string().datetime(),
});
export const AuditQuerySchema = CursorQuerySchema.extend({
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  actorUserId: UuidSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
