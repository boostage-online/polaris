import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  AnonymizationResultSchema,
  AnonymizeSchema,
  PersonalDataExportSchema,
  PrivacyRequestSchema,
} from '@polaris/contracts';
import { ApiDoc, RequirePermission, ZodBody, ZodParams } from '../../../common/decorators';
import { DatabaseService } from '../../../database/database.service';
import { GuardianService } from '../application/guardian.service';
import { PrivacyService } from '../application/privacy.service';

const Id = z.object({ id: z.string().uuid() });
type IdP = z.infer<typeof Id>;
const T = ['privacy'];

/** Données personnelles (Partie 11) : export et anonymisation outillés, journalisés. */
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('requests')
  @RequirePermission('MANAGE_PRIVACY')
  @ApiDoc({
    summary: 'Registre des demandes (exports, anonymisations, rétention automatique)',
    tags: T,
    response: z.array(PrivacyRequestSchema),
  })
  requests() {
    return this.privacy.requests();
  }

  @Get('students/:id')
  @RequirePermission('MANAGE_PRIVACY')
  @ApiDoc({
    summary: "Export des données personnelles d'un élève (toutes sections)",
    tags: T,
    params: Id,
    response: PersonalDataExportSchema,
  })
  exportStudent(@ZodParams(Id) p: IdP) {
    return this.privacy.exportStudent(p.id);
  }

  @Post('students/:id/anonymize')
  @HttpCode(200)
  @RequirePermission('MANAGE_PRIVACY')
  @ApiDoc({
    summary:
      'Anonymiser un élève parti (identité, notes, justificatifs, notifications ; pièces financières conservées)',
    tags: T,
    params: Id,
    body: AnonymizeSchema,
    response: AnonymizationResultSchema,
  })
  anonymizeStudent(
    @ZodParams(Id) p: IdP,
    @ZodBody(AnonymizeSchema) b: z.infer<typeof AnonymizeSchema>,
  ) {
    return this.privacy.anonymizeStudent(p.id, b);
  }

  @Get('guardians/:id')
  @RequirePermission('MANAGE_PRIVACY')
  @ApiDoc({
    summary: "Export des données personnelles d'un tuteur",
    tags: T,
    params: Id,
    response: PersonalDataExportSchema,
  })
  exportGuardian(@ZodParams(Id) p: IdP) {
    return this.privacy.exportGuardian(p.id);
  }

  @Post('guardians/:id/anonymize')
  @HttpCode(200)
  @RequirePermission('MANAGE_PRIVACY')
  @ApiDoc({
    summary: 'Anonymiser un tuteur sans enfant rattaché (compte désactivé)',
    tags: T,
    params: Id,
    body: AnonymizeSchema,
    response: AnonymizationResultSchema,
  })
  anonymizeGuardian(
    @ZodParams(Id) p: IdP,
    @ZodBody(AnonymizeSchema) b: z.infer<typeof AnonymizeSchema>,
  ) {
    return this.privacy.anonymizeGuardian(p.id, b);
  }
}

/** Parent : « mes données » (ses enfants, ses paiements, ses notifications), sans passer par le support. */
@Controller('me/personal-data')
export class MyPersonalDataController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly guardians: GuardianService,
    private readonly db: DatabaseService,
  ) {}

  @Get()
  @ApiDoc({
    summary: 'Export de mes données personnelles (parent)',
    tags: T,
    response: PersonalDataExportSchema,
  })
  async mine() {
    const g = await this.guardians.guardianOfActor(this.db.current());
    return this.privacy.exportGuardian(g.id, 'SELF_SERVICE');
  }
}
