import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { IdentityModule } from '../identity';
import { TenancyModule } from '../tenancy';
import { PlatformService } from './application/platform.service';
import { PlatformController } from './controllers/platform.controller';

@Module({
  imports: [AuditModule, IdentityModule, TenancyModule],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
