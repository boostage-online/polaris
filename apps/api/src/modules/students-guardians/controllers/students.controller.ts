import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  CloseEnrollmentSchema,
  CreateStudentSchema,
  EnrollStudentSchema,
  EnrollmentSchema,
  GuardianLinkSchema,
  LeaveStudentSchema,
  LinkGuardianSchema,
  StudentSchema,
  StudentsQuerySchema,
  TransferStudentSchema,
  UpdateStudentSchema,
} from '@polaris/contracts';
import {
  ApiDoc,
  RequirePermission,
  ZodBody,
  ZodParams,
  ZodQuery,
} from '../../../common/decorators';
import { DatabaseService } from '../../../database/database.service';
import { GuardianService } from '../application/guardian.service';
import { StudentService } from '../application/student.service';

const Id = z.object({ id: z.string().uuid() });
type IdP = z.infer<typeof Id>;
const T = ['students'];

@Controller('students')
export class StudentsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly students: StudentService,
    private readonly guardians: GuardianService,
  ) {}

  @Get()
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: 'Élèves (recherche, classe, statut, fiches incomplètes)',
    tags: T,
    query: StudentsQuerySchema,
    response: z.array(StudentSchema),
  })
  list(@ZodQuery(StudentsQuerySchema) q: z.infer<typeof StudentsQuerySchema>) {
    return this.students.list(q);
  }

  @Get(':id')
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: "Fiche élève avec historique d'inscriptions",
    tags: T,
    params: Id,
    response: StudentSchema,
  })
  get(@ZodParams(Id) p: IdP) {
    return this.students.get(p.id);
  }

  @Post()
  @RequirePermission('CREATE_STUDENT')
  @ApiDoc({
    summary: 'Créer un élève (matricule généré si absent, inscription immédiate possible)',
    tags: T,
    body: CreateStudentSchema,
    response: StudentSchema,
    status: 201,
  })
  create(@ZodBody(CreateStudentSchema) b: z.infer<typeof CreateStudentSchema>) {
    return this.students.create(b);
  }

  @Patch(':id')
  @RequirePermission('EDIT_STUDENT')
  @ApiDoc({
    summary: 'Modifier un élève',
    tags: T,
    params: Id,
    body: UpdateStudentSchema,
    response: StudentSchema,
  })
  update(
    @ZodParams(Id) p: IdP,
    @ZodBody(UpdateStudentSchema) b: z.infer<typeof UpdateStudentSchema>,
  ) {
    return this.students.update(p.id, b);
  }

  @Post(':id/enrollments')
  @RequirePermission('MANAGE_ENROLLMENTS')
  @ApiDoc({
    summary: 'Inscrire dans une classe ou un sous-groupe',
    tags: T,
    params: Id,
    body: EnrollStudentSchema,
    response: EnrollmentSchema,
    status: 201,
  })
  enroll(
    @ZodParams(Id) p: IdP,
    @ZodBody(EnrollStudentSchema) b: z.infer<typeof EnrollStudentSchema>,
  ) {
    return this.students.enroll(p.id, b);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @RequirePermission('MANAGE_ENROLLMENTS')
  @ApiDoc({
    summary:
      "Transférer vers une autre classe (clôture l'inscription courante et ses sous-groupes)",
    tags: T,
    params: Id,
    body: TransferStudentSchema,
    response: StudentSchema,
  })
  transfer(
    @ZodParams(Id) p: IdP,
    @ZodBody(TransferStudentSchema) b: z.infer<typeof TransferStudentSchema>,
  ) {
    return this.students.transfer(p.id, b);
  }

  @Post(':id/leave')
  @HttpCode(200)
  @RequirePermission('MANAGE_ENROLLMENTS')
  @ApiDoc({
    summary: 'Départ ou diplomation : clôt toutes les inscriptions actives',
    tags: T,
    params: Id,
    body: LeaveStudentSchema,
    response: StudentSchema,
  })
  leave(@ZodParams(Id) p: IdP, @ZodBody(LeaveStudentSchema) b: z.infer<typeof LeaveStudentSchema>) {
    return this.students.leave(p.id, b);
  }

  @Get(':id/guardians')
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: "Tuteurs d'un élève",
    tags: T,
    params: Id,
    response: z.array(GuardianLinkSchema),
  })
  guardiansOf(@ZodParams(Id) p: IdP) {
    return this.guardians.linksOf(this.db.current(), { studentId: p.id });
  }

  @Post(':id/guardians')
  @RequirePermission('LINK_GUARDIAN')
  @ApiDoc({
    summary: 'Rattacher un tuteur (existant ou créé à la volée)',
    tags: T,
    params: Id,
    body: LinkGuardianSchema,
    response: GuardianLinkSchema,
    status: 201,
  })
  link(@ZodParams(Id) p: IdP, @ZodBody(LinkGuardianSchema) b: z.infer<typeof LinkGuardianSchema>) {
    return this.guardians.link(p.id, b);
  }
}

@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly students: StudentService) {}

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('MANAGE_ENROLLMENTS')
  @ApiDoc({
    summary: 'Clore une inscription (sortie de classe ou de sous-groupe)',
    tags: T,
    params: Id,
    body: CloseEnrollmentSchema,
    response: EnrollmentSchema,
  })
  close(
    @ZodParams(Id) p: IdP,
    @ZodBody(CloseEnrollmentSchema) b: z.infer<typeof CloseEnrollmentSchema>,
  ) {
    return this.students.closeEnrollment(p.id, b);
  }
}
