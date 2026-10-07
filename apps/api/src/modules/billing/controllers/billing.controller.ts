import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  AssignFeesSchema,
  AssignStudentFeesSchema,
  AssignmentReportSchema,
  ChildFinanceSummarySchema,
  CreateAdjustmentSchema,
  CreateFeeCategorySchema,
  CreateFeeStructureSchema,
  ExportQuerySchema,
  FeeCategorySchema,
  FeeStructureSchema,
  FeeStructuresQuerySchema,
  FinanceDashboardSchema,
  PaymentSchema,
  PaymentsQuerySchema,
  ReceiptSchema,
  ReceiptVerificationSchema,
  RecordManualPaymentSchema,
  ReminderReportSchema,
  ReversePaymentSchema,
  SendRemindersSchema,
  StudentAccountSchema,
  UnpaidByGroupSchema,
  UnpaidQuerySchema,
  UpdateFeeCategorySchema,
  UpdateFeeStructureSchema,
} from '@polaris/contracts';
import {
  ApiDoc,
  NoTransaction,
  Public,
  RequireIdempotencyKey,
  RequirePermission,
  Scope,
  ZodBody,
  ZodParams,
  ZodQuery,
} from '../../../common/decorators';
import { raw } from '../../../common/interceptors/envelope.interceptor';
import { CatalogService } from '../application/catalog.service';
import { FinanceDashboardService } from '../application/finance-dashboard.service';
import { LedgerService } from '../application/ledger.service';
import { ReceiptService } from '../application/receipt.service';
import { UnpaidService } from '../application/unpaid.service';

const Id = z.object({ id: z.string().uuid() });
type IdP = z.infer<typeof Id>;
const T = ['billing'];
const ReceiptKindQuery = z.object({ kind: z.enum(['PAYMENT', 'CANCELLATION']).default('PAYMENT') });

@Controller('fee-categories')
export class FeeCategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermission('VIEW_FEES')
  @ApiDoc({ summary: 'Catégories de frais', tags: T, response: z.array(FeeCategorySchema) })
  list() {
    return this.catalog.listCategories();
  }

  @Post()
  @RequirePermission('MANAGE_FEE_STRUCTURES')
  @ApiDoc({
    summary: 'Créer une catégorie',
    tags: T,
    body: CreateFeeCategorySchema,
    response: FeeCategorySchema,
    status: 201,
  })
  create(@ZodBody(CreateFeeCategorySchema) b: z.infer<typeof CreateFeeCategorySchema>) {
    return this.catalog.createCategory(b);
  }

  @Patch(':id')
  @RequirePermission('MANAGE_FEE_STRUCTURES')
  @ApiDoc({
    summary: 'Modifier une catégorie',
    tags: T,
    params: Id,
    body: UpdateFeeCategorySchema,
    response: FeeCategorySchema,
  })
  update(
    @ZodParams(Id) p: IdP,
    @ZodBody(UpdateFeeCategorySchema) b: z.infer<typeof UpdateFeeCategorySchema>,
  ) {
    return this.catalog.updateCategory(p.id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('MANAGE_FEE_STRUCTURES')
  @ApiDoc({ summary: 'Supprimer une catégorie sans grille', tags: T, params: Id, status: 204 })
  remove(@ZodParams(Id) p: IdP) {
    return this.catalog.deleteCategory(p.id);
  }
}

@Controller('fee-structures')
export class FeeStructuresController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermission('VIEW_FEES')
  @ApiDoc({
    summary: "Grilles de frais de l'année (échéancier type, nombre d'élèves affectés)",
    tags: T,
    query: FeeStructuresQuerySchema,
    response: z.array(FeeStructureSchema),
  })
  list(@ZodQuery(FeeStructuresQuerySchema) q: z.infer<typeof FeeStructuresQuerySchema>) {
    return this.catalog.listStructures(q);
  }

  @Get(':id')
  @RequirePermission('VIEW_FEES')
  @ApiDoc({ summary: "Détail d'une grille", tags: T, params: Id, response: FeeStructureSchema })
  get(@ZodParams(Id) p: IdP) {
    return this.catalog.getStructure(p.id);
  }

  @Post()
  @RequirePermission('MANAGE_FEE_STRUCTURES')
  @ApiDoc({
    summary: 'Créer une grille avec son échéancier (Σ échéances = total)',
    tags: T,
    body: CreateFeeStructureSchema,
    response: FeeStructureSchema,
    status: 201,
  })
  create(@ZodBody(CreateFeeStructureSchema) b: z.infer<typeof CreateFeeStructureSchema>) {
    return this.catalog.createStructure(b);
  }

  @Patch(':id')
  @RequirePermission('MANAGE_FEE_STRUCTURES')
  @ApiDoc({
    summary: "Modifier une grille (l'échéancier d'une grille déjà affectée est figé)",
    tags: T,
    params: Id,
    body: UpdateFeeStructureSchema,
    response: FeeStructureSchema,
  })
  update(
    @ZodParams(Id) p: IdP,
    @ZodBody(UpdateFeeStructureSchema) b: z.infer<typeof UpdateFeeStructureSchema>,
  ) {
    return this.catalog.updateStructure(p.id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('MANAGE_FEE_STRUCTURES')
  @ApiDoc({ summary: 'Supprimer une grille sans créance', tags: T, params: Id, status: 204 })
  remove(@ZodParams(Id) p: IdP) {
    return this.catalog.deleteStructure(p.id);
  }
}

@Controller('fees')
export class FeesController {
  constructor(private readonly ledger: LedgerService) {}

  @Post('assign')
  @HttpCode(200)
  @RequirePermission('ASSIGN_FEES')
  @ApiDoc({
    summary:
      'Affectation de masse : crée les créances manquantes pour la cible (classes, niveaux, élèves ou cible de la grille)',
    tags: T,
    body: AssignFeesSchema,
    response: AssignmentReportSchema,
  })
  assign(@ZodBody(AssignFeesSchema) b: z.infer<typeof AssignFeesSchema>) {
    return this.ledger.assign(b);
  }

  @Post('adjustments')
  @RequirePermission('ADJUST_FEES')
  @ApiDoc({
    summary:
      'Ajustement de créance (remise, bourse, exonération, pénalité, correction) — motif obligatoire',
    tags: T,
    body: CreateAdjustmentSchema,
    response: StudentAccountSchema,
    status: 201,
  })
  adjust(@ZodBody(CreateAdjustmentSchema) b: z.infer<typeof CreateAdjustmentSchema>) {
    return this.ledger.adjust(b);
  }

  @Post('integrity-check')
  @HttpCode(200)
  @RequirePermission('VIEW_FINANCIAL_REPORTS')
  @ApiDoc({
    summary: "Contrôle d'intégrité du grand-livre (stocké = recalculé, invariants d'allocation)",
    tags: T,
  })
  integrity() {
    return this.ledger.integrityCheck();
  }
}

@Controller('students')
export class StudentBillingController {
  constructor(private readonly ledger: LedgerService) {}

  @Get(':id/fees')
  @RequirePermission('VIEW_FEES')
  @ApiDoc({
    summary: "Compte d'un élève : créances, échéances, paiements, crédits, ajustements, totaux",
    tags: T,
    params: Id,
    response: StudentAccountSchema,
  })
  account(@ZodParams(Id) p: IdP) {
    return this.ledger.account(p.id);
  }

  @Post(':id/fees')
  @HttpCode(200)
  @RequirePermission('ASSIGN_FEES')
  @ApiDoc({
    summary: 'Affecter des grilles à un élève (nouvel inscrit)',
    tags: T,
    params: Id,
    body: AssignStudentFeesSchema,
    response: StudentAccountSchema,
  })
  assign(
    @ZodParams(Id) p: IdP,
    @ZodBody(AssignStudentFeesSchema) b: z.infer<typeof AssignStudentFeesSchema>,
  ) {
    return this.ledger.assignToStudent(p.id, b);
  }

  @Post(':id/payments/manual')
  @RequirePermission('RECORD_MANUAL_PAYMENT')
  @RequireIdempotencyKey()
  @ApiDoc({
    summary:
      'Encaissement manuel (caisse) : paiement immuable, allocation, reçu numéroté — Idempotency-Key obligatoire',
    tags: T,
    params: Id,
    body: RecordManualPaymentSchema,
    response: PaymentSchema,
    status: 201,
  })
  manual(
    @ZodParams(Id) p: IdP,
    @ZodBody(RecordManualPaymentSchema) b: z.infer<typeof RecordManualPaymentSchema>,
  ) {
    return this.ledger.recordManual(p.id, b);
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly receipts: ReceiptService,
  ) {}

  @Get()
  @RequirePermission('VIEW_PAYMENTS')
  @ApiDoc({
    summary: 'Paiements (journal de caisse : période, moyen, caissier, `mine`)',
    tags: T,
    query: PaymentsQuerySchema,
  })
  list(@ZodQuery(PaymentsQuerySchema) q: z.infer<typeof PaymentsQuerySchema>) {
    return this.ledger.listPayments(q);
  }

  @Get(':id')
  @RequirePermission('VIEW_PAYMENTS')
  @ApiDoc({
    summary: "Détail d'un paiement et de ses allocations",
    tags: T,
    params: Id,
    response: PaymentSchema,
  })
  get(@ZodParams(Id) p: IdP) {
    return this.ledger.getPayment(p.id);
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermission('CANCEL_PAYMENT')
  @ApiDoc({
    summary:
      'Annulation compensatoire (motif obligatoire) : contre-passation des allocations, reçu d’annulation',
    tags: T,
    params: Id,
    body: ReversePaymentSchema,
    response: PaymentSchema,
  })
  reverse(
    @ZodParams(Id) p: IdP,
    @ZodBody(ReversePaymentSchema) b: z.infer<typeof ReversePaymentSchema>,
  ) {
    return this.ledger.reverse(p.id, b);
  }

  @Get(':id/receipt')
  @RequirePermission('VIEW_PAYMENTS')
  @ApiDoc({
    summary: "Reçu d'un paiement (instantané figé, URL de vérification)",
    tags: T,
    params: Id,
    response: ReceiptSchema,
  })
  receipt(@ZodParams(Id) p: IdP) {
    return this.receipts.byPayment(p.id);
  }

  @Get(':id/receipt.pdf')
  @RequirePermission('VIEW_PAYMENTS')
  @ApiDoc({ summary: 'Reçu PDF', tags: T, params: Id })
  async receiptPdf(@ZodParams(Id) p: IdP, @Res({ passthrough: true }) res: Response) {
    const r = await this.receipts.byPayment(p.id);
    const row = await this.receipts.byNumber(r.number);
    res.setHeader('Content-Disposition', `inline; filename="recu-${r.number}.pdf"`);
    return raw(new StreamableFile(this.receipts.pdf(row), { type: 'application/pdf' }));
  }
}

/** Vérification publique d'un reçu (page du QR) : rien de nominatif. */
@Controller('receipts')
export class ReceiptVerificationController {
  constructor(private readonly receipts: ReceiptService) {}

  @Get('verify/:tenantCode/:number/:hash')
  @Public()
  @NoTransaction()
  @Scope('identity')
  @ApiDoc({
    summary: "Vérifier l'authenticité d'un reçu (public)",
    tags: T,
    response: ReceiptVerificationSchema,
  })
  verify(
    @ZodParams(
      z.object({
        tenantCode: z.string().min(1).max(40),
        number: z.string().min(5).max(40),
        hash: z.string().min(8).max(64),
      }),
    )
    p: {
      tenantCode: string;
      number: string;
      hash: string;
    },
  ) {
    return this.receipts.verify(p.tenantCode, p.number, p.hash);
  }
}

@Controller('unpaid')
export class UnpaidController {
  constructor(private readonly unpaid: UnpaidService) {}

  @Get()
  @RequirePermission('VIEW_FEES')
  @ApiDoc({
    summary: 'Échéances impayées (par élève, classe, grille ; les plus anciennes d’abord)',
    tags: T,
    query: UnpaidQuerySchema,
  })
  list(@ZodQuery(UnpaidQuerySchema) q: z.infer<typeof UnpaidQuerySchema>) {
    return this.unpaid.list(q);
  }

  @Get('by-group')
  @RequirePermission('VIEW_FEES')
  @ApiDoc({
    summary: 'Synthèse par classe : dû, payé, solde, retard, taux de recouvrement',
    tags: T,
    response: z.array(UnpaidByGroupSchema),
  })
  byGroup() {
    return this.unpaid.byGroup();
  }

  @Post('reminders')
  @HttpCode(200)
  @RequirePermission('SEND_PAYMENT_REMINDER')
  @ApiDoc({
    summary: 'Rappel manuel aux tuteurs pour une sélection d’échéances (dédoublonné par jour)',
    tags: T,
    body: SendRemindersSchema,
    response: ReminderReportSchema,
  })
  remind(@ZodBody(SendRemindersSchema) b: z.infer<typeof SendRemindersSchema>) {
    return this.unpaid.sendManual(b);
  }
}

@Controller('exports')
export class ExportsController {
  constructor(private readonly unpaid: UnpaidService) {}

  @Get('payments.csv')
  @RequirePermission('EXPORT_FINANCIAL_DATA')
  @ApiDoc({ summary: 'Journal des encaissements (CSV ;)', tags: T, query: ExportQuerySchema })
  async payments(
    @ZodQuery(ExportQuerySchema) q: z.infer<typeof ExportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="journal-encaissements.csv"');
    return raw(await this.unpaid.exportPaymentsCsv(q));
  }

  @Get('aged-balance.csv')
  @RequirePermission('EXPORT_FINANCIAL_DATA')
  @ApiDoc({ summary: 'Balance âgée par élève (CSV ;)', tags: T, query: ExportQuerySchema })
  async aged(
    @ZodQuery(ExportQuerySchema) q: z.infer<typeof ExportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="balance-agee.csv"');
    return raw(await this.unpaid.exportAgedBalanceCsv(q));
  }

  @Get('unpaid.csv')
  @RequirePermission('EXPORT_FINANCIAL_DATA')
  @ApiDoc({ summary: 'Impayés par échéance (CSV ;)', tags: T, query: ExportQuerySchema })
  async unpaidCsv(
    @ZodQuery(ExportQuerySchema) q: z.infer<typeof ExportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="impayes.csv"');
    return raw(await this.unpaid.exportUnpaidCsv(q));
  }
}

@Controller('dashboards')
export class FinanceDashboardController {
  constructor(private readonly dashboards: FinanceDashboardService) {}

  @Get('finance')
  @RequirePermission('VIEW_FINANCIAL_REPORTS')
  @ApiDoc({
    summary:
      'Tableau de bord finance (année, caisse du jour, mois, à venir, par classe, intégrité)',
    tags: ['dashboards'],
    response: FinanceDashboardSchema,
  })
  finance() {
    return this.dashboards.finance();
  }
}

const StudentP = z.object({ studentId: z.string().uuid() });
const StudentPaymentP = z.object({ studentId: z.string().uuid(), paymentId: z.string().uuid() });

/** Espace parent : frais, solde, échéances, paiements et reçus des enfants avec le droit finance. */
@Controller('me/children')
export class MyChildrenFinanceController {
  constructor(
    private readonly dashboards: FinanceDashboardService,
    private readonly receipts: ReceiptService,
  ) {}

  @Get('finance')
  @ApiDoc({
    summary: 'Frais de mes enfants : solde, prochaine échéance, paiements récents',
    tags: ['parent'],
    response: z.array(ChildFinanceSummarySchema),
  })
  finance() {
    return this.dashboards.childrenFinance();
  }

  @Get(':studentId/fees')
  @ApiDoc({
    summary: "Compte complet d'un enfant",
    tags: ['parent'],
    params: StudentP,
    response: StudentAccountSchema,
  })
  account(@ZodParams(StudentP) p: z.infer<typeof StudentP>) {
    return this.dashboards.childAccount(p.studentId);
  }

  @Get(':studentId/payments/:paymentId/receipt')
  @ApiDoc({
    summary: "Reçu d'un paiement de mon enfant",
    tags: ['parent'],
    params: StudentPaymentP,
    response: ReceiptSchema,
  })
  async receipt(@ZodParams(StudentPaymentP) p: z.infer<typeof StudentPaymentP>) {
    const acc = await this.dashboards.childAccount(p.studentId);
    if (!acc.payments.some((x) => x.id === p.paymentId))
      return this.receipts.byPayment('00000000-0000-0000-0000-000000000000');
    return this.receipts.byPayment(p.paymentId);
  }

  @Get(':studentId/payments/:paymentId/receipt.pdf')
  @ApiDoc({
    summary: "Reçu PDF d'un paiement de mon enfant",
    tags: ['parent'],
    params: StudentPaymentP,
  })
  async receiptPdf(
    @ZodParams(StudentPaymentP) p: z.infer<typeof StudentPaymentP>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const acc = await this.dashboards.childAccount(p.studentId);
    const found = acc.payments.some((x) => x.id === p.paymentId);
    const r = await this.receipts.byPayment(
      found ? p.paymentId : '00000000-0000-0000-0000-000000000000',
    );
    const row = await this.receipts.byNumber(r.number);
    res.setHeader('Content-Disposition', `inline; filename="recu-${r.number}.pdf"`);
    return raw(new StreamableFile(this.receipts.pdf(row), { type: 'application/pdf' }));
  }
}
