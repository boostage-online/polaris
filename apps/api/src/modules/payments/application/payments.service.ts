import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  AttemptsQuerySchema,
  CreatePaymentAttemptSchema,
  PaymentAttempt as AttemptDto,
} from '@polaris/contracts';
import { ErrorCodes } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor, page } from '../../../common/http/cursor';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  auditLogs,
  guardians,
  paymentAttempts,
  providerTransactions,
  receipts,
  students,
  tenants,
  users,
  webhookEvents,
} from '../../../database/schema';
import { AuditService } from '../../audit';
import { LedgerService } from '../../billing';
import { OutboxService } from '../../shared';
import { GuardianService } from '../../students-guardians';
import {
  ATTEMPT_TTL_MINUTES,
  FAILURE_MESSAGES,
  isTerminal,
  nextCheckDelayMs,
  nextStatus,
  paymentRulesFrom,
  validateAmount,
  type AttemptStatus,
} from '../domain/attempts';
import { paymentAttemptFailed, paymentReviewNeeded } from '../domain/events';
import { PROVIDER_LABELS, ProviderError, type VerifyResult } from '../domain/provider';
import { ProviderRegistry } from '../infrastructure/provider-registry';
import { PaymentConfigService } from './payment-config.service';
import { PaymentsQueue } from './payments.queue';

type AttemptRow = typeof paymentAttempts.$inferSelect;

export interface ConfirmInput {
  tenantId: string;
  attemptId?: string;
  externalId?: string;
  webhookEventId?: string;
  source: 'WEBHOOK' | 'RETURN' | 'RECONCILIATION' | 'MANUAL';
}

/**
 * Tentatives de paiement (Partie 10) : création → initiate hors transaction → PENDING ; confirmation par
 * `verify()` sous `SELECT … FOR UPDATE` ; seul SUCCEEDED crée un paiement (via le grand-livre, UNIQUE(attempt_id)).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly registry: ProviderRegistry,
    private readonly configs: PaymentConfigService,
    private readonly ledger: LedgerService,
    private readonly guardiansSvc: GuardianService,
    private readonly queue: PaymentsQueue,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }
  private get actor() {
    return RequestContextStore.require().actor ?? null;
  }

  // ---------------------------------------------------------------- options (espace parent)
  async options(studentId: string) {
    return this.db.withTenantTx(this.tenantId, async (tx) => {
      const link = await this.guardiansSvc.assertGuardianAccess(studentId, 'finance', tx);
      const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
      const rules = paymentRulesFrom(tenant.settings);
      const config = await this.configs.active(tx);
      const account = await this.ledger.account(studentId);
      const max = Math.max(0, account.totals.balance);
      let reason: string | null = null;
      if (!config) reason = "Le paiement en ligne n'est pas encore activé par l'établissement";
      else if (!link.canPay) reason = "Vous n'avez pas le droit de payer pour cet élève";
      else if (max < rules.minAmount) reason = 'Aucun solde à régler en ligne';
      return {
        enabled: reason === null,
        provider: config?.provider ?? null,
        environment: config?.environment ?? null,
        minAmount: rules.minAmount,
        maxAmount: max,
        reason,
      };
    });
  }

  // ---------------------------------------------------------------- création
  /**
   * Route sans transaction : (1) tx — contrôles, insertion CREATED ; (2) hors tx — `initiate` sous
   * disjoncteur ; (3) tx — PENDING + checkout, ou FAILED(PROVIDER_UNAVAILABLE) → 503.
   */
  async create(studentId: string, input: z.infer<typeof CreatePaymentAttemptSchema>) {
    const tenantId = this.tenantId;
    const prepared = await this.db.withTenantTx(tenantId, async (tx) => {
      const link = await this.guardiansSvc.assertGuardianAccess(studentId, 'pay', tx);
      const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
      const rules = paymentRulesFrom(tenant.settings);
      const config = await this.configs.active(tx);
      if (!config)
        throw new AppError(
          422,
          ErrorCodes.VALIDATION_FAILED,
          "Le paiement en ligne n'est pas activé pour cet établissement",
        );
      const account = await this.ledger.account(studentId);
      const check = validateAmount(input.amount, Math.max(0, account.totals.balance), rules);
      if (!check.ok) throw AppError.validation([{ path: 'amount', message: check.reason }]);
      const open = new Set(
        account.fees.flatMap((f) =>
          (f.installments ?? []).filter((i) => i.balance > 0).map((i) => i.id),
        ),
      );
      for (const id of input.installmentIds)
        if (!open.has(id))
          throw AppError.validation([
            { path: 'installmentIds', message: 'Échéance inconnue ou déjà soldée' },
          ]);
      const g = await tx.query.guardians.findFirst({ where: eq(guardians.id, link.guardianId) });
      const student = (await tx.query.students.findFirst({ where: eq(students.id, studentId) }))!;
      const id = randomUUID();
      const now = new Date();
      await tx.insert(paymentAttempts).values({
        id,
        tenantId,
        studentId,
        guardianId: link.guardianId,
        payerUserId: this.actor?.userId ?? null,
        amount: input.amount,
        currency: 'XOF',
        targetInstallmentIds: input.installmentIds,
        provider: config.provider,
        status: 'CREATED',
        externalId: null,
        checkout: null,
        expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MINUTES * 60_000),
        failureCode: null,
        failureMessage: null,
        verifiedAmount: null,
        fees: null,
        paymentId: null,
        reviewStatus: 'NONE',
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        nextCheckAt: new Date(now.getTime() + 2 * 60_000),
        checkCount: 0,
        traceId: RequestContextStore.require().traceId ?? null,
        metadata: { payerPhone: input.payerPhone ?? g?.phoneE164 ?? null },
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });
      await this.audit.record({
        action: 'payment_attempt.created',
        entityType: 'PaymentAttempt',
        entityId: id,
        after: { studentId, amount: input.amount, provider: config.provider },
      });
      return {
        id,
        config,
        tenant,
        student,
        guardian: g ?? null,
        phone: input.payerPhone ?? g?.phoneE164 ?? null,
      };
    });

    const provider = this.registry.get(prepared.config.provider);
    const creds = this.configs.credentials(prepared.config);
    try {
      const result = await this.registry.guard(tenantId, prepared.config.provider, () =>
        provider.initiate(creds, {
          attemptId: prepared.id,
          amount: input.amount,
          currency: 'XOF',
          description: `${prepared.tenant.name} — frais de ${prepared.student.firstName} ${prepared.student.lastName}`,
          customer: {
            firstName: prepared.guardian?.firstName ?? prepared.student.firstName,
            lastName: prepared.guardian?.lastName ?? prepared.student.lastName,
            email: prepared.guardian?.email ?? null,
            phone: prepared.phone,
          },
          callbackUrl: `${this.env.WEB_ORIGIN}/pay/${prepared.id}/return?s=${studentId}`,
          webhookUrl: this.configs.webhookUrl(
            prepared.config.provider,
            prepared.config.webhookToken,
          ),
        }),
      );
      await this.db.withTenantTx(tenantId, async (tx) => {
        await tx
          .update(paymentAttempts)
          .set({ status: 'PENDING', externalId: result.externalId, checkout: result.checkout })
          .where(eq(paymentAttempts.id, prepared.id));
        if (result.externalId)
          await tx
            .insert(providerTransactions)
            .values({
              id: randomUUID(),
              tenantId,
              attemptId: prepared.id,
              provider: prepared.config.provider,
              externalId: result.externalId,
              providerStatus: null,
              normalizedStatus: 'PENDING',
              amount: null,
              fees: null,
              method: null,
              raw: result.raw ?? null,
              verifyCount: 0,
              lastVerifiedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoNothing();
      });
    } catch (e) {
      const code = e instanceof ProviderError ? e.kind : 'UNAVAILABLE';
      await this.db.withTenantTx(tenantId, async (tx) => {
        await tx
          .update(paymentAttempts)
          .set({
            status: 'FAILED',
            failureCode: 'PROVIDER_UNAVAILABLE',
            failureMessage: FAILURE_MESSAGES['PROVIDER_UNAVAILABLE']!,
            completedAt: new Date(),
            metadata: sql`metadata || ${JSON.stringify({ initiateError: code, detail: (e as Error).message })}::jsonb`,
          })
          .where(eq(paymentAttempts.id, prepared.id));
      });
      this.logger.warn({
        msg: 'payment initiate failed',
        attemptId: prepared.id,
        code,
        err: (e as Error).message,
      });
      if (e instanceof ProviderError && e.kind === 'REJECTED')
        throw new AppError(
          422,
          ErrorCodes.VALIDATION_FAILED,
          `Le provider a refusé la demande : ${e.message}`,
        );
      throw new AppError(
        503,
        ErrorCodes.PROVIDER_UNAVAILABLE,
        FAILURE_MESSAGES['PROVIDER_UNAVAILABLE']!,
      );
    }
    return this.db.withTenantTx(tenantId, (tx) => this.getDto(tx, prepared.id));
  }

  // ---------------------------------------------------------------- confirmation (le cœur)
  /**
   * `ConfirmAttempt` : `verify()` hors transaction, puis en une transaction : FOR UPDATE, sortie si terminal,
   * mise à jour, et si SUCCEEDED (montant vérifié = montant demandé) : paiement + allocations + reçu.
   * Idempotent et sûr en concurrence : deux confirmations → un seul paiement.
   */
  async confirm(input: ConfirmInput): Promise<AttemptRow | null> {
    const { tenantId } = input;
    const located = await this.db.withTenantTx(tenantId, async (tx) => {
      let row: AttemptRow | undefined;
      if (input.attemptId)
        row = await tx.query.paymentAttempts.findFirst({
          where: eq(paymentAttempts.id, input.attemptId),
        });
      if (!row && input.externalId) {
        const t = await tx.query.providerTransactions.findFirst({
          where: eq(providerTransactions.externalId, input.externalId),
        });
        if (t)
          row = await tx.query.paymentAttempts.findFirst({
            where: eq(paymentAttempts.id, t.attemptId),
          });
      }
      if (!row) return null;
      // Identifiant provider appris au retour (widget KKiaPay) : on l'attache une fois pour toutes.
      if (!row.externalId && input.externalId) {
        await tx
          .insert(providerTransactions)
          .values({
            id: randomUUID(),
            tenantId,
            attemptId: row.id,
            provider: row.provider,
            externalId: input.externalId,
            providerStatus: null,
            normalizedStatus: 'PENDING',
            amount: null,
            fees: null,
            method: null,
            raw: null,
            verifyCount: 0,
            lastVerifiedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoNothing();
        await tx
          .update(paymentAttempts)
          .set({ externalId: input.externalId })
          .where(eq(paymentAttempts.id, row.id));
        row = { ...row, externalId: input.externalId };
      }
      const config = await this.configs.byProvider(row.provider, tx);
      return { row, config };
    });
    if (!located) return null;
    const { row, config } = located;
    if (isTerminal(row.status)) return row;
    if (!row.externalId || !config) {
      // Rien à vérifier encore (widget sans retour) : la réconciliation retentera, l'expiration tranchera.
      return this.db.withTenantTx(tenantId, (tx) => this.scheduleNext(tx, row, null));
    }

    const provider = this.registry.get(row.provider);
    let verified: VerifyResult;
    try {
      verified = await this.registry.guard(tenantId, row.provider, () =>
        provider.verify(this.configs.credentials(config), row.externalId!),
      );
    } catch (e) {
      await this.db.withTenantTx(tenantId, (tx) =>
        this.scheduleNext(tx, row, (e as Error).message),
      );
      throw e; // BullMQ retente avec backoff ; la réconciliation reprend ensuite la main.
    }

    return this.db.withTenantTx(tenantId, async (tx) => {
      const locked = (
        await tx.execute<AttemptRow>(
          sql`select * from payment_attempts where id = ${row.id}::uuid for update`,
        )
      ).rows[0];
      const current = (await tx.query.paymentAttempts.findFirst({
        where: eq(paymentAttempts.id, row.id),
      }))!;
      if (!locked || isTerminal(current.status)) return current;
      const now = new Date();
      await tx
        .update(providerTransactions)
        .set({
          providerStatus: verified.providerStatus,
          normalizedStatus: verified.status,
          amount: verified.amount,
          fees: verified.fees,
          method: verified.method,
          raw: verified.raw ?? null,
          verifyCount: sql`verify_count + 1`,
          lastVerifiedAt: now,
        })
        .where(eq(providerTransactions.attemptId, row.id));
      if (input.webhookEventId)
        await tx
          .update(webhookEvents)
          .set({ processedAt: now, attemptId: row.id })
          .where(eq(webhookEvents.id, input.webhookEventId));

      const target = nextStatus(current.status, verified.status, now, current.expiresAt);
      if (target === null) return this.scheduleNext(tx, current, null);

      if (target === 'SUCCEEDED') {
        if (verified.amount !== null && verified.amount !== current.amount) {
          return this.markUnknown(tx, current, 'AMOUNT_MISMATCH', verified);
        }
        const student = (await tx.query.students.findFirst({
          where: eq(students.id, current.studentId),
        }))!;
        const payer = current.payerUserId
          ? await tx.query.users.findFirst({ where: eq(users.id, current.payerUserId) })
          : null;
        const recorded = await this.ledger.recordElectronicPayment(tx, {
          attemptId: current.id,
          studentId: current.studentId,
          amount: current.amount,
          method: verified.method ?? 'MOBILE_MONEY',
          provider: PROVIDER_LABELS[current.provider] ?? current.provider,
          reference: current.externalId,
          payerUserId: current.payerUserId,
          payerName: payer?.displayName ?? `${student.firstName} ${student.lastName}`,
          installmentIds: current.targetInstallmentIds,
        });
        await tx
          .update(paymentAttempts)
          .set({
            status: 'SUCCEEDED',
            verifiedAmount: verified.amount ?? current.amount,
            fees: verified.fees,
            paymentId: recorded.paymentId,
            completedAt: now,
            nextCheckAt: null,
          })
          .where(eq(paymentAttempts.id, current.id));
        await this.audit.record({
          action: 'payment_attempt.succeeded',
          entityType: 'PaymentAttempt',
          entityId: current.id,
          after: {
            source: input.source,
            paymentId: recorded.paymentId,
            receipt: recorded.receiptNumber,
          },
        });
        return (await tx.query.paymentAttempts.findFirst({
          where: eq(paymentAttempts.id, current.id),
        }))!;
      }

      if (target === 'UNKNOWN') return this.markUnknown(tx, current, 'UNKNOWN_STATUS', verified);

      // FAILED | CANCELLED | EXPIRED | PROCESSING
      const failureCode =
        target === 'FAILED'
          ? 'DECLINED'
          : target === 'CANCELLED'
            ? 'CANCELLED'
            : target === 'EXPIRED'
              ? 'EXPIRED'
              : null;
      await tx
        .update(paymentAttempts)
        .set({
          status: target,
          failureCode,
          failureMessage: failureCode ? (FAILURE_MESSAGES[failureCode] ?? null) : null,
          verifiedAmount: verified.amount,
          fees: verified.fees,
          completedAt: isTerminal(target) ? now : null,
          nextCheckAt: isTerminal(target)
            ? null
            : new Date(now.getTime() + nextCheckDelayMs(current.checkCount)),
          checkCount: current.checkCount + 1,
        })
        .where(eq(paymentAttempts.id, current.id));
      if (isTerminal(target)) {
        await this.audit.record({
          action: `payment_attempt.${target.toLowerCase()}`,
          entityType: 'PaymentAttempt',
          entityId: current.id,
          after: { source: input.source, providerStatus: verified.providerStatus },
        });
        await this.outbox.publish(
          paymentAttemptFailed({
            tenantId,
            attemptId: current.id,
            studentId: current.studentId,
            payerUserId: current.payerUserId,
            amount: current.amount,
            status: target as 'FAILED' | 'CANCELLED' | 'EXPIRED',
            failureCode,
          }),
        );
      }
      return (await tx.query.paymentAttempts.findFirst({
        where: eq(paymentAttempts.id, current.id),
      }))!;
    });
  }

  private async scheduleNext(tx: Db, row: AttemptRow, error: string | null) {
    await tx
      .update(paymentAttempts)
      .set({
        status: row.status === 'CREATED' ? 'CREATED' : row.status,
        nextCheckAt: new Date(Date.now() + nextCheckDelayMs(row.checkCount)),
        checkCount: row.checkCount + 1,
        metadata: error
          ? sql`metadata || ${JSON.stringify({ lastVerifyError: error })}::jsonb`
          : row.metadata,
      })
      .where(eq(paymentAttempts.id, row.id));
    return (await tx.query.paymentAttempts.findFirst({ where: eq(paymentAttempts.id, row.id) }))!;
  }

  private async markUnknown(
    tx: Db,
    row: AttemptRow,
    reason: 'AMOUNT_MISMATCH' | 'UNKNOWN_STATUS',
    verified: VerifyResult,
  ) {
    await tx
      .update(paymentAttempts)
      .set({
        status: 'UNKNOWN',
        reviewStatus: 'OPEN',
        failureCode: reason,
        failureMessage: reason === 'AMOUNT_MISMATCH' ? FAILURE_MESSAGES['AMOUNT_MISMATCH']! : null,
        verifiedAmount: verified.amount,
        fees: verified.fees,
        nextCheckAt: null,
      })
      .where(eq(paymentAttempts.id, row.id));
    await this.audit.record({
      action: 'payment_attempt.unknown',
      entityType: 'PaymentAttempt',
      entityId: row.id,
      after: {
        reason,
        providerStatus: verified.providerStatus,
        verifiedAmount: verified.amount,
        expected: row.amount,
      },
    });
    await this.outbox.publish(
      paymentReviewNeeded({
        tenantId: row.tenantId,
        attemptId: row.id,
        reason,
        amount: row.amount,
        externalId: row.externalId,
      }),
    );
    this.logger.warn({ msg: 'payment attempt needs review', attemptId: row.id, reason });
    return (await tx.query.paymentAttempts.findFirst({ where: eq(paymentAttempts.id, row.id) }))!;
  }

  // ---------------------------------------------------------------- lecture
  async getDto(tx: Db, id: string): Promise<AttemptDto> {
    const r = await tx.query.paymentAttempts.findFirst({ where: eq(paymentAttempts.id, id) });
    if (!r) throw AppError.notFound('Tentative de paiement');
    return (await this.dtos(tx, [r]))[0]!;
  }

  async dtos(tx: Db, rows: AttemptRow[]): Promise<AttemptDto[]> {
    if (rows.length === 0) return [];
    const studentIds = [...new Set(rows.map((r) => r.studentId))];
    const paymentIds = rows.map((r) => r.paymentId).filter((x): x is string => Boolean(x));
    const payerIds = [
      ...new Set(rows.map((r) => r.payerUserId).filter((x): x is string => Boolean(x))),
    ];
    const [ss, rs, us] = await Promise.all([
      tx.select().from(students).where(inArray(students.id, studentIds)),
      paymentIds.length
        ? tx
            .select({ paymentId: receipts.paymentId, number: receipts.number })
            .from(receipts)
            .where(and(inArray(receipts.paymentId, paymentIds), eq(receipts.kind, 'PAYMENT')))
        : Promise.resolve([]),
      payerIds.length
        ? tx.select().from(users).where(inArray(users.id, payerIds))
        : Promise.resolve([]),
    ]);
    const sMap = new Map(ss.map((s) => [s.id, s]));
    const rMap = new Map(rs.map((r) => [r.paymentId, r.number]));
    const uMap = new Map(us.map((u) => [u.id, u]));
    return rows.map((r) => {
      const s = sMap.get(r.studentId);
      return {
        id: r.id,
        studentId: r.studentId,
        student: s
          ? { firstName: s.firstName, lastName: s.lastName, matricule: s.matricule }
          : undefined,
        amount: r.amount,
        currency: r.currency,
        provider: r.provider,
        status: r.status,
        checkout: r.checkout ?? null,
        externalId: r.externalId,
        expiresAt: r.expiresAt.toISOString(),
        failureCode: r.failureCode,
        failureMessage: r.failureMessage,
        verifiedAmount: r.verifiedAmount,
        fees: r.fees,
        paymentId: r.paymentId,
        receiptNumber: r.paymentId ? (rMap.get(r.paymentId) ?? null) : null,
        reviewStatus: r.reviewStatus,
        reviewNote: r.reviewNote,
        payerName: r.payerUserId ? (uMap.get(r.payerUserId)?.displayName ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      };
    });
  }

  /** Espace parent : la tentative d'un de ses enfants (droit finance), avec son checkout. */
  async getForGuardian(studentId: string, attemptId: string) {
    const tx = this.db.current();
    await this.guardiansSvc.assertGuardianAccess(studentId, 'finance', tx);
    const r = await tx.query.paymentAttempts.findFirst({
      where: and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.studentId, studentId)),
    });
    if (!r) throw AppError.notFound('Tentative de paiement');
    return (await this.dtos(tx, [r]))[0]!;
  }

  async listForGuardian(studentId: string) {
    const tx = this.db.current();
    await this.guardiansSvc.assertGuardianAccess(studentId, 'finance', tx);
    const rows = await tx
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.studentId, studentId))
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(20);
    return this.dtos(tx, rows);
  }

  /** Retour du parent (callback / widget) : confirmation synchrone, bornée par le délai provider. */
  async confirmFromReturn(studentId: string, attemptId: string, externalId?: string) {
    const tenantId = this.tenantId;
    await this.db.withTenantTx(tenantId, async (tx) => {
      await this.guardiansSvc.assertGuardianAccess(studentId, 'finance', tx);
      const r = await tx.query.paymentAttempts.findFirst({
        where: and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.studentId, studentId)),
      });
      if (!r) throw AppError.notFound('Tentative de paiement');
    });
    try {
      await this.confirm({ tenantId, attemptId, externalId, source: 'RETURN' });
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      // Provider muet : la tentative reste en attente, la file et la réconciliation prennent le relais.
      await this.queue.enqueueConfirm({ tenantId, attemptId, externalId, source: 'RETURN' });
    }
    return this.db.withTenantTx(tenantId, (tx) => this.getDto(tx, attemptId));
  }

  async list(query: z.infer<typeof AttemptsQuerySchema>) {
    const tx = this.db.current();
    const cur = decodeCursor<{ t: string; id: string }>(query.cursor);
    const rows = await tx
      .select()
      .from(paymentAttempts)
      .where(
        and(
          query.status ? eq(paymentAttempts.status, query.status) : undefined,
          query.studentId ? eq(paymentAttempts.studentId, query.studentId) : undefined,
          query.review ? eq(paymentAttempts.reviewStatus, query.review) : undefined,
          query.from
            ? gte(paymentAttempts.createdAt, new Date(`${query.from}T00:00:00Z`))
            : undefined,
          query.to ? lte(paymentAttempts.createdAt, new Date(`${query.to}T23:59:59Z`)) : undefined,
          cur
            ? sql`(${paymentAttempts.createdAt}, ${paymentAttempts.id}) < (${new Date(cur.t)}, ${cur.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(paymentAttempts.createdAt), desc(paymentAttempts.id))
      .limit(query.limit + 1);
    const dtos = await this.dtos(tx, rows);
    return page(dtos, query.limit, (last) => ({ t: last.createdAt, id: last.id }));
  }

  /** Chronologie complète d'une tentative (écran de détail finance) — sans clé ni corps brut provider. */
  async timeline(id: string) {
    const tx = this.db.current();
    const attempt = await this.getDto(tx, id);
    const t = await tx.query.providerTransactions.findFirst({
      where: eq(providerTransactions.attemptId, id),
    });
    const hooks = await tx
      .select()
      .from(webhookEvents)
      .where(
        t
          ? sql`(${webhookEvents.attemptId} = ${id}::uuid or ${webhookEvents.externalTransactionId} = ${t.externalId})`
          : eq(webhookEvents.attemptId, id),
      )
      .orderBy(webhookEvents.receivedAt);
    const payment = attempt.paymentId ? await this.ledger.getPayment(attempt.paymentId) : null;
    const audit = await tx
      .select({ at: auditLogs.occurredAt, action: auditLogs.action, by: users.displayName })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.entityType, 'PaymentAttempt'), eq(auditLogs.entityId, id)))
      .orderBy(auditLogs.occurredAt);
    return {
      attempt,
      providerTransaction: t
        ? {
            externalId: t.externalId,
            providerStatus: t.providerStatus,
            normalizedStatus: t.normalizedStatus,
            amount: t.amount,
            fees: t.fees,
            verifyCount: t.verifyCount,
            lastVerifiedAt: t.lastVerifiedAt?.toISOString() ?? null,
          }
        : null,
      webhooks: hooks.map((h) => ({
        id: h.id,
        receivedAt: h.receivedAt.toISOString(),
        externalEventId: h.externalEventId,
        hintStatus: h.hintStatus,
        signatureValid: h.signatureValid,
        processedAt: h.processedAt?.toISOString() ?? null,
        processingError: h.processingError,
      })),
      payment,
      audit: audit.map((a) => ({ at: a.at.toISOString(), action: a.action, by: a.by })),
    };
  }

  /** « Re-vérifier » depuis l'écran finance : confirmation synchrone, UNKNOWN redevient vérifiable. */
  async reverify(id: string) {
    const tenantId = this.tenantId;
    await this.db.withTenantTx(tenantId, async (tx) => {
      const r = await tx.query.paymentAttempts.findFirst({ where: eq(paymentAttempts.id, id) });
      if (!r) throw AppError.notFound('Tentative de paiement');
      if (r.status === 'UNKNOWN')
        await tx
          .update(paymentAttempts)
          .set({ status: 'PROCESSING', failureCode: null })
          .where(eq(paymentAttempts.id, id));
      await this.audit.record({
        action: 'payment_attempt.reverify',
        entityType: 'PaymentAttempt',
        entityId: id,
      });
    });
    try {
      await this.confirm({ tenantId, attemptId: id, source: 'MANUAL' });
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      throw new AppError(
        503,
        ErrorCodes.PROVIDER_UNAVAILABLE,
        `Provider injoignable : ${e.message}`,
      );
    }
    return this.db.withTenantTx(tenantId, (tx) => this.getDto(tx, id));
  }

  /** « Marquer comme résolu (motif) » : clôture la revue humaine sans toucher au grand-livre. */
  async resolve(id: string, note: string) {
    const tx = this.db.current();
    const r = await tx.query.paymentAttempts.findFirst({ where: eq(paymentAttempts.id, id) });
    if (!r) throw AppError.notFound('Tentative de paiement');
    if (r.reviewStatus !== 'OPEN') throw AppError.conflict('Cette tentative n’est pas en revue');
    await tx
      .update(paymentAttempts)
      .set({
        reviewStatus: 'RESOLVED',
        reviewNote: note,
        reviewedBy: this.actor?.userId ?? null,
        reviewedAt: new Date(),
        status: r.status === 'UNKNOWN' ? 'FAILED' : r.status,
        failureCode: r.status === 'UNKNOWN' ? 'RESOLVED_MANUALLY' : r.failureCode,
        completedAt: r.completedAt ?? new Date(),
      })
      .where(eq(paymentAttempts.id, id));
    await this.audit.record({
      action: 'payment_attempt.resolved',
      entityType: 'PaymentAttempt',
      entityId: id,
      after: { note },
    });
    return this.getDto(tx, id);
  }

  /** Lignes d'attente pour le worker/réconciliation : tentatives à contrôler maintenant. */
  async dueForReconciliation(tx: Db, now: Date, limit = 100) {
    return tx
      .select()
      .from(paymentAttempts)
      .where(
        and(
          inArray(paymentAttempts.status, ['PENDING', 'PROCESSING'] satisfies AttemptStatus[]),
          lte(paymentAttempts.nextCheckAt, now),
        ),
      )
      .orderBy(paymentAttempts.nextCheckAt)
      .limit(limit);
  }

  /** Confirmation sans tenant courant (worker) : enveloppe le tenant. */
  async confirmJob(data: ConfirmInput) {
    return RequestContextStore.run(RequestContextStore.blank({ tenantId: data.tenantId }), () =>
      this.confirm(data),
    );
  }
}
