import { Controller, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  CreateTenantSchema,
  UpdateTenantStatusSchema,
  type CreateTenantInput,
} from '@polaris/contracts';
import { ApiDoc, RequirePermission, Scope, ZodBody, ZodParams } from '../../../common/decorators';
import { PlatformService } from '../application/platform.service';

const IdParams = z.object({ id: z.string().uuid() });
const InviteAdminSchema = z.object({ email: z.string().email() });

@Controller('platform/tenants')
@Scope('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  @RequirePermission('PLATFORM_MANAGE_TENANTS')
  @ApiDoc({ summary: 'Lister les établissements', tags: ['platform'] })
  list() {
    return this.platform.listTenants();
  }

  @Post()
  @RequirePermission('PLATFORM_MANAGE_TENANTS')
  @ApiDoc({
    summary: 'Créer un établissement (rôles système copiés, invitation admin optionnelle)',
    tags: ['platform'],
    body: CreateTenantSchema,
    status: 201,
  })
  create(@ZodBody(CreateTenantSchema) body: CreateTenantInput) {
    return this.platform.createTenant(body);
  }

  @Patch(':id/status')
  @RequirePermission('PLATFORM_MANAGE_TENANTS')
  @ApiDoc({
    summary: 'Activer / suspendre un établissement',
    tags: ['platform'],
    params: IdParams,
    body: UpdateTenantStatusSchema,
  })
  status(
    @ZodParams(IdParams) params: z.infer<typeof IdParams>,
    @ZodBody(UpdateTenantStatusSchema) body: z.infer<typeof UpdateTenantStatusSchema>,
  ) {
    return this.platform.updateStatus(params.id, body.status, body.reason);
  }

  @Post(':id/admin-invitations')
  @RequirePermission('PLATFORM_MANAGE_TENANTS')
  @ApiDoc({
    summary: "Inviter un administrateur d'établissement",
    tags: ['platform'],
    params: IdParams,
    body: InviteAdminSchema,
    status: 201,
  })
  inviteAdmin(
    @ZodParams(IdParams) params: z.infer<typeof IdParams>,
    @ZodBody(InviteAdminSchema) body: z.infer<typeof InviteAdminSchema>,
  ) {
    return this.platform.inviteAdmin(params.id, body.email);
  }
}
