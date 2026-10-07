import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  AssignFeesSchema,
  AssignStudentFeesSchema,
  CreateAdjustmentSchema,
  PaymentsQuerySchema,
  RecordManualPaymentSchema,
  ReversePaymentSchema,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor, page } from '../../../common/http/cursor';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  academicYears,
  enrollments,
  feeAdjustments,
  feeAssignments,
  feeStructures,
  groups,
  installments,
  ledgerIntegrityChecks,
  levels,
  paymentAllocations,
  payments,
  refunds,
  studentCredits,
  studentFees,
  students,
  tenants,
  users,
} from '../../../database/schema';
import { localDateParts } from '../../academic';
import { AuditService } from '../../audit';
import { OutboxService } from '../../shared';
import {
  feesAssigned,
  ledgerIntegrityMismatch,
  overpaymentRecorded,
  paymentRecorded,
  paymentReversed,
} from '../domain/events';
import {
  billingRulesFrom,
  feeStatus,
  installmentStatus,
  planAllocation,
  type BillingRules,
} from '../domain/ledger';
import { CatalogService } from './catalog.service';
import { ReceiptService } from './receipt.service';

type Installment = typeof installments.$inferSelect;

/**
 * Sous-grand-livre de créances (ADR-0005) : affectation, ajustements, allocation des paiements,
 * annulation compensatoire, crédits, recalcul des agrégats dans la transaction, contrôle d'intégrité.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly catalog: CatalogService,
    private readonly receipts: ReceiptService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }
  private get userId() {
    return RequestContextStore.require().actor?.userId ?? null;
  }

  async tenant(tx: Db) {
    const t = await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) });
    if (!t) throw AppError.notFound('Établissement');
    return t;
  }
  async rules(tx: Db): Promise<BillingRules> {
    return billingRulesFrom((await this.tenant(tx)).settings);
  }
  async today(tx: Db) {
    return localDateParts(new Date(), (await this.tenant(tx)).timezone).date;
  }

  // ---------------------------------------------------------------- affectation
  /** Affectation de masse : résout la cible en élèves inscrits (classe principale active à la date), crée les créances manquantes. */
  async assign(input: z.infer<typeof AssignFeesSchema>) {
    const tx = this.db.current();
    const structure = await this.catalog.getStructure(input.feeStructureId, tx);
    if (structure.status !== 'ACTIVE') throw AppError.conflict('Grille archivée');
    const asOf = input.asOf ?? (await this.today(tx));
    const target = input.target;
    const groupIds = new Set<string>(target.groupIds);
    const levelIds = new Set<string>(target.levelIds);
    const programIds = new Set<string>();
    if (
      target.useStructureTarget &&
      target.groupIds.length === 0 &&
      target.levelIds.length === 0 &&
      target.studentIds.length === 0
    ) {
      for (const g of structure.appliesTo.groupIds) groupIds.add(g);
      for (const l of structure.appliesTo.levelIds) levelIds.add(l);
      for (const p of structure.appliesTo.programIds) programIds.add(p);
    }
    let studentIds = new Set<string>(target.studentIds);
    if (groupIds.size || levelIds.size || programIds.size) {
      const rows = await tx
        .select({ studentId: enrollments.studentId })
        .from(enrollments)
        .innerJoin(groups, eq(groups.id, enrollments.groupId))
        .innerJoin(levels, eq(levels.id, groups.levelId))
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(
          and(
            eq(enrollments.academicYearId, structure.academicYearId),
            eq(enrollments.isPrimary, true),
            lte(enrollments.enrolledAt, asOf),
            or(isNull(enrollments.leftAt), gte(enrollments.leftAt, asOf)),
            isNull(students.deletedAt),
            eq(students.status, 'ACTIVE'),
            or(
              groupIds.size ? inArray(groups.id, [...groupIds]) : sql`false`,
              levelIds.size ? inArray(groups.levelId, [...levelIds]) : sql`false`,
              programIds.size ? inArray(levels.programId, [...programIds]) : sql`false`,
            ),
          ),
        );
      for (const r of rows) studentIds.add(r.studentId);
    }
    if (target.studentIds.length) {
      const known = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(inArray(students.id, target.studentIds), isNull(students.deletedAt)));
      studentIds = new Set(
        [...studentIds].filter(
          (id) => !target.studentIds.includes(id) || known.some((k) => k.id === id),
        ),
      );
    }
    const ids = [...studentIds];
    const assignmentId = randomUUID();
    await tx.insert(feeAssignments).values({
      id: assignmentId,
      tenantId: this.tenantId,
      feeStructureId: structure.id,
      target: { ...target, asOf, resolved: ids.length },
      targetedCount: ids.length,
      createdCount: 0,
      skippedCount: 0,
      createdBy: this.userId,
      createdAt: new Date(),
    });
    let created = 0;
    let creditsApplied = 0;
    const existing = ids.length
      ? await tx
          .select({ studentId: studentFees.studentId })
          .from(studentFees)
          .where(
            and(eq(studentFees.feeStructureId, structure.id), inArray(studentFees.studentId, ids)),
          )
      : [];
    const has = new Set(existing.map((e) => e.studentId));
    for (const studentId of ids) {
      if (has.has(studentId)) continue;
      await this.createFee(tx, studentId, structure, assignmentId);
      created++;
      creditsApplied += await this.applyCredits(tx, studentId);
    }
    await tx
      .update(feeAssignments)
      .set({ createdCount: created, skippedCount: ids.length - created })
      .where(eq(feeAssignments.id, assignmentId));
    await this.audit.record({
      action: 'fees.assigned',
      entityType: 'FeeAssignment',
      entityId: assignmentId,
      after: { feeStructureId: structure.id, targeted: ids.length, created },
    });
    if (created > 0)
      await this.outbox.publish(
        feesAssigned({
          tenantId: this.tenantId,
          assignmentId,
          feeStructureId: structure.id,
          created,
        }),
      );
    return {
      assignmentId,
      feeStructureId: structure.id,
      targeted: ids.length,
      created,
      skipped: ids.length - created,
      creditsApplied,
    };
  }

  /** Affectation ciblée (nouvel inscrit) : les grilles choisies par la scolarité. */
  async assignToStudent(studentId: string, input: z.infer<typeof AssignStudentFeesSchema>) {
    const tx = this.db.current();
    await this.assertStudent(tx, studentId);
    let created = 0;
    for (const sid of input.feeStructureIds) {
      const structure = await this.catalog.getStructure(sid, tx);
      const exists = await tx.query.studentFees.findFirst({
        where: and(eq(studentFees.studentId, studentId), eq(studentFees.feeStructureId, sid)),
      });
      if (exists) continue;
      await this.createFee(tx, studentId, structure, null);
      created++;
    }
    await this.applyCredits(tx, studentId);
    await this.audit.record({
      action: 'fees.assigned_to_student',
      entityType: 'Student',
      entityId: studentId,
      after: { feeStructureIds: input.feeStructureIds, created },
    });
    return this.account(studentId);
  }

  private async createFee(
    tx: Db,
    studentId: string,
    structure: Awaited<ReturnType<CatalogService['getStructure']>>,
    assignmentId: string | null,
  ) {
    const feeId = randomUUID();
    const today = await this.today(tx);
    const rules = await this.rules(tx);
    await tx.insert(studentFees).values({
      id: feeId,
      tenantId: this.tenantId,
      studentId,
      feeStructureId: structure.id,
      academicYearId: structure.academicYearId,
      assignmentId,
      totalAmount: structure.totalAmount,
      adjustmentsTotal: 0,
      amountAllocated: 0,
      status: 'OPEN',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await tx.insert(installments).values(
      structure.schedule.map((s) => ({
        id: randomUUID(),
        tenantId: this.tenantId,
        studentFeeId: feeId,
        studentId,
        seq: s.seq,
        label: s.label,
        amountDue: s.amount,
        adjustmentsTotal: 0,
        amountAllocated: 0,
        dueDate: s.dueDate,
        status: installmentStatus(
          { amountDue: s.amount, adjustmentsTotal: 0, amountAllocated: 0, dueDate: s.dueDate },
          today,
          rules,
        ),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
    return feeId;
  }

  // ---------------------------------------------------------------- recalcul (source de vérité : allocations + ajustements)
  /** Recalcule montants alloués, ajustements et statuts des échéances et créances données, dans la transaction. */
  async recompute(tx: Db, feeIds: string[]) {
    if (feeIds.length === 0) return;
    const today = await this.today(tx);
    const rules = await this.rules(tx);
    const insts = await tx
      .select()
      .from(installments)
      .where(inArray(installments.studentFeeId, feeIds));
    const instIds = insts.map((i) => i.id);
    const alloc = instIds.length
      ? await tx
          .select({
            id: paymentAllocations.installmentId,
            sum: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::bigint`,
          })
          .from(paymentAllocations)
          .where(inArray(paymentAllocations.installmentId, instIds))
          .groupBy(paymentAllocations.installmentId)
      : [];
    const adj = await tx
      .select({
        feeId: feeAdjustments.studentFeeId,
        instId: feeAdjustments.installmentId,
        sum: sql<number>`coalesce(sum(${feeAdjustments.amount}), 0)::bigint`,
      })
      .from(feeAdjustments)
      .where(inArray(feeAdjustments.studentFeeId, feeIds))
      .groupBy(feeAdjustments.studentFeeId, feeAdjustments.installmentId);
    const allocBy = new Map(alloc.map((a) => [a.id, Number(a.sum)]));
    const adjByInst = new Map<string, number>();
    const adjFeeOnly = new Map<string, number>();
    for (const a of adj) {
      if (a.instId) adjByInst.set(a.instId, Number(a.sum));
      else adjFeeOnly.set(a.feeId, (adjFeeOnly.get(a.feeId) ?? 0) + Number(a.sum));
    }
    const byFee = new Map<string, Installment[]>();
    for (const i of insts) byFee.set(i.studentFeeId, [...(byFee.get(i.studentFeeId) ?? []), i]);
    for (const feeId of feeIds) {
      const list = (byFee.get(feeId) ?? []).sort((a, b) => a.seq - b.seq);
      // Un ajustement sans échéance s'impute sur la dernière échéance ouverte (ou la dernière).
      const feeLevel = adjFeeOnly.get(feeId) ?? 0;
      const target =
        [...list].reverse().find((i) => (allocBy.get(i.id) ?? 0) < i.amountDue) ??
        list[list.length - 1];
      const statuses: ReturnType<typeof installmentStatus>[] = [];
      let totalAllocated = 0;
      let totalAdj = 0;
      for (const i of list) {
        const allocated = allocBy.get(i.id) ?? 0;
        const adjustments =
          (adjByInst.get(i.id) ?? 0) + (target && target.id === i.id ? feeLevel : 0);
        const status = installmentStatus(
          {
            amountDue: i.amountDue,
            adjustmentsTotal: adjustments,
            amountAllocated: allocated,
            dueDate: i.dueDate,
          },
          today,
          rules,
        );
        statuses.push(status);
        totalAllocated += allocated;
        totalAdj += adjustments;
        if (
          allocated !== i.amountAllocated ||
          adjustments !== i.adjustmentsTotal ||
          status !== i.status
        )
          await tx
            .update(installments)
            .set({ amountAllocated: allocated, adjustmentsTotal: adjustments, status })
            .where(eq(installments.id, i.id));
      }
      const fee = (await tx.query.studentFees.findFirst({ where: eq(studentFees.id, feeId) }))!;
      const st = feeStatus(statuses, fee.totalAmount + totalAdj, totalAllocated);
      if (
        fee.amountAllocated !== totalAllocated ||
        fee.adjustmentsTotal !== totalAdj ||
        fee.status !== st
      )
        await tx
          .update(studentFees)
          .set({ amountAllocated: totalAllocated, adjustmentsTotal: totalAdj, status: st })
          .where(eq(studentFees.id, feeId));
    }
  }

  /** Rafraîchit les statuts temporels (DUE/OVERDUE) des échéances ouvertes d'un tenant (cron quotidien). */
  async refreshDueStatuses(tx: Db) {
    const today = await this.today(tx);
    const rules = await this.rules(tx);
    const open = await tx
      .select()
      .from(installments)
      .where(inArray(installments.status, ['PENDING', 'DUE', 'OVERDUE']));
    let changed = 0;
    for (const i of open) {
      const s = installmentStatus(i, today, rules);
      if (s !== i.status) {
        await tx.update(installments).set({ status: s }).where(eq(installments.id, i.id));
        changed++;
      }
    }
    return changed;
  }

  // ---------------------------------------------------------------- ajustements
  async adjust(input: z.infer<typeof CreateAdjustmentSchema>) {
    const tx = this.db.current();
    const fee = await tx.query.studentFees.findFirst({
      where: eq(studentFees.id, input.studentFeeId),
    });
    if (!fee) throw AppError.notFound('Créance');
    if (input.installmentId) {
      const inst = await tx.query.installments.findFirst({
        where: and(eq(installments.id, input.installmentId), eq(installments.studentFeeId, fee.id)),
      });
      if (!inst)
        throw AppError.validation([
          { path: 'installmentId', message: 'Échéance inconnue pour cette créance' },
        ]);
      if (inst.amountDue + inst.adjustmentsTotal + input.amount < inst.amountAllocated)
        throw AppError.validation([
          { path: 'amount', message: "L'ajustement ferait passer le dû sous le montant déjà payé" },
        ]);
    } else if (fee.totalAmount + fee.adjustmentsTotal + input.amount < fee.amountAllocated) {
      throw AppError.validation([
        { path: 'amount', message: "L'ajustement ferait passer le dû sous le montant déjà payé" },
      ]);
    }
    const id = randomUUID();
    await tx.insert(feeAdjustments).values({
      id,
      tenantId: this.tenantId,
      studentFeeId: fee.id,
      installmentId: input.installmentId ?? null,
      amount: input.amount,
      kind: input.kind,
      reason: input.reason.trim(),
      createdBy: this.userId,
      createdAt: new Date(),
    });
    await this.recompute(tx, [fee.id]);
    await this.applyCredits(tx, fee.studentId);
    await this.audit.record({
      action: 'fee.adjusted',
      entityType: 'StudentFee',
      entityId: fee.id,
      after: input,
    });
    return this.account(fee.studentId);
  }

  // ---------------------------------------------------------------- paiements manuels
  async recordManual(studentId: string, input: z.infer<typeof RecordManualPaymentSchema>) {
    const tx = this.db.current();
    await this.assertStudent(tx, studentId);
    const paymentId = randomUUID();
    const valueDate = input.valueDate ?? (await this.today(tx));
    await tx.insert(payments).values({
      id: paymentId,
      tenantId: this.tenantId,
      studentId,
      amount: input.amount,
      currency: 'XOF',
      source: 'MANUAL',
      method: input.method,
      status: 'COMPLETED',
      payerName: input.payerName?.trim() || null,
      payerUserId: null,
      valueDate,
      reference: input.reference?.trim() || null,
      comment: input.comment?.trim() || null,
      attemptId: null,
      recordedBy: this.userId,
      reversedAt: null,
      reversedBy: null,
      reversalReason: null,
      createdAt: new Date(),
    });
    const { allocated, credit, creditId } = await this.allocate(
      tx,
      paymentId,
      studentId,
      input.amount,
      input.installmentIds,
    );
    const receipt = await this.receipts.issue(tx, paymentId, 'PAYMENT');
    await this.audit.record({
      action: 'payment.recorded',
      entityType: 'Payment',
      entityId: paymentId,
      after: {
        studentId,
        amount: input.amount,
        method: input.method,
        allocated,
        credit,
        receipt: receipt.number,
      },
    });
    await this.outbox.publish(
      paymentRecorded({
        tenantId: this.tenantId,
        paymentId,
        studentId,
        amount: input.amount,
        currency: 'XOF',
        method: input.method,
        receiptNumber: receipt.number,
        allocated,
        credit,
      }),
    );
    if (creditId)
      await this.outbox.publish(
        overpaymentRecorded({
          tenantId: this.tenantId,
          creditId,
          paymentId,
          studentId,
          amount: credit,
        }),
      );
    return this.getPayment(paymentId);
  }

  /**
   * Allocation sous verrou : échéances ouvertes de l'élève `FOR UPDATE`, plan (ciblées d'abord, puis les plus
   * anciennes), lignes d'allocation, recalcul ; le reliquat devient un crédit.
   */
  async allocate(
    tx: Db,
    paymentId: string,
    studentId: string,
    amount: number,
    targetedIds: string[] = [],
  ) {
    await tx.execute(
      sql`select 1 from installments where student_id = ${studentId}::uuid and status not in ('PAID','CANCELLED') for update`,
    );
    const open = await tx
      .select()
      .from(installments)
      .where(
        and(
          eq(installments.studentId, studentId),
          inArray(installments.status, ['PENDING', 'DUE', 'OVERDUE', 'PARTIALLY_PAID']),
        ),
      );
    const plan = planAllocation(amount, open, targetedIds);
    if (plan.lines.length)
      await tx.insert(paymentAllocations).values(
        plan.lines.map((l) => ({
          id: randomUUID(),
          tenantId: this.tenantId,
          paymentId,
          installmentId: l.installmentId,
          amount: l.amount,
          refundId: null,
          creditId: null,
          createdAt: new Date(),
        })),
      );
    let creditId: string | null = null;
    if (plan.remainder > 0) {
      creditId = randomUUID();
      await tx.insert(studentCredits).values({
        id: creditId,
        tenantId: this.tenantId,
        studentId,
        paymentId,
        amount: plan.remainder,
        remaining: plan.remainder,
        status: 'OPEN',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await this.recompute(tx, [
      ...new Set(
        open
          .filter((i) => plan.lines.some((l) => l.installmentId === i.id))
          .map((i) => i.studentFeeId),
      ),
    ]);
    return { allocated: amount - plan.remainder, credit: plan.remainder, creditId };
  }

  /** Applique les crédits ouverts d'un élève aux échéances ouvertes (après une nouvelle créance ou un ajustement). */
  async applyCredits(tx: Db, studentId: string) {
    const credits = await tx
      .select()
      .from(studentCredits)
      .where(and(eq(studentCredits.studentId, studentId), eq(studentCredits.status, 'OPEN')))
      .orderBy(asc(studentCredits.createdAt));
    let applied = 0;
    for (const c of credits) {
      const open = await tx
        .select()
        .from(installments)
        .where(
          and(
            eq(installments.studentId, studentId),
            inArray(installments.status, ['PENDING', 'DUE', 'OVERDUE', 'PARTIALLY_PAID']),
          ),
        );
      const plan = planAllocation(c.remaining, open);
      if (plan.lines.length === 0) continue;
      await tx.insert(paymentAllocations).values(
        plan.lines.map((l) => ({
          id: randomUUID(),
          tenantId: this.tenantId,
          paymentId: c.paymentId,
          installmentId: l.installmentId,
          amount: l.amount,
          refundId: null,
          creditId: c.id,
          createdAt: new Date(),
        })),
      );
      const used = c.remaining - plan.remainder;
      await tx
        .update(studentCredits)
        .set({ remaining: plan.remainder, status: plan.remainder === 0 ? 'APPLIED' : 'OPEN' })
        .where(eq(studentCredits.id, c.id));
      await this.recompute(tx, [
        ...new Set(
          open
            .filter((i) => plan.lines.some((l) => l.installmentId === i.id))
            .map((i) => i.studentFeeId),
        ),
      ]);
      applied += used;
    }
    return applied;
  }

  /** Annulation compensatoire : le paiement passe REVERSED, ses allocations sont contre-passées, un reçu d'annulation est émis. */
  async reverse(paymentId: string, input: z.infer<typeof ReversePaymentSchema>) {
    const tx = this.db.current();
    const p = await tx.query.payments.findFirst({ where: eq(payments.id, paymentId) });
    if (!p) throw AppError.notFound('Paiement');
    if (p.status === 'REVERSED') throw AppError.conflict('Paiement déjà annulé');
    const refundId = randomUUID();
    await tx.insert(refunds).values({
      id: refundId,
      tenantId: this.tenantId,
      paymentId,
      kind: 'INTERNAL_REVERSAL',
      amount: p.amount,
      reason: input.reason.trim(),
      createdBy: this.userId,
      createdAt: new Date(),
    });
    const lines = await tx
      .select({
        installmentId: paymentAllocations.installmentId,
        sum: sql<number>`sum(${paymentAllocations.amount})::bigint`,
      })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId))
      .groupBy(paymentAllocations.installmentId);
    const reversals = lines.filter((l) => Number(l.sum) > 0);
    if (reversals.length)
      await tx.insert(paymentAllocations).values(
        reversals.map((l) => ({
          id: randomUUID(),
          tenantId: this.tenantId,
          paymentId,
          installmentId: l.installmentId,
          amount: -Number(l.sum),
          refundId,
          creditId: null,
          createdAt: new Date(),
        })),
      );
    await tx
      .update(studentCredits)
      .set({ remaining: 0, status: 'REFUNDED' })
      .where(and(eq(studentCredits.paymentId, paymentId), ne(studentCredits.status, 'REFUNDED')));
    await tx
      .update(payments)
      .set({
        status: 'REVERSED',
        reversedAt: new Date(),
        reversedBy: this.userId,
        reversalReason: input.reason.trim(),
      })
      .where(eq(payments.id, paymentId));
    const feeIds = reversals.length
      ? (
          await tx
            .select({ id: installments.studentFeeId })
            .from(installments)
            .where(
              inArray(
                installments.id,
                reversals.map((r) => r.installmentId),
              ),
            )
        ).map((r) => r.id)
      : [];
    await this.recompute(tx, [...new Set(feeIds)]);
    const receipt = await this.receipts.issue(tx, paymentId, 'CANCELLATION');
    await this.audit.record({
      action: 'payment.reversed',
      entityType: 'Payment',
      entityId: paymentId,
      after: { reason: input.reason, amount: p.amount, receipt: receipt.number },
    });
    await this.outbox.publish(
      paymentReversed({
        tenantId: this.tenantId,
        paymentId,
        studentId: p.studentId,
        amount: p.amount,
        reason: input.reason,
        receiptNumber: receipt.number,
      }),
    );
    return this.getPayment(paymentId);
  }

  // ---------------------------------------------------------------- lectures
  async account(studentId: string) {
    const tx = this.db.current();
    const student = await this.assertStudent(tx, studentId);
    const today = await this.today(tx);
    const rules = await this.rules(tx);
    const fees = await tx
      .select({
        f: studentFees,
        feeName: feeStructures.name,
        categoryName: sql<
          string | null
        >`(select c.name from fee_categories c where c.id = ${feeStructures.categoryId})`,
      })
      .from(studentFees)
      .innerJoin(feeStructures, eq(feeStructures.id, studentFees.feeStructureId))
      .where(eq(studentFees.studentId, studentId))
      .orderBy(asc(studentFees.createdAt));
    const insts = fees.length
      ? await tx
          .select()
          .from(installments)
          .where(
            inArray(
              installments.studentFeeId,
              fees.map((f) => f.f.id),
            ),
          )
          .orderBy(asc(installments.dueDate), asc(installments.seq))
      : [];
    const pays = await this.paymentsOf(tx, { studentId });
    const credits = await tx
      .select()
      .from(studentCredits)
      .where(eq(studentCredits.studentId, studentId))
      .orderBy(desc(studentCredits.createdAt));
    const adjs = await tx
      .select({ a: feeAdjustments, by: users.displayName })
      .from(feeAdjustments)
      .leftJoin(users, eq(users.id, feeAdjustments.createdBy))
      .where(
        inArray(
          feeAdjustments.studentFeeId,
          fees.length ? fees.map((f) => f.f.id) : ['00000000-0000-0000-0000-000000000000'],
        ),
      )
      .orderBy(desc(feeAdjustments.createdAt));
    const feeDtos = fees.map((f) =>
      this.feeDto(
        f.f,
        f.feeName,
        f.categoryName,
        insts.filter((i) => i.studentFeeId === f.f.id),
      ),
    );
    const due = feeDtos.reduce((s, f) => s + Math.max(0, f.totalAmount + f.adjustmentsTotal), 0);
    const paid = feeDtos.reduce((s, f) => s + f.amountAllocated, 0);
    const openInst = insts.filter((i) => i.status !== 'PAID' && i.status !== 'CANCELLED');
    const dueNow = openInst
      .filter((i) => i.dueDate <= today)
      .reduce((s, i) => s + Math.max(0, i.amountDue + i.adjustmentsTotal - i.amountAllocated), 0);
    const overdue = openInst
      .filter((i) => installmentStatus(i, today, rules) === 'OVERDUE')
      .reduce((s, i) => s + Math.max(0, i.amountDue + i.adjustmentsTotal - i.amountAllocated), 0);
    return {
      student,
      totals: {
        due,
        paid,
        balance: due - paid,
        dueNow,
        overdue,
        credit: credits.filter((c) => c.status === 'OPEN').reduce((s, c) => s + c.remaining, 0),
      },
      fees: feeDtos,
      payments: pays,
      credits: credits.map((c) => ({
        id: c.id,
        paymentId: c.paymentId,
        amount: c.amount,
        remaining: c.remaining,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
      adjustments: adjs.map(({ a, by }) => ({
        id: a.id,
        studentFeeId: a.studentFeeId,
        installmentId: a.installmentId,
        amount: a.amount,
        kind: a.kind,
        reason: a.reason,
        createdByName: by,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  async listPayments(query: z.infer<typeof PaymentsQuerySchema>) {
    const tx = this.db.current();
    const cur = decodeCursor<{ t: string; id: string }>(query.cursor);
    const rows = await tx
      .select({
        p: payments,
        s: students,
        by: users.displayName,
        receiptNumber: sql<
          string | null
        >`(select r.number from receipts r where r.payment_id = ${payments.id} and r.kind = 'PAYMENT')`,
      })
      .from(payments)
      .innerJoin(students, eq(students.id, payments.studentId))
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(
        and(
          query.studentId ? eq(payments.studentId, query.studentId) : undefined,
          query.from ? gte(payments.valueDate, query.from) : undefined,
          query.to ? lte(payments.valueDate, query.to) : undefined,
          query.method ? eq(payments.method, query.method) : undefined,
          query.source ? eq(payments.source, query.source) : undefined,
          query.status ? eq(payments.status, query.status) : undefined,
          query.recordedBy ? eq(payments.recordedBy, query.recordedBy) : undefined,
          query.mine && this.userId ? eq(payments.recordedBy, this.userId) : undefined,
          cur
            ? sql`(${payments.createdAt}, ${payments.id}) < (${new Date(cur.t)}, ${cur.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(query.limit + 1);
    return page(
      rows.map((r) => ({
        ...this.paymentDto(r.p, r.by, r.receiptNumber),
        student: { firstName: r.s.firstName, lastName: r.s.lastName, matricule: r.s.matricule },
      })),
      query.limit,
      (last) => ({ t: last.createdAt, id: last.id }),
    );
  }

  async getPayment(id: string) {
    const tx = this.db.current();
    const list = await this.paymentsOf(tx, { id });
    const p = list[0];
    if (!p) throw AppError.notFound('Paiement');
    return p;
  }

  private async paymentsOf(tx: Db, by: { studentId?: string; id?: string }) {
    const rows = await tx
      .select({
        p: payments,
        s: students,
        by: users.displayName,
        receiptNumber: sql<
          string | null
        >`(select r.number from receipts r where r.payment_id = ${payments.id} and r.kind = 'PAYMENT')`,
      })
      .from(payments)
      .innerJoin(students, eq(students.id, payments.studentId))
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(
        and(
          by.studentId ? eq(payments.studentId, by.studentId) : undefined,
          by.id ? eq(payments.id, by.id) : undefined,
        ),
      )
      .orderBy(desc(payments.createdAt));
    if (rows.length === 0) return [];
    const allocs = await tx
      .select({ a: paymentAllocations, label: installments.label, feeName: feeStructures.name })
      .from(paymentAllocations)
      .innerJoin(installments, eq(installments.id, paymentAllocations.installmentId))
      .innerJoin(studentFees, eq(studentFees.id, installments.studentFeeId))
      .innerJoin(feeStructures, eq(feeStructures.id, studentFees.feeStructureId))
      .where(
        inArray(
          paymentAllocations.paymentId,
          rows.map((r) => r.p.id),
        ),
      )
      .orderBy(asc(paymentAllocations.createdAt));
    const credits = await tx
      .select()
      .from(studentCredits)
      .where(
        inArray(
          studentCredits.paymentId,
          rows.map((r) => r.p.id),
        ),
      );
    return rows.map((r) => {
      const mine = allocs.filter((a) => a.a.paymentId === r.p.id);
      return {
        ...this.paymentDto(r.p, r.by, r.receiptNumber),
        student: { firstName: r.s.firstName, lastName: r.s.lastName, matricule: r.s.matricule },
        allocatedAmount: mine.reduce((s, a) => s + Math.max(0, a.a.amount), 0),
        creditAmount: credits
          .filter((c) => c.paymentId === r.p.id)
          .reduce((s, c) => s + c.amount, 0),
        allocations: mine.map((a) => ({
          installmentId: a.a.installmentId,
          label: a.label,
          feeName: a.feeName,
          amount: a.a.amount,
        })),
      };
    });
  }

  // ---------------------------------------------------------------- intégrité
  /** Égalité stocké = recalculé pour toutes les créances du tenant courant ; journalise et alerte. */
  async integrityCheck() {
    const tx = this.db.current();
    const stored = await tx
      .select({
        id: installments.id,
        feeId: installments.studentFeeId,
        allocated: installments.amountAllocated,
        adj: installments.adjustmentsTotal,
        status: installments.status,
      })
      .from(installments);
    const feesStored = await tx
      .select({
        id: studentFees.id,
        allocated: studentFees.amountAllocated,
        adj: studentFees.adjustmentsTotal,
        status: studentFees.status,
      })
      .from(studentFees);
    const before = new Map(stored.map((s) => [s.id, s]));
    const feesBefore = new Map(feesStored.map((f) => [f.id, f]));
    await this.recompute(
      tx,
      feesStored.map((f) => f.id),
    );
    const after = await tx
      .select({
        id: installments.id,
        allocated: installments.amountAllocated,
        adj: installments.adjustmentsTotal,
        status: installments.status,
      })
      .from(installments);
    const feesAfter = await tx
      .select({
        id: studentFees.id,
        allocated: studentFees.amountAllocated,
        adj: studentFees.adjustmentsTotal,
        status: studentFees.status,
      })
      .from(studentFees);
    const details: unknown[] = [];
    for (const a of after) {
      const b = before.get(a.id);
      if (b && (b.allocated !== a.allocated || b.adj !== a.adj || b.status !== a.status))
        details.push({ installmentId: a.id, before: b, after: a });
    }
    for (const a of feesAfter) {
      const b = feesBefore.get(a.id);
      if (b && (b.allocated !== a.allocated || b.adj !== a.adj || b.status !== a.status))
        details.push({ studentFeeId: a.id, before: b, after: a });
    }
    // Invariants d'allocation : Σ allocations d'un paiement ≤ montant ; aucune échéance sur-allouée.
    const over = await tx.execute<{ payment_id: string; total: string; amount: string }>(sql`
      select p.id as payment_id, coalesce(sum(a.amount),0) as total, p.amount from payments p
      left join payment_allocations a on a.payment_id = p.id group by p.id, p.amount having coalesce(sum(a.amount),0) > p.amount or coalesce(sum(a.amount),0) < 0`);
    for (const r of over.rows)
      details.push({
        paymentId: r.payment_id,
        allocated: Number(r.total),
        amount: Number(r.amount),
      });
    const id = randomUUID();
    await tx.insert(ledgerIntegrityChecks).values({
      id,
      tenantId: this.tenantId,
      checkedAt: new Date(),
      mismatches: details.length,
      details,
    });
    if (details.length)
      await this.outbox.publish(
        ledgerIntegrityMismatch({
          tenantId: this.tenantId,
          checkId: id,
          mismatches: details.length,
        }),
      );
    return { checkId: id, mismatches: details.length, details };
  }

  // ---------------------------------------------------------------- helpers
  async assertStudent(tx: Db, studentId: string) {
    const s = await tx.query.students.findFirst({
      where: and(eq(students.id, studentId), isNull(students.deletedAt)),
    });
    if (!s) throw AppError.notFound('Élève');
    const year = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    const g = year
      ? await tx
          .select({ name: groups.name })
          .from(enrollments)
          .innerJoin(groups, eq(groups.id, enrollments.groupId))
          .where(
            and(
              eq(enrollments.studentId, studentId),
              eq(enrollments.academicYearId, year.id),
              eq(enrollments.isPrimary, true),
              isNull(enrollments.leftAt),
            ),
          )
          .limit(1)
      : [];
    return {
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      matricule: s.matricule,
      groupName: g[0]?.name ?? null,
    };
  }

  feeDto(
    f: typeof studentFees.$inferSelect,
    feeName: string,
    categoryName: string | null,
    insts: Installment[],
  ) {
    return {
      id: f.id,
      studentId: f.studentId,
      feeStructureId: f.feeStructureId,
      feeName,
      categoryName,
      academicYearId: f.academicYearId,
      totalAmount: f.totalAmount,
      adjustmentsTotal: f.adjustmentsTotal,
      amountAllocated: f.amountAllocated,
      balance: f.totalAmount + f.adjustmentsTotal - f.amountAllocated,
      status: f.status,
      installments: insts.map((i) => this.installmentDto(i, feeName)),
      createdAt: f.createdAt.toISOString(),
    };
  }
  installmentDto(i: Installment, feeName?: string) {
    return {
      id: i.id,
      studentFeeId: i.studentFeeId,
      seq: i.seq,
      label: i.label,
      amountDue: i.amountDue,
      adjustmentsTotal: i.adjustmentsTotal,
      amountAllocated: i.amountAllocated,
      balance: i.amountDue + i.adjustmentsTotal - i.amountAllocated,
      dueDate: i.dueDate,
      status: i.status,
      feeName,
    };
  }
  paymentDto(
    p: typeof payments.$inferSelect,
    recordedByName: string | null,
    receiptNumber: string | null,
  ) {
    return {
      id: p.id,
      studentId: p.studentId,
      amount: p.amount,
      currency: p.currency,
      source: p.source,
      method: p.method,
      status: p.status,
      payerName: p.payerName,
      valueDate: p.valueDate,
      reference: p.reference,
      comment: p.comment,
      recordedByName,
      receiptNumber,
      reversedAt: p.reversedAt?.toISOString() ?? null,
      reversalReason: p.reversalReason,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
