import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { OnboardingService } from './application/onboarding.service';
import { TenantService } from './application/tenant.service';
import { OnboardingController } from './controllers/onboarding.controller';
import { TenantController } from './controllers/tenant.controller';

@Module({
  imports: [AuditModule],
  controllers: [TenantController, OnboardingController],
  providers: [TenantService, OnboardingService],
  exports: [TenantService],
})
export class TenancyModule {}
