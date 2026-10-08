import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { IdentityModule } from '../identity';
import { PlatformModule } from '../platform';
import { TenancyModule } from '../tenancy';
import { AdoptionService } from './application/adoption.service';
import { AvailabilityService } from './application/availability.service';
import { HypercareService } from './application/hypercare.service';
import { LaunchService } from './application/launch.service';
import { SupportService } from './application/support.service';
import { UsageService } from './application/usage.service';
import {
  AdoptionController,
  AvailabilityController,
  HypercareController,
  LaunchController,
  PublicStatusController,
  SupportController,
  UsageController,
} from './controllers/launch.controller';

/**
 * Lancement production et hypercare (Phase 8) : mise en production d'un établissement, adoption du parc,
 * revue quotidienne, disponibilité mesurée, consommation mensuelle, outils du support niveau 1.
 * Module transverse (couche 4) : il lit tout, n'écrit que ses propres tables et les colonnes de lancement.
 */
@Module({
  imports: [AuditModule, IdentityModule, PlatformModule, TenancyModule],
  controllers: [
    LaunchController,
    AdoptionController,
    HypercareController,
    AvailabilityController,
    PublicStatusController,
    UsageController,
    SupportController,
  ],
  providers: [
    LaunchService,
    AdoptionService,
    HypercareService,
    AvailabilityService,
    UsageService,
    SupportService,
  ],
  exports: [HypercareService, AvailabilityService, UsageService],
})
export class LaunchModule {}
