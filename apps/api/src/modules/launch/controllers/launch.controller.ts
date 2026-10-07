import { Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  AdoptionOverviewSchema,
  AvailabilityQuerySchema,
  AvailabilitySchema,
  DailyReviewAckSchema,
  DailyReviewQuerySchema,
  DailyReviewSchema,
  DayParamsSchema,
  GoLiveSchema,
  LaunchChecklistSchema,
  LaunchReadinessSchema,
  MfaResetResultSchema,
  ProbeResultSchema,
  PublicStatusSchema,
  SupportLookupQuerySchema,
  SupportLookupSchema,
  SupportMfaResetSchema,
  SupportUnlockSchema,
  UsageMonthSchema,
  UsageQuerySchema,
} from '@polaris/contracts';
import {
  ApiDoc,
  NoTransaction,
  Public,
  RateLimit,
  RequirePermission,
  Scope,
  ZodBody,
  ZodParams,
  ZodQuery,
} from '../../../common/decorators';
import { raw } from '../../../common/interceptors/envelope.interceptor';
import { AdoptionService } from '../application/adoption.service';
import { AvailabilityService } from '../application/availability.service';
import { HypercareService } from '../application/hypercare.service';
import { LaunchService } from '../application/launch.service';
import { SupportService } from '../application/support.service';
import { UsageService, monthStart } from '../application/usage.service';

const Id = z.object({ id: z.string().uuid() });

/** Mise en production d'un établissement (Super Admin). */
@Controller('platform/tenants/:id/launch')
@Scope('platform')
export class LaunchController {
  constructor(private readonly launch: LaunchService) {}

  @Get()
  @RequirePermission('PLATFORM_MANAGE_TENANTS')
  @ApiDoc({
    summary:
      'Préparation à la mise en production : assistant, MFA, provider, SMS, alertes, checklist',
    tags: ['platform'],
    params: Id,
    response: LaunchReadinessSchema,
  })
  readiness(@ZodParams(Id) p: z.infer<typeof Id>) {
    return this.launch.readiness(p.id);
  }

  @Patch('checklist')
  @RequirePermission('PLATFORM_MANAGE_TENANTS')
  @ApiDoc({
    summary: 'Cocher les points humains (contrat, budget SMS, astreinte, données validées)',
    tags: ['platform'],
    params: Id,
    body: LaunchChecklistSchema,
    response: LaunchReadinessSchema,
  })
  checklist(
    @ZodParams(Id) p: z.infer<typeof Id>,
    @ZodBody(LaunchChecklistSchema) body: z.infer<typeof LaunchChecklistSchema>,
  ) {
    return this.launch.updateChecklist(p.id, body);
  }

  @Post('go-live')
  @HttpCode(200)
  @RequirePermission('PLATFORM_MANAGE_TENANTS')
  @ApiDoc({
    summary:
      'Basculer en production (409 tant qu’un point bloquant manque) : statut ACTIVE, offre, hypercare',
    tags: ['platform'],
    params: Id,
    body: GoLiveSchema,
    response: LaunchReadinessSchema,
  })
  goLive(
    @ZodParams(Id) p: z.infer<typeof Id>,
    @ZodBody(GoLiveSchema) body: z.infer<typeof GoLiveSchema>,
  ) {
    return this.launch.goLive(p.id, body);
  }
}

@Controller('platform/adoption')
@Scope('platform')
export class AdoptionController {
  constructor(private readonly adoption: AdoptionService) {}

  @Get()
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary:
      'Adoption du parc : activation des parents, appels soumis, paiement en ligne, SMS, par établissement',
    tags: ['platform'],
    response: AdoptionOverviewSchema,
  })
  overview() {
    return this.adoption.overview();
  }
}

@Controller('platform/reviews')
@Scope('platform')
export class HypercareController {
  constructor(private readonly hypercare: HypercareService) {}

  @Get()
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary: 'Revues quotidiennes (hypercare), la plus récente en premier',
    tags: ['platform'],
    query: DailyReviewQuerySchema,
    response: z.array(DailyReviewSchema),
  })
  list(@ZodQuery(DailyReviewQuerySchema) q: z.infer<typeof DailyReviewQuerySchema>) {
    return this.hypercare.list(q.limit);
  }

  @Post('generate')
  @HttpCode(200)
  @NoTransaction()
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary: 'Générer (ou régénérer) la revue du jour maintenant',
    tags: ['platform'],
    response: DailyReviewSchema,
  })
  generate() {
    return this.hypercare.generate();
  }

  @Get(':day')
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary: 'Une revue',
    tags: ['platform'],
    params: DayParamsSchema,
    response: DailyReviewSchema,
  })
  get(@ZodParams(DayParamsSchema) p: z.infer<typeof DayParamsSchema>) {
    return this.hypercare.get(p.day);
  }

  @Post(':day/ack')
  @HttpCode(200)
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary: 'Acquitter la revue (lue, actions décidées)',
    tags: ['platform'],
    params: DayParamsSchema,
    body: DailyReviewAckSchema,
    response: DailyReviewSchema,
  })
  ack(
    @ZodParams(DayParamsSchema) p: z.infer<typeof DayParamsSchema>,
    @ZodBody(DailyReviewAckSchema) body: z.infer<typeof DailyReviewAckSchema>,
  ) {
    return this.hypercare.acknowledge(p.day, body.notes);
  }
}

@Controller('platform/availability')
@Scope('platform')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary: 'Disponibilité mesurée (sondes internes) sur N jours, objectif G8 ≥ 99,5 %',
    tags: ['platform'],
    query: AvailabilityQuerySchema,
    response: AvailabilitySchema,
  })
  stats(@ZodQuery(AvailabilityQuerySchema) q: z.infer<typeof AvailabilityQuerySchema>) {
    return this.availability.stats(q.days);
  }

  @Post('probe')
  @HttpCode(200)
  @NoTransaction()
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary: 'Lancer une sonde maintenant (le worker en lance une par minute)',
    tags: ['platform'],
    response: ProbeResultSchema,
  })
  probe() {
    return this.availability.probe();
  }
}

/** État public du service : aucune authentification, aucune donnée d'établissement. */
@Controller('status')
export class PublicStatusController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @Public()
  @NoTransaction()
  @RateLimit({ points: 30, duration: 60, keyBy: 'ip', name: 'status' })
  @ApiDoc({
    summary: 'État public du service (disponibilité 30 jours)',
    tags: ['health'],
    response: PublicStatusSchema,
  })
  status() {
    return this.availability.publicStatus();
  }
}

@Controller('platform/usage')
@Scope('platform')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('export.csv')
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary: 'Consommation mensuelle en CSV (facturation manuelle)',
    tags: ['platform'],
    query: UsageQuerySchema,
  })
  async csv(
    @ZodQuery(UsageQuerySchema) q: z.infer<typeof UsageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rows = await this.usage.list(q.month);
    const month = q.month ?? monthStart().slice(0, 7);
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="consommation_${month}.csv"`);
    return raw(this.usage.toCsv(rows));
  }

  @Get()
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary: 'Consommation mensuelle par établissement (mois courant par défaut)',
    tags: ['platform'],
    query: UsageQuerySchema,
    response: z.array(UsageMonthSchema),
  })
  list(@ZodQuery(UsageQuerySchema) q: z.infer<typeof UsageQuerySchema>) {
    return this.usage.list(q.month);
  }

  @Post('snapshot')
  @HttpCode(200)
  @NoTransaction()
  @RequirePermission('PLATFORM_VIEW_METRICS')
  @ApiDoc({
    summary: 'Recalculer l’instantané du mois courant pour tous les établissements',
    tags: ['platform'],
  })
  snapshot() {
    return this.usage.snapshotAll();
  }
}

@Controller('platform/support')
@Scope('platform')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('lookup')
  @RequirePermission('PLATFORM_MANAGE_TENANTS', 'PLATFORM_IMPERSONATE')
  @ApiDoc({
    summary:
      'Retrouver une personne (e-mail, téléphone, nom) et son état de connexion dans tous les établissements',
    tags: ['platform'],
    query: SupportLookupQuerySchema,
    response: SupportLookupSchema,
  })
  lookup(@ZodQuery(SupportLookupQuerySchema) q: z.infer<typeof SupportLookupQuerySchema>) {
    return this.support.lookup(q.q);
  }

  @Post('unlock')
  @HttpCode(200)
  @RequirePermission('PLATFORM_MANAGE_TENANTS', 'PLATFORM_IMPERSONATE')
  @ApiDoc({
    summary: 'Lever le verrouillage anti-force-brute d’un identifiant',
    tags: ['platform'],
    body: SupportUnlockSchema,
  })
  unlock(@ZodBody(SupportUnlockSchema) body: z.infer<typeof SupportUnlockSchema>) {
    return this.support.unlock(body.identifier);
  }

  @Post('users/:id/mfa-reset')
  @HttpCode(200)
  @NoTransaction()
  @RequirePermission('PLATFORM_IMPERSONATE')
  @ApiDoc({
    summary:
      'Réinitialiser la MFA d’un utilisateur (identité vérifiée) : sessions révoquées, motif journalisé',
    tags: ['platform'],
    params: Id,
    body: SupportMfaResetSchema,
    response: MfaResetResultSchema,
  })
  resetMfa(
    @ZodParams(Id) p: z.infer<typeof Id>,
    @ZodBody(SupportMfaResetSchema) body: z.infer<typeof SupportMfaResetSchema>,
  ) {
    return this.support.resetMfa(p.id, body.reason);
  }
}
