import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  AdminDashboardSchema,
  ChildSummarySchema,
  CreateGuardianSchema,
  GuardianLinkSchema,
  GuardianSchema,
  GuardiansQuerySchema,
  ImportBodySchema,
  ImportJobSchema,
  ImportQuerySchema,
  RegistrarDashboardSchema,
  UnlinkGuardianSchema,
  UpdateGuardianSchema,
  UpdateLinkSchema,
} from '@polaris/contracts';
import {
  ApiDoc,
  NoTransaction,
  RateLimit,
  RequirePermission,
  ZodBody,
  ZodParams,
  ZodQuery,
} from '../../../common/decorators';
import { DashboardService } from '../application/dashboard.service';
import { GuardianService } from '../application/guardian.service';
import { ImportService } from '../application/import.service';

const Id = z.object({ id: z.string().uuid() });
type IdP = z.infer<typeof Id>;
const T = ['guardians'];

@Controller('guardians')
export class GuardiansController {
  constructor(private readonly guardians: GuardianService) {}

  @Get()
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: 'Tuteurs (recherche nom/téléphone, activés ou non)',
    tags: T,
    query: GuardiansQuerySchema,
    response: z.array(GuardianSchema),
  })
  list(@ZodQuery(GuardiansQuerySchema) q: z.infer<typeof GuardiansQuerySchema>) {
    return this.guardians.list(q);
  }

  @Get(':id')
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: 'Fiche tuteur avec ses enfants',
    tags: T,
    params: Id,
    response: GuardianSchema,
  })
  get(@ZodParams(Id) p: IdP) {
    return this.guardians.get(p.id);
  }

  @Post()
  @RequirePermission('MANAGE_GUARDIANS')
  @ApiDoc({
    summary: 'Créer un tuteur (409 si le téléphone existe déjà)',
    tags: T,
    body: CreateGuardianSchema,
    response: GuardianSchema,
    status: 201,
  })
  create(@ZodBody(CreateGuardianSchema) b: z.infer<typeof CreateGuardianSchema>) {
    return this.guardians.create(b);
  }

  @Patch(':id')
  @RequirePermission('MANAGE_GUARDIANS')
  @ApiDoc({
    summary: 'Modifier un tuteur',
    tags: T,
    params: Id,
    body: UpdateGuardianSchema,
    response: GuardianSchema,
  })
  update(
    @ZodParams(Id) p: IdP,
    @ZodBody(UpdateGuardianSchema) b: z.infer<typeof UpdateGuardianSchema>,
  ) {
    return this.guardians.update(p.id, b);
  }

  @Post(':id/invite')
  @HttpCode(200)
  @NoTransaction()
  @RateLimit({ points: 30, duration: 3600, keyBy: 'tenant', name: 'guardian-invite' })
  @RequirePermission('MANAGE_GUARDIANS')
  @ApiDoc({
    summary: "Inviter le tuteur : crée son accès parent et envoie le SMS d'accueil",
    tags: T,
    params: Id,
  })
  invite(@ZodParams(Id) p: IdP) {
    return this.guardians.invite(p.id);
  }
}

@Controller('student-guardians')
export class StudentGuardiansController {
  constructor(private readonly guardians: GuardianService) {}

  @Patch(':id')
  @RequirePermission('LINK_GUARDIAN')
  @ApiDoc({
    summary: 'Modifier un lien parent-enfant (relation, principal, droits)',
    tags: T,
    params: Id,
    body: UpdateLinkSchema,
    response: GuardianLinkSchema,
  })
  update(@ZodParams(Id) p: IdP, @ZodBody(UpdateLinkSchema) b: z.infer<typeof UpdateLinkSchema>) {
    return this.guardians.updateLink(p.id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('LINK_GUARDIAN')
  @ApiDoc({
    summary: 'Détacher un tuteur (motif obligatoire, historisé)',
    tags: T,
    params: Id,
    body: UnlinkGuardianSchema,
    status: 204,
  })
  unlink(
    @ZodParams(Id) p: IdP,
    @ZodBody(UnlinkGuardianSchema) b: z.infer<typeof UnlinkGuardianSchema>,
  ) {
    return this.guardians.unlink(p.id, b);
  }
}

@Controller('me/children')
export class MyChildrenController {
  constructor(private readonly guardians: GuardianService) {}

  @Get()
  @ApiDoc({
    summary: 'Mes enfants (vue parent) avec les droits de chaque lien',
    tags: T,
    response: z.array(ChildSummarySchema),
  })
  mine() {
    return this.guardians.myChildren();
  }
}

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportService) {}

  @Post('students')
  @HttpCode(200)
  @RequirePermission('IMPORT_STUDENTS')
  @ApiDoc({
    summary: 'Importer des élèves (CSV ; dryRun=true par défaut : rapport sans écriture)',
    tags: ['imports'],
    query: ImportQuerySchema,
    body: ImportBodySchema,
    response: ImportJobSchema,
  })
  students(
    @ZodQuery(ImportQuerySchema) q: z.infer<typeof ImportQuerySchema>,
    @ZodBody(ImportBodySchema) b: z.infer<typeof ImportBodySchema>,
  ) {
    return this.imports.importStudents(b.csv, q);
  }

  @Post('guardians')
  @HttpCode(200)
  @RequirePermission('IMPORT_STUDENTS')
  @ApiDoc({
    summary: 'Importer des tuteurs et leurs rattachements (CSV ; dryRun=true par défaut)',
    tags: ['imports'],
    query: ImportQuerySchema,
    body: ImportBodySchema,
    response: ImportJobSchema,
  })
  guardians(
    @ZodQuery(ImportQuerySchema) q: z.infer<typeof ImportQuerySchema>,
    @ZodBody(ImportBodySchema) b: z.infer<typeof ImportBodySchema>,
  ) {
    return this.imports.importGuardians(b.csv, q);
  }

  @Get(':id')
  @RequirePermission('IMPORT_STUDENTS')
  @ApiDoc({
    summary: "Rapport d'un import",
    tags: ['imports'],
    params: Id,
    response: ImportJobSchema,
  })
  get(@ZodParams(Id) p: IdP) {
    return this.imports.get(p.id);
  }
}

@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardService) {}

  @Get('registrar')
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: 'Tableau de bord scolarité (effectifs, fiches incomplètes, imports récents)',
    tags: ['dashboards'],
    response: RegistrarDashboardSchema,
  })
  registrar() {
    return this.dashboards.registrar();
  }

  @Get('admin')
  @RequirePermission('MANAGE_TENANT_SETTINGS')
  @ApiDoc({
    summary: 'Tableau de bord administrateur (volumes, alertes de configuration)',
    tags: ['dashboards'],
    response: AdminDashboardSchema,
  })
  admin() {
    return this.dashboards.admin();
  }
}
