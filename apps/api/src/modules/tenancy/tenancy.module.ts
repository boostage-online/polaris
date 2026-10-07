import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { TenantService } from './application/tenant.service';
import { TenantController } from './controllers/tenant.controller';

@Module({
  imports: [AuditModule],
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenancyModule {}
