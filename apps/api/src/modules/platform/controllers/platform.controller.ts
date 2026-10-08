import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  CreateTenantSchema,
  ImpersonateSchema,
  ImpersonationGrantSchema,
  ImpersonationSessionSchema,
  UpdateTenantStatusSchema,
  type CreateTenantInput,
} from '@polaris/contracts';
import { ApiDoc, RequirePermission, Scope, ZodBody, ZodParams } from '../../../common/decorators';
import { ImpersonationService } from '../application/impersonation.service';
import { PlatformService } from '../application/platform.service';

const IdParams = z.object({ id: z.string().uuid() });
const InviteAdminSchema = z.object({ email: z.string().email() });

@Controller('platform/tenants')
@Scope('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly impersonation: ImpersonationService,
  ) {}

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

  @Post(':id/impersonate')
  @RequirePermission('PLATFORM_IMPERSONATE')
  @ApiDoc({
    summary:
      'Ouvrir une session de support dans un établissement (30 min, tracée, sans action financière)',
    tags: ['platform'],
    params: IdParams,
    body: ImpersonateSchema,
    response: ImpersonationGrantSchema,
    status: 201,
  })
  impersonate(
    @ZodParams(IdParams) params: z.infer<typeof IdParams>,
    @ZodBody(ImpersonateSchema) body: z.infer<typeof ImpersonateSchema>,
  ) {
    return this.impersonation.start(params.id, body.reason);
  }
}

@Controller('platform/impersonations')
@Scope('platform')
export class ImpersonationsController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @Get()
  @RequirePermission('PLATFORM_IMPERSONATE', 'PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary: 'Sessions de support (100 dernières)',
    tags: ['platform'],
    response: z.array(ImpersonationSessionSchema),
  })
  list() {
    return this.impersonation.list();
  }

  @Post(':id/end')
  @HttpCode(200)
  @RequirePermission('PLATFORM_IMPERSONATE')
  @ApiDoc({
    summary: 'Clôturer une session de support (effectif en moins de 30 s)',
    tags: ['platform'],
    params: IdParams,
    response: ImpersonationSessionSchema,
  })
  end(@ZodParams(IdParams) params: z.infer<typeof IdParams>) {
    return this.impersonation.end(params.id);
  }
}
