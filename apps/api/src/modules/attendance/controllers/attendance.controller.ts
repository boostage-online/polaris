import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  AttendanceHistoryItemSchema,
  AttendanceSheetSchema,
  AttendanceSummarySchema,
  ChildAttendanceSummarySchema,
  CorrectRecordSchema,
  CreateJustificationSchema,
  GuardianJustificationSchema,
  HistoryQuerySchema,
  JustificationSchema,
  JustificationsQuerySchema,
  LockSheetsSchema,
  MissingQuerySchema,
  MissingSheetSchema,
  PatchSheetSchema,
  RecordRevisionSchema,
  ReviewJustificationSchema,
  SheetsQuerySchema,
  StudentLifeDashboardSchema,
  SubmitSheetSchema,
  TeacherDashboardSchema,
  TodaySessionSchema,
  WatchlistItemSchema,
} from '@polaris/contracts';
import {
  ApiDoc,
  RequirePermission,
  ZodBody,
  ZodParams,
  ZodQuery,
} from '../../../common/decorators';
import { AttendanceDashboardService } from '../application/attendance-dashboard.service';
import { JustificationService } from '../application/justification.service';
import { SheetService } from '../application/sheet.service';
import { StatsService } from '../application/stats.service';

const Id = z.object({ id: z.string().uuid() });
type IdP = z.infer<typeof Id>;
const StudentP = z.object({ studentId: z.string().uuid() });
const TodayQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const T = ['attendance'];

/** Séances du jour et prochain cours de l'utilisateur. */
@Controller('me/schedule')
export class MyTodayController {
  constructor(private readonly sheets: SheetService) {}

  @Get('today')
  @ApiDoc({
    summary: "Mes séances du jour avec l'état de l'appel et le prochain cours",
    tags: T,
    query: TodayQuery,
    response: z.array(TodaySessionSchema),
  })
  today(@ZodQuery(TodayQuery) q: z.infer<typeof TodayQuery>) {
    return this.sheets.today(q.date);
  }
}

@Controller('sessions')
export class SessionAttendanceController {
  constructor(private readonly sheets: SheetService) {}

  @Post(':id/attendance-sheet')
  @HttpCode(200)
  @RequirePermission('TAKE_ATTENDANCE', 'TAKE_ATTENDANCE_ANY')
  @ApiDoc({
    summary: "Ouvrir (ou retrouver) la feuille d'appel d'une séance, pré-remplie « présents »",
    tags: T,
    params: Id,
    response: AttendanceSheetSchema,
  })
  open(@ZodParams(Id) p: IdP) {
    return this.sheets.open(p.id);
  }

  @Get(':id/attendance-sheet')
  @RequirePermission(
    'VIEW_ATTENDANCE',
    'VIEW_ATTENDANCE_ANY',
    'TAKE_ATTENDANCE',
    'TAKE_ATTENDANCE_ANY',
    'VIEW_ATTENDANCE_REPORTS',
  )
  @ApiDoc({
    summary: "Feuille d'appel d'une séance",
    tags: T,
    params: Id,
    response: AttendanceSheetSchema,
  })
  bySession(@ZodParams(Id) p: IdP) {
    return this.sheets.bySession(p.id);
  }
}

@Controller('attendance-sheets')
export class AttendanceSheetsController {
  constructor(private readonly sheets: SheetService) {}

  @Get()
  @RequirePermission(
    'VIEW_ATTENDANCE',
    'VIEW_ATTENDANCE_ANY',
    'TAKE_ATTENDANCE',
    'TAKE_ATTENDANCE_ANY',
    'VIEW_ATTENDANCE_REPORTS',
  )
  @ApiDoc({
    summary: "Feuilles d'appel (période, groupe, statut ; `mine` = mes cours)",
    tags: T,
    query: SheetsQuerySchema,
  })
  list(@ZodQuery(SheetsQuerySchema) q: z.infer<typeof SheetsQuerySchema>) {
    return this.sheets.list(q);
  }

  @Get('missing')
  @RequirePermission('VIEW_ATTENDANCE_ANY', 'TAKE_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS')
  @ApiDoc({
    summary: 'Appels manquants : séances terminées sans feuille soumise',
    tags: T,
    query: MissingQuerySchema,
    response: z.array(MissingSheetSchema),
  })
  missing(@ZodQuery(MissingQuerySchema) q: z.infer<typeof MissingQuerySchema>) {
    return this.sheets.missing(q);
  }

  @Post('lock')
  @HttpCode(200)
  @RequirePermission('EDIT_ATTENDANCE_LOCKED')
  @ApiDoc({
    summary: "Verrouiller ou déverrouiller les feuilles d'une période",
    tags: T,
    body: LockSheetsSchema,
  })
  lock(@ZodBody(LockSheetsSchema) b: z.infer<typeof LockSheetsSchema>) {
    return this.sheets.lock(b);
  }

  @Get(':id')
  @RequirePermission(
    'VIEW_ATTENDANCE',
    'VIEW_ATTENDANCE_ANY',
    'TAKE_ATTENDANCE',
    'TAKE_ATTENDANCE_ANY',
    'VIEW_ATTENDANCE_REPORTS',
  )
  @ApiDoc({
    summary: "Feuille d'appel avec ses enregistrements",
    tags: T,
    params: Id,
    response: AttendanceSheetSchema,
  })
  get(@ZodParams(Id) p: IdP) {
    return this.sheets.get(p.id);
  }

  @Patch(':id')
  @RequirePermission('TAKE_ATTENDANCE', 'TAKE_ATTENDANCE_ANY')
  @ApiDoc({
    summary: 'Enregistrer le brouillon (version optimiste ; 409 VERSION_CONFLICT sinon)',
    tags: T,
    params: Id,
    body: PatchSheetSchema,
    response: AttendanceSheetSchema,
  })
  patch(@ZodParams(Id) p: IdP, @ZodBody(PatchSheetSchema) b: z.infer<typeof PatchSheetSchema>) {
    return this.sheets.patch(p.id, b);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('TAKE_ATTENDANCE', 'TAKE_ATTENDANCE_ANY')
  @ApiDoc({
    summary: "Valider l'appel : enregistrements figés, événements, statistiques",
    tags: T,
    params: Id,
    body: SubmitSheetSchema,
    response: AttendanceSheetSchema,
  })
  submit(@ZodParams(Id) p: IdP, @ZodBody(SubmitSheetSchema) b: z.infer<typeof SubmitSheetSchema>) {
    return this.sheets.submit(p.id, b);
  }
}

@Controller('attendance-records')
export class AttendanceRecordsController {
  constructor(private readonly sheets: SheetService) {}

  @Patch(':id')
  @RequirePermission('EDIT_ATTENDANCE', 'EDIT_ATTENDANCE_LOCKED')
  @ApiDoc({
    summary: 'Corriger un enregistrement soumis (motif obligatoire, ligne de révision)',
    tags: T,
    params: Id,
    body: CorrectRecordSchema,
    response: AttendanceSheetSchema,
  })
  correct(
    @ZodParams(Id) p: IdP,
    @ZodBody(CorrectRecordSchema) b: z.infer<typeof CorrectRecordSchema>,
  ) {
    return this.sheets.correct(p.id, b);
  }

  @Get(':id/revisions')
  @RequirePermission(
    'VIEW_ATTENDANCE',
    'VIEW_ATTENDANCE_ANY',
    'TAKE_ATTENDANCE',
    'TAKE_ATTENDANCE_ANY',
    'VIEW_ATTENDANCE_REPORTS',
  )
  @ApiDoc({
    summary: "Historique des corrections d'un enregistrement",
    tags: T,
    params: Id,
    response: z.array(RecordRevisionSchema),
  })
  revisions(@ZodParams(Id) p: IdP) {
    return this.sheets.revisions(p.id);
  }
}

@Controller('justifications')
export class JustificationsController {
  constructor(private readonly justifications: JustificationService) {}

  @Get()
  @RequirePermission('REVIEW_JUSTIFICATION', 'VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS')
  @ApiDoc({
    summary: 'File des justificatifs (plus anciens en premier)',
    tags: ['justifications'],
    query: JustificationsQuerySchema,
  })
  list(@ZodQuery(JustificationsQuerySchema) q: z.infer<typeof JustificationsQuerySchema>) {
    return this.justifications.list(q);
  }

  @Post()
  @RequirePermission('REVIEW_JUSTIFICATION', 'TAKE_ATTENDANCE_ANY')
  @ApiDoc({
    summary: 'Déposer un justificatif pour un élève sur un intervalle',
    tags: ['justifications'],
    body: CreateJustificationSchema,
    response: JustificationSchema,
    status: 201,
  })
  create(@ZodBody(CreateJustificationSchema) b: z.infer<typeof CreateJustificationSchema>) {
    return this.justifications.create(b);
  }

  @Get(':id')
  @RequirePermission('REVIEW_JUSTIFICATION', 'VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS')
  @ApiDoc({
    summary: "Détail d'un justificatif et des enregistrements couverts",
    tags: ['justifications'],
    params: Id,
    response: JustificationSchema,
  })
  get(@ZodParams(Id) p: IdP) {
    return this.justifications.get(p.id);
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequirePermission('REVIEW_JUSTIFICATION')
  @ApiDoc({
    summary: 'Accepter, refuser ou demander un complément',
    tags: ['justifications'],
    params: Id,
    body: ReviewJustificationSchema,
    response: JustificationSchema,
  })
  review(
    @ZodParams(Id) p: IdP,
    @ZodBody(ReviewJustificationSchema) b: z.infer<typeof ReviewJustificationSchema>,
  ) {
    return this.justifications.review(p.id, b);
  }
}

@Controller('students')
export class StudentAttendanceController {
  constructor(private readonly stats: StatsService) {}

  @Get(':id/attendance')
  @RequirePermission('VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS', 'REVIEW_JUSTIFICATION')
  @ApiDoc({
    summary: "Historique d'assiduité d'un élève",
    tags: T,
    params: Id,
    query: HistoryQuerySchema,
  })
  history(
    @ZodParams(Id) p: IdP,
    @ZodQuery(HistoryQuerySchema) q: z.infer<typeof HistoryQuerySchema>,
  ) {
    return this.stats.historyOf(p.id, q);
  }

  @Get(':id/attendance/summary')
  @RequirePermission('VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS', 'REVIEW_JUSTIFICATION')
  @ApiDoc({
    summary: "Résumé d'assiduité d'un élève sur une période (défaut : 30 jours)",
    tags: T,
    params: Id,
    query: HistoryQuerySchema,
    response: AttendanceSummarySchema,
  })
  summary(
    @ZodParams(Id) p: IdP,
    @ZodQuery(HistoryQuerySchema) q: z.infer<typeof HistoryQuerySchema>,
  ) {
    const to = q.to ?? new Date().toISOString().slice(0, 10);
    const from = q.from ?? new Date(Date.now() - 29 * 24 * 3_600_000).toISOString().slice(0, 10);
    return this.stats.summaryOf(p.id, from, to);
  }
}

@Controller('attendance')
export class WatchlistController {
  constructor(private readonly stats: StatsService) {}

  @Get('watchlist')
  @RequirePermission('VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS', 'REVIEW_JUSTIFICATION')
  @ApiDoc({
    summary: 'Élèves à surveiller (seuil d’absences non justifiées atteint)',
    tags: T,
    response: z.array(WatchlistItemSchema),
  })
  watchlist() {
    return this.stats.watchlist();
  }

  @Post('alerts/:id/resolve')
  @HttpCode(200)
  @RequirePermission('REVIEW_JUSTIFICATION', 'EDIT_ATTENDANCE_LOCKED')
  @ApiDoc({ summary: 'Clore une alerte (suivi effectué)', tags: T, params: Id })
  resolve(@ZodParams(Id) p: IdP) {
    return this.stats.resolveAlert(p.id);
  }
}

@Controller('dashboards')
export class AttendanceDashboardsController {
  constructor(private readonly dashboards: AttendanceDashboardService) {}

  @Get('teacher')
  @RequirePermission('TAKE_ATTENDANCE', 'VIEW_ATTENDANCE', 'TAKE_ATTENDANCE_ANY')
  @ApiDoc({
    summary: 'Tableau de bord enseignant (séances du jour, appels, absences)',
    tags: ['dashboards'],
    response: TeacherDashboardSchema,
  })
  teacher() {
    return this.dashboards.teacher();
  }

  @Get('student-life')
  @RequirePermission('VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS')
  @ApiDoc({
    summary: 'Tableau de bord vie scolaire (jour, justificatifs, surveillance, appels manquants)',
    tags: ['dashboards'],
    response: StudentLifeDashboardSchema,
  })
  studentLife() {
    return this.dashboards.studentLife();
  }
}

/** Espace parent : assiduité des enfants liés avec le droit correspondant. */
@Controller('me/children')
export class MyChildrenAttendanceController {
  constructor(
    private readonly dashboards: AttendanceDashboardService,
    private readonly justifications: JustificationService,
  ) {}

  @Get('summary')
  @ApiDoc({
    summary: "Assiduité de mes enfants : aujourd'hui, 30 jours, alertes (un appel)",
    tags: ['parent'],
    response: z.array(ChildAttendanceSummarySchema),
  })
  summary() {
    return this.dashboards.childrenSummary();
  }

  @Get(':studentId/attendance')
  @ApiDoc({
    summary: "Historique d'assiduité d'un enfant",
    tags: ['parent'],
    params: StudentP,
    query: HistoryQuerySchema,
    response: z.array(AttendanceHistoryItemSchema),
  })
  history(
    @ZodParams(StudentP) p: z.infer<typeof StudentP>,
    @ZodQuery(HistoryQuerySchema) q: z.infer<typeof HistoryQuerySchema>,
  ) {
    return this.dashboards.childHistory(p.studentId, q);
  }

  @Get(':studentId/justifications')
  @ApiDoc({
    summary: 'Justificatifs déposés pour un enfant',
    tags: ['parent'],
    params: StudentP,
    response: z.array(JustificationSchema),
  })
  justificationsOf(@ZodParams(StudentP) p: z.infer<typeof StudentP>) {
    return this.justifications.forChild(p.studentId);
  }

  @Post(':studentId/justifications')
  @ApiDoc({
    summary:
      'Déposer un justificatif pour mon enfant (si l’établissement l’autorise et si j’en ai le droit)',
    tags: ['parent'],
    params: StudentP,
    body: GuardianJustificationSchema,
    response: JustificationSchema,
    status: 201,
  })
  submitJustification(
    @ZodParams(StudentP) p: z.infer<typeof StudentP>,
    @ZodBody(GuardianJustificationSchema) b: z.infer<typeof GuardianJustificationSchema>,
  ) {
    return this.justifications.createAsGuardian({ ...b, studentId: p.studentId });
  }
}
