import { z } from 'zod';
import { UuidSchema } from './common';
import { PermissionCodeSchema } from './auth';

export const RoleSchema = z.object({
  id: UuidSchema,
  name: z.string().min(2).max(60),
  description: z.string().max(240).nullable(),
  systemCode: z.string().nullable(),
  permissions: z.array(PermissionCodeSchema),
});
export const UpdateRolePermissionsSchema = z.object({
  permissions: z.array(PermissionCodeSchema).min(1),
});
export const AssignRolesSchema = z.object({
  roleIds: z.array(UuidSchema).min(1),
});
export const InviteMemberSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(120),
  roleIds: z.array(UuidSchema).min(1),
});
