import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  CreateFeeCategorySchema,
  CreateFeeStructureSchema,
  FeeStructuresQuerySchema,
  UpdateFeeCategorySchema,
  UpdateFeeStructureSchema,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  feeCategories,
  feeScheduleItems,
  feeStructures,
  studentFees,
} from '../../../database/schema';
import { StructureService } from '../../academic';
import { AuditService } from '../../audit';

const uniqueViolation = (e: unknown) => (e as { code?: string }).code === '23505';

/** Catalogue de frais : catégories et grilles (échéancier type). Les créances copient la grille et restent figées. */
@Injectable()
export class CatalogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  // ---------------------------------------------------------------- catégories
  async listCategories() {
    const tx = this.db.current();
    const rows = await tx
      .select({
        c: feeCategories,
        structureCount: sql<number>`(select count(*)::int from fee_structures s where s.category_id = ${feeCategories.id} and s.deleted_at is null)`,
      })
      .from(feeCategories)
      .where(isNull(feeCategories.deletedAt))
      .orderBy(asc(feeCategories.name));
    return rows.map((r) => ({
      id: r.c.id,
      code: r.c.code,
      name: r.c.name,
      structureCount: r.structureCount,
    }));
  }

  async createCategory(input: z.infer<typeof CreateFeeCategorySchema>) {
    const tx = this.db.current();
    const id = randomUUID();
    try {
      await tx.insert(feeCategories).values({
        id,
        tenantId: this.tenantId,
        code: input.code,
        name: input.name.trim(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      if (uniqueViolation(e)) throw AppError.conflict(`La catégorie « ${input.code} » existe déjà`);
      throw e;
    }
    await this.audit.record({
      action: 'fee_category.created',
      entityType: 'FeeCategory',
      entityId: id,
      after: input,
    });
    return { id, code: input.code, name: input.name.trim(), structureCount: 0 };
  }

  async updateCategory(id: string, patch: z.infer<typeof UpdateFeeCategorySchema>) {
    const tx = this.db.current();
    const before = await tx.query.feeCategories.findFirst({
      where: and(eq(feeCategories.id, id), isNull(feeCategories.deletedAt)),
    });
    if (!before) throw AppError.notFound('Catégorie');
    try {
      await tx
        .update(feeCategories)
        .set({ code: patch.code, name: patch.name?.trim() })
        .where(eq(feeCategories.id, id));
    } catch (e) {
      if (uniqueViolation(e)) throw AppError.conflict('Code déjà utilisé');
      throw e;
    }
    await this.audit.record({
      action: 'fee_category.updated',
      entityType: 'FeeCategory',
      entityId: id,
      before: { code: before.code, name: before.name },
      after: patch,
    });
    const after = (await tx.query.feeCategories.findFirst({ where: eq(feeCategories.id, id) }))!;
    return { id, code: after.code, name: after.name };
  }

  async deleteCategory(id: string) {
    const tx = this.db.current();
    const used = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(feeStructures)
      .where(and(eq(feeStructures.categoryId, id), isNull(feeStructures.deletedAt)));
    if ((used[0]?.n ?? 0) > 0)
      throw AppError.conflict('Des grilles utilisent encore cette catégorie');
    const res = await tx
      .update(feeCategories)
      .set({ deletedAt: new Date() })
      .where(and(eq(feeCategories.id, id), isNull(feeCategories.deletedAt)))
      .returning({ id: feeCategories.id });
    if (res.length === 0) throw AppError.notFound('Catégorie');
    await this.audit.record({
      action: 'fee_category.deleted',
      entityType: 'FeeCategory',
      entityId: id,
    });
  }

  // ---------------------------------------------------------------- grilles
  async listStructures(query: z.infer<typeof FeeStructuresQuerySchema>) {
    const tx = this.db.current();
    const yearId = query.academicYearId ?? (await this.structure.currentYear(tx)).id;
    const rows = await tx
      .select({
        s: feeStructures,
        categoryName: feeCategories.name,
        assignedCount: sql<number>`(select count(*)::int from student_fees f where f.fee_structure_id = ${feeStructures.id})`,
      })
      .from(feeStructures)
      .innerJoin(feeCategories, eq(feeCategories.id, feeStructures.categoryId))
      .where(
        and(
          isNull(feeStructures.deletedAt),
          eq(feeStructures.academicYearId, yearId),
          query.categoryId ? eq(feeStructures.categoryId, query.categoryId) : undefined,
          query.status ? eq(feeStructures.status, query.status) : undefined,
        ),
      )
      .orderBy(asc(feeCategories.name), asc(feeStructures.name));
    const items = await this.scheduleOf(
      tx,
      rows.map((r) => r.s.id),
    );
    return rows.map((r) => this.dto(r.s, r.categoryName, items.get(r.s.id) ?? [], r.assignedCount));
  }

  async getStructure(id: string, tx: Db = this.db.current()) {
    const r = (
      await tx
        .select({
          s: feeStructures,
          categoryName: feeCategories.name,
          assignedCount: sql<number>`(select count(*)::int from student_fees f where f.fee_structure_id = ${feeStructures.id})`,
        })
        .from(feeStructures)
        .innerJoin(feeCategories, eq(feeCategories.id, feeStructures.categoryId))
        .where(and(eq(feeStructures.id, id), isNull(feeStructures.deletedAt)))
        .limit(1)
    )[0];
    if (!r) throw AppError.notFound('Grille de frais');
    const items = await this.scheduleOf(tx, [id]);
    return this.dto(r.s, r.categoryName, items.get(id) ?? [], r.assignedCount);
  }

  async createStructure(input: z.infer<typeof CreateFeeStructureSchema>) {
    const tx = this.db.current();
    const yearId = input.academicYearId ?? (await this.structure.currentYear(tx)).id;
    const category = await tx.query.feeCategories.findFirst({
      where: and(eq(feeCategories.id, input.categoryId), isNull(feeCategories.deletedAt)),
    });
    if (!category)
      throw AppError.validation([{ path: 'categoryId', message: 'Catégorie inconnue' }]);
    const total = input.schedule.reduce((s, i) => s + i.amount, 0);
    const id = randomUUID();
    try {
      await tx.insert(feeStructures).values({
        id,
        tenantId: this.tenantId,
        academicYearId: yearId,
        categoryId: input.categoryId,
        code: input.code,
        name: input.name.trim(),
        totalAmount: total,
        currency: 'XOF',
        appliesTo: input.appliesTo,
        status: 'ACTIVE',
        createdBy: RequestContextStore.require().actor?.userId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      if (uniqueViolation(e))
        throw AppError.conflict(`La grille « ${input.code} » existe déjà pour cette année`);
      throw e;
    }
    await this.replaceSchedule(tx, id, input.schedule);
    await this.audit.record({
      action: 'fee_structure.created',
      entityType: 'FeeStructure',
      entityId: id,
      after: { ...input, totalAmount: total },
    });
    return this.getStructure(id, tx);
  }

  async updateStructure(id: string, patch: z.infer<typeof UpdateFeeStructureSchema>) {
    const tx = this.db.current();
    const before = await this.getStructure(id, tx);
    if (patch.schedule) {
      if (before.assignedCount && before.assignedCount > 0)
        throw AppError.conflict(
          "L'échéancier d'une grille déjà affectée ne se modifie pas : créez une nouvelle grille ou ajustez les créances",
        );
      await this.replaceSchedule(tx, id, patch.schedule);
    }
    const total = patch.schedule ? patch.schedule.reduce((s, i) => s + i.amount, 0) : undefined;
    await tx
      .update(feeStructures)
      .set({
        name: patch.name?.trim(),
        categoryId: patch.categoryId,
        appliesTo: patch.appliesTo,
        status: patch.status,
        totalAmount: total,
      })
      .where(eq(feeStructures.id, id));
    const after = await this.getStructure(id, tx);
    await this.audit.record({
      action: 'fee_structure.updated',
      entityType: 'FeeStructure',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  async deleteStructure(id: string) {
    const tx = this.db.current();
    const used = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(studentFees)
      .where(eq(studentFees.feeStructureId, id));
    if ((used[0]?.n ?? 0) > 0)
      throw AppError.conflict('Des créances existent pour cette grille : archivez-la');
    const res = await tx
      .update(feeStructures)
      .set({ deletedAt: new Date() })
      .where(and(eq(feeStructures.id, id), isNull(feeStructures.deletedAt)))
      .returning({ id: feeStructures.id });
    if (res.length === 0) throw AppError.notFound('Grille de frais');
    await this.audit.record({
      action: 'fee_structure.deleted',
      entityType: 'FeeStructure',
      entityId: id,
    });
  }

  private async replaceSchedule(
    tx: Db,
    structureId: string,
    schedule: { seq: number; label: string; amount: number; dueDate: string }[],
  ) {
    await tx.delete(feeScheduleItems).where(eq(feeScheduleItems.feeStructureId, structureId));
    await tx.insert(feeScheduleItems).values(
      schedule.map((s) => ({
        id: randomUUID(),
        tenantId: this.tenantId,
        feeStructureId: structureId,
        seq: s.seq,
        label: s.label.trim(),
        amount: s.amount,
        dueDate: s.dueDate,
      })),
    );
  }

  async scheduleOf(tx: Db, structureIds: string[]) {
    const map = new Map<
      string,
      { id: string; seq: number; label: string; amount: number; dueDate: string }[]
    >();
    if (structureIds.length === 0) return map;
    const rows = await tx
      .select()
      .from(feeScheduleItems)
      .where(inArray(feeScheduleItems.feeStructureId, structureIds))
      .orderBy(asc(feeScheduleItems.seq));
    for (const r of rows)
      map.set(r.feeStructureId, [
        ...(map.get(r.feeStructureId) ?? []),
        { id: r.id, seq: r.seq, label: r.label, amount: r.amount, dueDate: r.dueDate },
      ]);
    return map;
  }

  private dto(
    s: typeof feeStructures.$inferSelect,
    categoryName: string,
    schedule: { id: string; seq: number; label: string; amount: number; dueDate: string }[],
    assignedCount: number,
  ) {
    return {
      id: s.id,
      academicYearId: s.academicYearId,
      categoryId: s.categoryId,
      categoryName,
      code: s.code,
      name: s.name,
      totalAmount: s.totalAmount,
      currency: s.currency,
      appliesTo: {
        programIds: s.appliesTo.programIds ?? [],
        levelIds: s.appliesTo.levelIds ?? [],
        groupIds: s.appliesTo.groupIds ?? [],
      },
      status: s.status,
      schedule,
      assignedCount,
    };
  }
}
