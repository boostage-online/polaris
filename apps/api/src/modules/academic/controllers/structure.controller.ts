import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  AcademicYearSchema,
  CreateAcademicYearSchema,
  CreateGroupSchema,
  CreateLevelSchema,
  CreateProgramSchema,
  CreateSubjectSchema,
  CreateTermSchema,
  GroupSchema,
  GroupsQuerySchema,
  ProgramSchema,
  SubjectSchema,
  TermSchema,
  UpdateAcademicYearSchema,
  UpdateGroupSchema,
  UpdateLevelSchema,
  UpdateProgramSchema,
  UpdateSubjectSchema,
} from '@polaris/contracts';
import {
  ApiDoc,
  RequirePermission,
  ZodBody,
  ZodParams,
  ZodQuery,
} from '../../../common/decorators';
import { StructureService } from '../application/structure.service';

const Id = z.object({ id: z.string().uuid() });
type IdP = z.infer<typeof Id>;

@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly s: StructureService) {}

  @Get()
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: 'Années académiques',
    tags: ['academic'],
    response: z.array(AcademicYearSchema),
  })
  list() {
    return this.s.listYears();
  }

  @Post()
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Créer une année',
    tags: ['academic'],
    body: CreateAcademicYearSchema,
    response: AcademicYearSchema,
    status: 201,
  })
  create(@ZodBody(CreateAcademicYearSchema) b: z.infer<typeof CreateAcademicYearSchema>) {
    return this.s.createYear(b);
  }

  @Patch(':id')
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Modifier une année',
    tags: ['academic'],
    params: Id,
    body: UpdateAcademicYearSchema,
    response: AcademicYearSchema,
  })
  update(
    @ZodParams(Id) p: IdP,
    @ZodBody(UpdateAcademicYearSchema) b: z.infer<typeof UpdateAcademicYearSchema>,
  ) {
    return this.s.updateYear(p.id, b);
  }

  @Post(':id/set-current')
  @HttpCode(200)
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: "Définir l'année courante",
    tags: ['academic'],
    params: Id,
    response: AcademicYearSchema,
  })
  setCurrent(@ZodParams(Id) p: IdP) {
    return this.s.setCurrentYear(p.id);
  }

  @Get(':id/terms')
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: "Périodes d'une année",
    tags: ['academic'],
    params: Id,
    response: z.array(TermSchema),
  })
  terms(@ZodParams(Id) p: IdP) {
    return this.s.listTerms(p.id);
  }

  @Post(':id/terms')
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Créer une période',
    tags: ['academic'],
    params: Id,
    body: CreateTermSchema,
    response: TermSchema,
    status: 201,
  })
  createTerm(
    @ZodParams(Id) p: IdP,
    @ZodBody(CreateTermSchema) b: z.infer<typeof CreateTermSchema>,
  ) {
    return this.s.createTerm(p.id, b);
  }
}

@Controller('programs')
export class ProgramsController {
  constructor(private readonly s: StructureService) {}

  @Get()
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: 'Programmes et niveaux',
    tags: ['academic'],
    response: z.array(ProgramSchema),
  })
  list() {
    return this.s.listPrograms();
  }

  @Post()
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Créer un programme',
    tags: ['academic'],
    body: CreateProgramSchema,
    response: ProgramSchema,
    status: 201,
  })
  create(@ZodBody(CreateProgramSchema) b: z.infer<typeof CreateProgramSchema>) {
    return this.s.createProgram(b);
  }

  @Patch(':id')
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Modifier un programme',
    tags: ['academic'],
    params: Id,
    body: UpdateProgramSchema,
  })
  update(
    @ZodParams(Id) p: IdP,
    @ZodBody(UpdateProgramSchema) b: z.infer<typeof UpdateProgramSchema>,
  ) {
    return this.s.updateProgram(p.id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Supprimer un programme (sans groupe)',
    tags: ['academic'],
    params: Id,
    status: 204,
  })
  remove(@ZodParams(Id) p: IdP) {
    return this.s.deleteProgram(p.id);
  }

  @Post(':id/levels')
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Ajouter un niveau',
    tags: ['academic'],
    params: Id,
    body: CreateLevelSchema,
    status: 201,
  })
  createLevel(
    @ZodParams(Id) p: IdP,
    @ZodBody(CreateLevelSchema) b: z.infer<typeof CreateLevelSchema>,
  ) {
    return this.s.createLevel(p.id, b);
  }
}

@Controller('levels')
export class LevelsController {
  constructor(private readonly s: StructureService) {}

  @Patch(':id')
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Modifier un niveau',
    tags: ['academic'],
    params: Id,
    body: UpdateLevelSchema,
  })
  update(@ZodParams(Id) p: IdP, @ZodBody(UpdateLevelSchema) b: z.infer<typeof UpdateLevelSchema>) {
    return this.s.updateLevel(p.id, b);
  }
}

@Controller('groups')
export class GroupsController {
  constructor(private readonly s: StructureService) {}

  @Get()
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: "Groupes (classes, sous-groupes) d'une année",
    tags: ['academic'],
    query: GroupsQuerySchema,
    response: z.array(GroupSchema),
  })
  list(@ZodQuery(GroupsQuerySchema) q: z.infer<typeof GroupsQuerySchema>) {
    return this.s.listGroups(q);
  }

  @Get(':id')
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({ summary: 'Détail d’un groupe', tags: ['academic'], params: Id, response: GroupSchema })
  get(@ZodParams(Id) p: IdP) {
    return this.s.getGroup(p.id);
  }

  @Post()
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Créer un groupe',
    tags: ['academic'],
    body: CreateGroupSchema,
    response: GroupSchema,
    status: 201,
  })
  create(@ZodBody(CreateGroupSchema) b: z.infer<typeof CreateGroupSchema>) {
    return this.s.createGroup(b);
  }

  @Patch(':id')
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Modifier un groupe',
    tags: ['academic'],
    params: Id,
    body: UpdateGroupSchema,
    response: GroupSchema,
  })
  update(@ZodParams(Id) p: IdP, @ZodBody(UpdateGroupSchema) b: z.infer<typeof UpdateGroupSchema>) {
    return this.s.updateGroup(p.id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Supprimer un groupe (sans inscrit)',
    tags: ['academic'],
    params: Id,
    status: 204,
  })
  remove(@ZodParams(Id) p: IdP) {
    return this.s.deleteGroup(p.id);
  }
}

@Controller('subjects')
export class SubjectsController {
  constructor(private readonly s: StructureService) {}

  @Get()
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({ summary: 'Matières / UE', tags: ['academic'], response: z.array(SubjectSchema) })
  list() {
    return this.s.listSubjects();
  }

  @Post()
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Créer une matière',
    tags: ['academic'],
    body: CreateSubjectSchema,
    response: SubjectSchema,
    status: 201,
  })
  create(@ZodBody(CreateSubjectSchema) b: z.infer<typeof CreateSubjectSchema>) {
    return this.s.createSubject(b);
  }

  @Patch(':id')
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Modifier une matière',
    tags: ['academic'],
    params: Id,
    body: UpdateSubjectSchema,
    response: SubjectSchema,
  })
  update(
    @ZodParams(Id) p: IdP,
    @ZodBody(UpdateSubjectSchema) b: z.infer<typeof UpdateSubjectSchema>,
  ) {
    return this.s.updateSubject(p.id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('MANAGE_ACADEMIC_STRUCTURE')
  @ApiDoc({
    summary: 'Désactiver une matière (sans cours)',
    tags: ['academic'],
    params: Id,
    status: 204,
  })
  remove(@ZodParams(Id) p: IdP) {
    return this.s.deleteSubject(p.id);
  }
}
