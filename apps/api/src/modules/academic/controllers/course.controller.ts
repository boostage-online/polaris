import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  CourseSchema,
  CoursesQuerySchema,
  CreateCourseSchema,
  CreateScheduleSlotSchema,
  CreateSessionSchema,
  CursorQuerySchema,
  GenerateSessionsSchema,
  ClassSessionSchema,
  SessionsQuerySchema,
  SetCourseTeachersSchema,
  StaffSchema,
  UpdateSessionSchema,
  UpdateStaffSchema,
} from '@polaris/contracts';
import {
  ApiDoc,
  RequirePermission,
  ZodBody,
  ZodParams,
  ZodQuery,
} from '../../../common/decorators';
import { CourseService } from '../application/course.service';
import { SessionService } from '../application/session.service';

const Id = z.object({ id: z.string().uuid() });
type IdP = z.infer<typeof Id>;
const MembershipP = z.object({ membershipId: z.string().uuid() });

@Controller('staff')
export class StaffController {
  constructor(private readonly courses: CourseService) {}

  @Get()
  @RequirePermission('MANAGE_USERS')
  @ApiDoc({
    summary: 'Personnel et profils enseignants',
    tags: ['academic'],
    response: z.array(StaffSchema),
  })
  list() {
    return this.courses.listStaff();
  }

  @Patch(':membershipId')
  @RequirePermission('MANAGE_USERS')
  @ApiDoc({
    summary: 'Profil enseignant (matricule, titre, enseignant oui/non)',
    tags: ['academic'],
    params: MembershipP,
    body: UpdateStaffSchema,
    response: StaffSchema,
  })
  update(
    @ZodParams(MembershipP) p: z.infer<typeof MembershipP>,
    @ZodBody(UpdateStaffSchema) b: z.infer<typeof UpdateStaffSchema>,
  ) {
    return this.courses.updateStaff(p.membershipId, b);
  }
}

@Controller('courses')
export class CoursesController {
  constructor(
    private readonly courses: CourseService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: 'Cours (matière × groupe) avec enseignants et créneaux',
    tags: ['academic'],
    query: CoursesQuerySchema,
    response: z.array(CourseSchema),
  })
  list(@ZodQuery(CoursesQuerySchema) q: z.infer<typeof CoursesQuerySchema>) {
    return this.courses.listCourses(q);
  }

  @Get(':id')
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({ summary: 'Détail d’un cours', tags: ['academic'], params: Id, response: CourseSchema })
  get(@ZodParams(Id) p: IdP) {
    return this.courses.getCourse(p.id);
  }

  @Post()
  @RequirePermission('MANAGE_SCHEDULES')
  @ApiDoc({
    summary: 'Créer un cours',
    tags: ['academic'],
    body: CreateCourseSchema,
    response: CourseSchema,
    status: 201,
  })
  create(@ZodBody(CreateCourseSchema) b: z.infer<typeof CreateCourseSchema>) {
    return this.courses.createCourse(b);
  }

  @Put(':id/teachers')
  @RequirePermission('MANAGE_SCHEDULES')
  @ApiDoc({
    summary: "Remplacer les enseignants d'un cours",
    tags: ['academic'],
    params: Id,
    body: SetCourseTeachersSchema,
    response: CourseSchema,
  })
  teachers(
    @ZodParams(Id) p: IdP,
    @ZodBody(SetCourseTeachersSchema) b: z.infer<typeof SetCourseTeachersSchema>,
  ) {
    return this.courses.setTeachers(p.id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('MANAGE_SCHEDULES')
  @ApiDoc({
    summary: 'Supprimer un cours (annule ses séances futures)',
    tags: ['academic'],
    params: Id,
    status: 204,
  })
  remove(@ZodParams(Id) p: IdP) {
    return this.courses.deleteCourse(p.id);
  }

  @Post(':id/schedule-slots')
  @RequirePermission('MANAGE_SCHEDULES')
  @ApiDoc({
    summary: 'Ajouter un créneau récurrent (chevauchements signalés dans meta.warnings)',
    tags: ['academic'],
    params: Id,
    body: CreateScheduleSlotSchema,
    status: 201,
  })
  addSlot(
    @ZodParams(Id) p: IdP,
    @ZodBody(CreateScheduleSlotSchema) b: z.infer<typeof CreateScheduleSlotSchema>,
  ) {
    return this.courses.addSlot(p.id, b);
  }

  @Post(':id/sessions')
  @RequirePermission('MANAGE_SCHEDULES')
  @ApiDoc({
    summary: 'Créer une séance ponctuelle',
    tags: ['academic'],
    params: Id,
    body: CreateSessionSchema,
    response: ClassSessionSchema,
    status: 201,
  })
  createSession(
    @ZodParams(Id) p: IdP,
    @ZodBody(CreateSessionSchema) b: z.infer<typeof CreateSessionSchema>,
  ) {
    return this.sessions.create(p.id, b);
  }
}

@Controller('schedule-slots')
export class ScheduleSlotsController {
  constructor(private readonly courses: CourseService) {}

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('MANAGE_SCHEDULES')
  @ApiDoc({
    summary: 'Supprimer un créneau (annule ses séances futures)',
    tags: ['academic'],
    params: Id,
    status: 204,
  })
  remove(@ZodParams(Id) p: IdP) {
    return this.courses.deleteSlot(p.id);
  }
}

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: 'Séances (filtres période, groupe, cours, statut)',
    tags: ['academic'],
    query: SessionsQuerySchema,
  })
  list(@ZodQuery(SessionsQuerySchema) q: z.infer<typeof SessionsQuerySchema>) {
    return this.sessions.list(q);
  }

  @Get(':id')
  @RequirePermission('VIEW_STUDENTS')
  @ApiDoc({
    summary: 'Détail d’une séance',
    tags: ['academic'],
    params: Id,
    response: ClassSessionSchema,
  })
  get(@ZodParams(Id) p: IdP) {
    return this.sessions.get(p.id);
  }

  @Patch(':id')
  @RequirePermission('MANAGE_SCHEDULES')
  @ApiDoc({
    summary: 'Déplacer ou annuler une séance',
    tags: ['academic'],
    params: Id,
    body: UpdateSessionSchema,
    response: ClassSessionSchema,
  })
  update(
    @ZodParams(Id) p: IdP,
    @ZodBody(UpdateSessionSchema) b: z.infer<typeof UpdateSessionSchema>,
  ) {
    return this.sessions.update(p.id, b);
  }

  @Post('generate')
  @HttpCode(200)
  @RequirePermission('MANAGE_SCHEDULES')
  @ApiDoc({
    summary: 'Générer les séances des prochains jours depuis les emplois du temps (idempotent)',
    tags: ['academic'],
    body: GenerateSessionsSchema,
  })
  generate(@ZodBody(GenerateSessionsSchema) b: z.infer<typeof GenerateSessionsSchema>) {
    return this.sessions.generate(b);
  }
}

const MineQuery = CursorQuerySchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

@Controller('me/schedule')
export class MySessionsController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  @ApiDoc({
    summary: 'Mon emploi du temps : mes séances (ou toutes avec une portée globale)',
    tags: ['academic'],
    query: MineQuery,
  })
  mine(@ZodQuery(MineQuery) q: z.infer<typeof MineQuery>) {
    return this.sessions.mine(q);
  }
}
