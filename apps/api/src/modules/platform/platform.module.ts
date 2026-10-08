import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { IdentityModule } from '../identity';
import { TenancyModule } from '../tenancy';
import { ImpersonationService } from './application/impersonation.service';
import { PlatformService } from './application/platform.service';
import { ImpersonationsController, PlatformController } from './controllers/platform.controller';

@Module({
  imports: [AuditModule, IdentityModule, TenancyModule],
  controllers: [PlatformController, ImpersonationsController],
  providers: [PlatformService, ImpersonationService],
  exports: [PlatformService],
})
export class PlatformModule {}
