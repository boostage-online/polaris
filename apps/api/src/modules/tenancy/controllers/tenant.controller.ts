import { Controller, Get, Patch } from '@nestjs/common';
import { ApiDoc, RequirePermission, ZodBody } from '../../../common/decorators';
import {
  TenantService,
  TenantSettingsSchema,
  type TenantSettings,
} from '../application/tenant.service';

@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  @ApiDoc({ summary: 'Établissement courant', tags: ['tenant'] })
  current() {
    return this.tenantService.current();
  }

  @Patch('settings')
  @RequirePermission('MANAGE_TENANT_SETTINGS')
  @ApiDoc({
    summary: "Modifier les paramètres de l'établissement",
    tags: ['tenant'],
    body: TenantSettingsSchema,
  })
  updateSettings(@ZodBody(TenantSettingsSchema) body: TenantSettings) {
    return this.tenantService.updateSettings(body);
  }
}
