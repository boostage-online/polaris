import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AttemptTimelineSchema,
  AttemptsQuerySchema,
  ConfirmPaymentAttemptSchema,
  CreatePaymentAttemptSchema,
  PaymentAttemptSchema,
  PaymentConfigSchema,
  PaymentOptionsSchema,
  PaymentProviderCodeSchema,
  PendingPaymentsSchema,
  ReconciliationRunSchema,
  ResolveAttemptSchema,
  ResolveOrphanSchema,
  UpsertPaymentConfigSchema,
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
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { raw } from '../../../common/interceptors/envelope.interceptor';
import { FakeCheckoutService } from '../application/fake-checkout.service';
import { PaymentConfigService } from '../application/payment-config.service';
import { PaymentsService } from '../application/payments.service';
import { ReconciliationService } from '../application/reconciliation.service';
import { WebhookService } from '../application/webhook.service';

const T = ['payments'];
const Id = z.object({ id: z.string().uuid() });
const StudentP = z.object({ studentId: z.string().uuid() });
const StudentAttemptP = z.object({ studentId: z.string().uuid(), attemptId: z.string().uuid() });
const ProviderP = z.object({ provider: PaymentProviderCodeSchema });

// ----------------------------------------------------------------------------- espace parent

@Controller('me/children')
export class MyChildrenPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':studentId/payment-options')
  @NoTransaction()
  @ApiDoc({
    summary: 'Puis-je payer en ligne pour cet enfant ? (provider, bornes de montant)',
    tags: ['parent'],
    params: StudentP,
    response: PaymentOptionsSchema,
  })
  options(@ZodParams(StudentP) p: z.infer<typeof StudentP>) {
    return this.payments.options(p.studentId);
  }

  @Post(':studentId/payment-attempts')
  @HttpCode(201)
  @NoTransaction()
  @RequireIdempotencyKey()
  @ApiDoc({
    summary: 'Démarrer un paiement en ligne (tentative → URL ou widget du provider)',
    tags: ['parent'],
    params: StudentP,
    body: CreatePaymentAttemptSchema,
    response: PaymentAttemptSchema,
  })
  create(
    @ZodParams(StudentP) p: z.infer<typeof StudentP>,
    @ZodBody(CreatePaymentAttemptSchema) b: z.infer<typeof CreatePaymentAttemptSchema>,
  ) {
    return this.payments.create(p.studentId, b);
  }

  @Get(':studentId/payment-attempts')
  @ApiDoc({
    summary: 'Mes tentatives de paiement récentes pour cet enfant',
    tags: ['parent'],
    params: StudentP,
    response: z.array(PaymentAttemptSchema),
  })
  list(@ZodParams(StudentP) p: z.infer<typeof StudentP>) {
    return this.payments.listForGuardian(p.studentId);
  }

  @Get(':studentId/payment-attempts/:attemptId')
  @ApiDoc({
    summary: "État d'une tentative (polling après retour du provider)",
    tags: ['parent'],
    params: StudentAttemptP,
    response: PaymentAttemptSchema,
  })
  get(@ZodParams(StudentAttemptP) p: z.infer<typeof StudentAttemptP>) {
    return this.payments.getForGuardian(p.studentId, p.attemptId);
  }

  @Post(':studentId/payment-attempts/:attemptId/confirm')
  @HttpCode(200)
  @NoTransaction()
  @ApiDoc({
    summary: 'Retour du provider : déclenche la vérification serveur-à-serveur',
    tags: ['parent'],
    params: StudentAttemptP,
    body: ConfirmPaymentAttemptSchema,
    response: PaymentAttemptSchema,
  })
  confirm(
    @ZodParams(StudentAttemptP) p: z.infer<typeof StudentAttemptP>,
    @ZodBody(ConfirmPaymentAttemptSchema) b: z.infer<typeof ConfirmPaymentAttemptSchema>,
  ) {
    return this.payments.confirmFromReturn(p.studentId, p.attemptId, b.externalId);
  }
}

// ----------------------------------------------------------------------------- finance

@Controller('payment-attempts')
export class PaymentAttemptsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get()
  @RequirePermission('VIEW_PAYMENTS')
  @ApiDoc({
    summary: 'Tentatives de paiement en ligne (filtres statut, élève, revue, période)',
    tags: T,
    query: AttemptsQuerySchema,
  })
  list(@ZodQuery(AttemptsQuerySchema) q: z.infer<typeof AttemptsQuerySchema>) {
    return this.payments.list(q);
  }

  @Get('pending')
  @RequirePermission('VIEW_PAYMENTS')
  @ApiDoc({
    summary:
      'Transactions en attente : revues ouvertes, en attente anciennes, orphelines, santé provider',
    tags: T,
    response: PendingPaymentsSchema,
  })
  pending() {
    return this.reconciliation.pending();
  }

  @Get(':id')
  @RequirePermission('VIEW_PAYMENTS')
  @ApiDoc({
    summary: "Chronologie d'une tentative (initiate, webhooks, verify, paiement, audit)",
    tags: T,
    params: Id,
    response: AttemptTimelineSchema,
  })
  timeline(@ZodParams(Id) p: z.infer<typeof Id>) {
    return this.payments.timeline(p.id);
  }

  @Post(':id/reverify')
  @HttpCode(200)
  @NoTransaction()
  @RequirePermission('CANCEL_PAYMENT', 'MANAGE_PAYMENT_PROVIDER')
  @ApiDoc({
    summary: 'Re-vérifier auprès du provider (UNKNOWN redevient vérifiable)',
    tags: T,
    params: Id,
    response: PaymentAttemptSchema,
  })
  reverify(@ZodParams(Id) p: z.infer<typeof Id>) {
    return this.payments.reverify(p.id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermission('CANCEL_PAYMENT', 'MANAGE_PAYMENT_PROVIDER')
  @ApiDoc({
    summary: 'Marquer une tentative en revue comme résolue (motif, audité)',
    tags: T,
    params: Id,
    body: ResolveAttemptSchema,
    response: PaymentAttemptSchema,
  })
  resolve(
    @ZodParams(Id) p: z.infer<typeof Id>,
    @ZodBody(ResolveAttemptSchema) b: z.infer<typeof ResolveAttemptSchema>,
  ) {
    return this.payments.resolve(p.id, b.note);
  }
}

@Controller('payment-reconciliation')
export class PaymentReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly db: DatabaseService,
  ) {}

  @Get()
  @RequirePermission('VIEW_FINANCIAL_REPORTS')
  @ApiDoc({
    summary: 'Réconciliations quotidiennes provider ↔ Polaris',
    tags: T,
    response: z.array(ReconciliationRunSchema),
  })
  runs() {
    return this.reconciliation.runs();
  }

  @Post('run')
  @HttpCode(200)
  @NoTransaction()
  @RequirePermission('CANCEL_PAYMENT', 'MANAGE_PAYMENT_PROVIDER')
  @ApiDoc({
    summary: 'Lancer la réconciliation d’une journée (défaut : hier)',
    tags: T,
    body: z.object({
      day: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
  })
  async run(
    @ZodBody(
      z.object({
        day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    b: {
      day?: string;
    },
  ) {
    const tenantId = RequestContextStore.require().tenantId!;
    const runId = await this.reconciliation.daily(tenantId, b.day);
    if (!runId) throw AppError.conflict('Aucun provider actif : rien à réconcilier');
    const runs = await this.db.withTenantTx(tenantId, () => this.reconciliation.runs(50));
    return runs.find((r) => r.id === runId) ?? runs[0];
  }

  @Post(':id/orphans/resolve')
  @HttpCode(200)
  @RequirePermission('CANCEL_PAYMENT', 'MANAGE_PAYMENT_PROVIDER')
  @ApiDoc({
    summary: 'Marquer une transaction orpheline comme traitée (motif)',
    tags: T,
    params: Id,
    body: ResolveOrphanSchema,
    response: ReconciliationRunSchema,
  })
  resolveOrphan(
    @ZodParams(Id) p: z.infer<typeof Id>,
    @ZodBody(ResolveOrphanSchema) b: z.infer<typeof ResolveOrphanSchema>,
  ) {
    return this.reconciliation.resolveOrphan(p.id, b.externalId, b.note);
  }
}

@Controller('payment-config')
export class PaymentConfigController {
  constructor(private readonly configs: PaymentConfigService) {}

  @Get()
  @RequirePermission('MANAGE_PAYMENT_PROVIDER')
  @ApiDoc({
    summary: 'Comptes marchands configurés (clés masquées, URL de webhook)',
    tags: T,
    response: z.array(PaymentConfigSchema),
  })
  list() {
    return this.configs.list();
  }

  @Put()
  @RequirePermission('MANAGE_PAYMENT_PROVIDER')
  @ApiDoc({
    summary:
      'Créer ou mettre à jour la configuration d’un provider (secrets chiffrés ; re-test requis)',
    tags: T,
    body: UpsertPaymentConfigSchema,
    response: PaymentConfigSchema,
  })
  upsert(@ZodBody(UpsertPaymentConfigSchema) b: z.infer<typeof UpsertPaymentConfigSchema>) {
    return this.configs.upsert(b);
  }

  @Post(':provider/test')
  @HttpCode(200)
  @RequirePermission('MANAGE_PAYMENT_PROVIDER')
  @ApiDoc({
    summary: 'Tester la connexion avec les clés enregistrées ; succès → provider actif',
    tags: T,
    params: ProviderP,
    response: PaymentConfigSchema,
  })
  test(@ZodParams(ProviderP) p: z.infer<typeof ProviderP>) {
    return this.configs.test(p.provider);
  }

  @Patch(':provider/status')
  @RequirePermission('MANAGE_PAYMENT_PROVIDER')
  @ApiDoc({
    summary: 'Activer ou désactiver un provider',
    tags: T,
    params: ProviderP,
    body: z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }),
    response: PaymentConfigSchema,
  })
  status(
    @ZodParams(ProviderP) p: z.infer<typeof ProviderP>,
    @ZodBody(z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }))
    b: { status: 'ACTIVE' | 'DISABLED' },
  ) {
    return this.configs.setStatus(p.provider, b.status);
  }
}

// ----------------------------------------------------------------------------- webhooks (publics)

@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post(':provider/:token')
  @HttpCode(200)
  @Public()
  @NoTransaction()
  @Scope('identity')
  @ApiDoc({
    summary: 'Webhook provider (signature vérifiée, unicité, mise en file ; 200 en < 200 ms)',
    tags: T,
  })
  async receive(
    @ZodParams(z.object({ provider: z.string().min(1).max(20), token: z.string().min(8).max(80) }))
    p: { provider: string; token: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody ??
      Buffer.from(JSON.stringify(req.body ?? {}));
    const out = await this.webhooks.receive(p.provider, p.token, headers, rawBody);
    if (out.outcome === 'UNKNOWN_ENDPOINT') res.status(404);
    else if (out.outcome === 'INVALID_SIGNATURE' || out.outcome === 'UNPARSEABLE') res.status(400);
    return raw({
      received: out.outcome === 'ACCEPTED' || out.outcome === 'DUPLICATE',
      outcome: out.outcome,
    });
  }
}

// ----------------------------------------------------------------------------- provider de démonstration

@Controller('dev/fake-provider')
export class FakeProviderController {
  constructor(
    private readonly fake: FakeCheckoutService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private assertEnabled() {
    if (!this.env.PAYMENT_FAKE_PROVIDER_ENABLED) throw AppError.notFound();
  }

  @Get('transactions/:externalId')
  @Public()
  @NoTransaction()
  @Scope('identity')
  @ApiDoc({ summary: '[Démo] Transaction de la caisse factice', tags: T })
  get(@ZodParams(z.object({ externalId: z.string().min(5).max(60) })) p: { externalId: string }) {
    this.assertEnabled();
    return this.fake.get(p.externalId);
  }

  @Post('transactions/:externalId/complete')
  @HttpCode(200)
  @Public()
  @NoTransaction()
  @Scope('identity')
  @ApiDoc({ summary: '[Démo] Le parent paie / échoue / annule : poste le webhook signé', tags: T })
  complete(
    @ZodParams(z.object({ externalId: z.string().min(5).max(60) })) p: { externalId: string },
    @ZodBody(
      z.object({
        status: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
        amount: z.number().int().min(1).optional(),
      }),
    )
    b: { status: 'SUCCESS' | 'FAILED' | 'CANCELLED'; amount?: number },
  ) {
    this.assertEnabled();
    return this.fake.complete(p.externalId, b.status, b.amount);
  }

  @Post('outage')
  @HttpCode(200)
  @RequirePermission('MANAGE_PAYMENT_PROVIDER')
  @NoTransaction()
  @ApiDoc({
    summary: '[Démo] Simuler une panne du provider de démonstration',
    tags: T,
    body: z.object({ on: z.boolean() }),
  })
  outage(@ZodBody(z.object({ on: z.boolean() })) b: { on: boolean }) {
    this.assertEnabled();
    return this.fake.setOutage(b.on);
  }
}
