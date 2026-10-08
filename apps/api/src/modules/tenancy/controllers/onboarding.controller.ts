import { Controller, Get, Patch } from '@nestjs/common';
import type { z } from 'zod';
import { OnboardingDismissSchema, OnboardingStatusSchema } from '@polaris/contracts';
import { ApiDoc, RequirePermission, ZodBody } from '../../../common/decorators';
import { OnboardingService } from '../application/onboarding.service';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @RequirePermission(
    'MANAGE_TENANT_SETTINGS',
    'MANAGE_ACADEMIC_STRUCTURE',
    'MANAGE_USERS',
    'IMPORT_STUDENTS',
    'MANAGE_SCHEDULES',
  )
  @ApiDoc({
    summary: 'Assistant de démarrage : étapes réalisées et restantes, calculées depuis les données',
    tags: ['tenant'],
    response: OnboardingStatusSchema,
  })
  status() {
    return this.onboarding.status();
  }

  @Patch()
  @RequirePermission('MANAGE_TENANT_SETTINGS')
  @ApiDoc({
    summary: 'Masquer ou réafficher l’assistant de démarrage',
    tags: ['tenant'],
    body: OnboardingDismissSchema,
    response: OnboardingStatusSchema,
  })
  dismiss(@ZodBody(OnboardingDismissSchema) b: z.infer<typeof OnboardingDismissSchema>) {
    return this.onboarding.dismiss(b.dismissed);
  }
}
