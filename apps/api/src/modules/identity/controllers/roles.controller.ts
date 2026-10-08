import { Controller, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  AssignRolesSchema,
  InviteMemberSchema,
  MfaResetResultSchema,
  RoleSchema,
  SupportMfaResetSchema,
  UpdateRolePermissionsSchema,
  type Permission,
} from '@polaris/contracts';
import {
  ApiDoc,
  CurrentActor,
  RequirePermission,
  ZodBody,
  ZodParams,
} from '../../../common/decorators';
import { RequestContextStore, type Actor } from '../../../database/request-context';
import { InvitationService } from '../application/invitation.service';
import { MfaService } from '../application/mfa.service';
import { RoleService } from '../application/role.service';

const IdParams = z.object({ id: z.string().uuid() });
const MembershipParams = z.object({ membershipId: z.string().uuid() });
const DuplicateSchema = z.object({ name: z.string().min(2).max(60) });

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RoleService) {}

  @Get()
  @RequirePermission('MANAGE_USERS')
  @ApiDoc({ summary: "Rôles de l'établissement", tags: ['rbac'], response: z.array(RoleSchema) })
  list() {
    return this.roles.list();
  }

  @Get(':id')
  @RequirePermission('MANAGE_USERS')
  @ApiDoc({ summary: 'Détail d’un rôle', tags: ['rbac'], params: IdParams, response: RoleSchema })
  get(@ZodParams(IdParams) params: z.infer<typeof IdParams>) {
    return this.roles.get(params.id);
  }

  @Patch(':id/permissions')
  @RequirePermission('MANAGE_ROLES')
  @ApiDoc({
    summary: "Remplacer les permissions d'un rôle",
    tags: ['rbac'],
    params: IdParams,
    body: UpdateRolePermissionsSchema,
    response: RoleSchema,
  })
  update(
    @ZodParams(IdParams) params: z.infer<typeof IdParams>,
    @ZodBody(UpdateRolePermissionsSchema) body: z.infer<typeof UpdateRolePermissionsSchema>,
  ) {
    return this.roles.updatePermissions(params.id, body.permissions as Permission[]);
  }

  @Post(':id/duplicate')
  @RequirePermission('MANAGE_ROLES')
  @ApiDoc({
    summary: 'Dupliquer un rôle',
    tags: ['rbac'],
    params: IdParams,
    body: DuplicateSchema,
    response: RoleSchema,
    status: 201,
  })
  duplicate(
    @ZodParams(IdParams) params: z.infer<typeof IdParams>,
    @ZodBody(DuplicateSchema) body: z.infer<typeof DuplicateSchema>,
  ) {
    return this.roles.duplicate(params.id, body.name);
  }
}

@Controller('members')
export class MembersController {
  constructor(
    private readonly roles: RoleService,
    private readonly invitations: InvitationService,
    private readonly mfa: MfaService,
  ) {}

  @Get()
  @RequirePermission('MANAGE_USERS')
  @ApiDoc({ summary: 'Membres du personnel et leurs rôles', tags: ['rbac'] })
  list() {
    return this.roles.listMembers();
  }

  @Put(':membershipId/roles')
  @RequirePermission('MANAGE_ROLES')
  @ApiDoc({
    summary: "Remplacer les rôles d'un membre",
    tags: ['rbac'],
    params: MembershipParams,
    body: AssignRolesSchema,
  })
  assign(
    @ZodParams(MembershipParams) params: z.infer<typeof MembershipParams>,
    @ZodBody(AssignRolesSchema) body: z.infer<typeof AssignRolesSchema>,
  ) {
    return this.roles.assignRoles(params.membershipId, body.roleIds);
  }

  @Post('invitations')
  @RequirePermission('MANAGE_USERS')
  @ApiDoc({
    summary: 'Inviter un membre du personnel',
    tags: ['rbac'],
    body: InviteMemberSchema,
    status: 201,
  })
  invite(
    @ZodBody(InviteMemberSchema) body: z.infer<typeof InviteMemberSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.invitations.invite({
      tenantId: RequestContextStore.require().tenantId!,
      ...body,
      invitedBy: actor.userId,
    });
  }

  @Post(':membershipId/mfa-reset')
  @HttpCode(200)
  @RequirePermission('RESET_USER_MFA')
  @ApiDoc({
    summary:
      "Réinitialiser la MFA d'un membre (téléphone perdu, plus de code de récupération) : sessions révoquées, motif journalisé",
    tags: ['rbac'],
    params: MembershipParams,
    body: SupportMfaResetSchema,
    response: MfaResetResultSchema,
  })
  resetMfa(
    @ZodParams(MembershipParams) params: z.infer<typeof MembershipParams>,
    @ZodBody(SupportMfaResetSchema) body: z.infer<typeof SupportMfaResetSchema>,
  ) {
    return this.mfa.resetByAdmin(
      { membershipId: params.membershipId, tenantId: RequestContextStore.require().tenantId! },
      body.reason,
    );
  }
}
