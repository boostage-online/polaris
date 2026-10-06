import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  CreateAcademicYearSchema,
  CreateGroupSchema,
  CreateLevelSchema,
  CreateProgramSchema,
  CreateSubjectSchema,
  CreateTermSchema,
  GroupsQuerySchema,
  UpdateAcademicYearSchema,
  UpdateGroupSchema,
  UpdateLevelSchema,
  UpdateProgramSchema,
  UpdateSubjectSchema,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  academicYears,
  enrollments,
  groups,
  levels,
  programs,
  subjects,
  terms,
} from '../../../database/schema';
import { AuditService } from '../../audit';

const uniqueViolation = (e: unknown) => (e as { code?: string }).code === '23505';

/** Années, périodes, programmes, niveaux, groupes, matières (ADR-0004). */
@Injectable()
export class StructureService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  // ---------------------------------------------------------------- années
  async listYears() {
    const rows = await this.db
      .current()
      .query.academicYears.findMany({ orderBy: [asc(academicYears.startDate)] });
    return rows.map(this.yearDto);
  }

  async currentYear(tx: Db = this.db.current()) {
    const row = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    if (!row) throw AppError.conflict("Aucune année académique courante : créez-en une d'abord");
    return row;
  }

  async createYear(input: z.infer<typeof CreateAcademicYearSchema>) {
    const tx = this.db.current();
    const id = randomUUID();
    if (input.isCurrent)
      await tx
        .update(academicYears)
        .set({ isCurrent: false })
        .where(eq(academicYears.isCurrent, true));
    try {
      await tx
        .insert(academicYears)
        .values({
          id,
          tenantId: this.tenantId,
          label: input.label,
          startDate: input.startDate,
          endDate: input.endDate,
          isCurrent: input.isCurrent,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    } catch (e) {
      if (uniqueViolation(e)) throw AppError.conflict(`L'année « ${input.label} » existe déjà`);
      throw e;
    }
    await this.audit.record({
      action: 'academic_year.created',
      entityType: 'AcademicYear',
      entityId: id,
      after: input,
    });
    return this.yearDto(
      (await tx.query.academicYears.findFirst({ where: eq(academicYears.id, id) }))!,
    );
  }

  async updateYear(id: string, patch: z.infer<typeof UpdateAcademicYearSchema>) {
    const tx = this.db.current();
    const before = await tx.query.academicYears.findFirst({ where: eq(academicYears.id, id) });
    if (!before) throw AppError.notFound('Année académique');
    const next = {
      startDate: patch.startDate ?? before.startDate,
      endDate: patch.endDate ?? before.endDate,
    };
    if (next.endDate <= next.startDate)
      throw AppError.validation([{ path: 'endDate', message: 'La fin doit être après le début' }]);
    const [after] = await tx
      .update(academicYears)
      .set({ ...patch })
      .where(eq(academicYears.id, id))
      .returning();
    await this.audit.record({
      action: 'academic_year.updated',
      entityType: 'AcademicYear',
      entityId: id,
      before: this.yearDto(before),
      after: this.yearDto(after!),
    });
    return this.yearDto(after!);
  }

  async setCurrentYear(id: string) {
    const tx = this.db.current();
    const target = await tx.query.academicYears.findFirst({ where: eq(academicYears.id, id) });
    if (!target) throw AppError.notFound('Année académique');
    await tx
      .update(academicYears)
      .set({ isCurrent: false })
      .where(eq(academicYears.isCurrent, true));
    await tx.update(academicYears).set({ isCurrent: true }).where(eq(academicYears.id, id));
    await this.audit.record({
      action: 'academic_year.set_current',
      entityType: 'AcademicYear',
      entityId: id,
    });
    return this.yearDto({ ...target, isCurrent: true });
  }

  async listTerms(yearId: string) {
    const rows = await this.db
      .current()
      .query.terms.findMany({
        where: eq(terms.academicYearId, yearId),
        orderBy: [asc(terms.startDate)],
      });
    return rows.map((t) => ({
      id: t.id,
      academicYearId: t.academicYearId,
      label: t.label,
      startDate: t.startDate,
      endDate: t.endDate,
    }));
  }

  async createTerm(yearId: string, input: z.infer<typeof CreateTermSchema>) {
    const tx = this.db.current();
    const year = await tx.query.academicYears.findFirst({ where: eq(academicYears.id, yearId) });
    if (!year) throw AppError.notFound('Année académique');
    if (input.startDate < year.startDate || input.endDate > year.endDate) {
      throw AppError.validation([
        { path: 'startDate', message: "La période doit être comprise dans l'année" },
      ]);
    }
    const id = randomUUID();
    try {
      await tx
        .insert(terms)
        .values({
          id,
          tenantId: this.tenantId,
          academicYearId: yearId,
          label: input.label,
          startDate: input.startDate,
          endDate: input.endDate,
          createdAt: new Date(),
        });
    } catch (e) {
      if (uniqueViolation(e)) throw AppError.conflict(`La période « ${input.label} » existe déjà`);
      throw e;
    }
    await this.audit.record({
      action: 'term.created',
      entityType: 'Term',
      entityId: id,
      after: input,
    });
    return { id, academicYearId: yearId, ...input };
  }

  // ---------------------------------------------------------------- programmes et niveaux
  async listPrograms() {
    const tx = this.db.current();
    const ps = await tx.query.programs.findMany({
      where: isNull(programs.deletedAt),
      orderBy: [asc(programs.name)],
    });
    const ls = await tx.query.levels.findMany({
      where: isNull(levels.deletedAt),
      orderBy: [asc(levels.rank), asc(levels.name)],
    });
    return ps.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      isDefault: p.isDefault,
      levels: ls
        .filter((l) => l.programId === p.id)
        .map((l) => ({ id: l.id, name: l.name, rank: l.rank })),
    }));
  }

  async createProgram(input: z.infer<typeof CreateProgramSchema>) {
    const tx = this.db.current();
    const id = randomUUID();
    try {
      await tx
        .insert(programs)
        .values({
          id,
          tenantId: this.tenantId,
          code: input.code,
          name: input.name,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    } catch (e) {
      if (uniqueViolation(e)) throw AppError.conflict(`Le code « ${input.code} » existe déjà`);
      throw e;
    }
    await this.audit.record({
      action: 'program.created',
      entityType: 'Program',
      entityId: id,
      after: input,
    });
    return { id, ...input, isDefault: false, levels: [] };
  }

  /** Programme implicite des écoles (créé à la demande) : les classes y sont rattachées sans que l'utilisateur voie la notion. */
  async defaultProgram(tx: Db = this.db.current()) {
    const existing = await tx.query.programs.findFirst({
      where: and(eq(programs.isDefault, true), isNull(programs.deletedAt)),
    });
    if (existing) return existing;
    const id = randomUUID();
    await tx
      .insert(programs)
      .values({
        id,
        tenantId: this.tenantId,
        code: 'GENERAL',
        name: 'Enseignement général',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    return (await tx.query.programs.findFirst({ where: eq(programs.id, id) }))!;
  }

  async updateProgram(id: string, patch: z.infer<typeof UpdateProgramSchema>) {
    const tx = this.db.current();
    const before = await tx.query.programs.findFirst({
      where: and(eq(programs.id, id), isNull(programs.deletedAt)),
    });
    if (!before) throw AppError.notFound('Programme');
    try {
      await tx.update(programs).set(patch).where(eq(programs.id, id));
    } catch (e) {
      if (uniqueViolation(e)) throw AppError.conflict('Code déjà utilisé');
      throw e;
    }
    await this.audit.record({
      action: 'program.updated',
      entityType: 'Program',
      entityId: id,
      before: { code: before.code, name: before.name },
      after: patch,
    });
    return {
      id,
      code: patch.code ?? before.code,
      name: patch.name ?? before.name,
      isDefault: before.isDefault,
    };
  }

  async deleteProgram(id: string) {
    const tx = this.db.current();
    const used = await tx
      .select({ n: count() })
      .from(levels)
      .innerJoin(groups, eq(groups.levelId, levels.id))
      .where(and(eq(levels.programId, id), isNull(groups.deletedAt)));
    if ((used[0]?.n ?? 0) > 0) throw AppError.conflict('Des groupes utilisent encore ce programme');
    const res = await tx
      .update(programs)
      .set({ deletedAt: new Date() })
      .where(and(eq(programs.id, id), isNull(programs.deletedAt)))
      .returning({ id: programs.id });
    if (res.length === 0) throw AppError.notFound('Programme');
    await tx.update(levels).set({ deletedAt: new Date() }).where(eq(levels.programId, id));
    await this.audit.record({ action: 'program.deleted', entityType: 'Program', entityId: id });
  }

  async createLevel(programId: string, input: z.infer<typeof CreateLevelSchema>) {
    const tx = this.db.current();
    const program = await tx.query.programs.findFirst({
      where: and(eq(programs.id, programId), isNull(programs.deletedAt)),
    });
    if (!program) throw AppError.notFound('Programme');
    const id = randomUUID();
    try {
      await tx
        .insert(levels)
        .values({
          id,
          tenantId: this.tenantId,
          programId,
          name: input.name,
          rank: input.rank,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    } catch (e) {
      if (uniqueViolation(e))
        throw AppError.conflict(`Le niveau « ${input.name} » existe déjà dans ce programme`);
      throw e;
    }
    await this.audit.record({
      action: 'level.created',
      entityType: 'Level',
      entityId: id,
      after: { programId, ...input },
    });
    return { id, programId, ...input };
  }

  async updateLevel(id: string, patch: z.infer<typeof UpdateLevelSchema>) {
    const tx = this.db.current();
    const before = await tx.query.levels.findFirst({
      where: and(eq(levels.id, id), isNull(levels.deletedAt)),
    });
    if (!before) throw AppError.notFound('Niveau');
    try {
      await tx.update(levels).set(patch).where(eq(levels.id, id));
    } catch (e) {
      if (uniqueViolation(e)) throw AppError.conflict('Nom déjà utilisé dans ce programme');
      throw e;
    }
    await this.audit.record({
      action: 'level.updated',
      entityType: 'Level',
      entityId: id,
      before: { name: before.name, rank: before.rank },
      after: patch,
    });
    return {
      id,
      programId: before.programId,
      name: patch.name ?? before.name,
      rank: patch.rank ?? before.rank,
    };
  }

  // ---------------------------------------------------------------- groupes
  async listGroups(query: z.infer<typeof GroupsQuerySchema>) {
    const tx = this.db.current();
    const yearId = query.academicYearId ?? (await this.currentYear(tx)).id;
    const rows = await tx
      .select({
        g: groups,
        levelName: levels.name,
        programName: programs.name,
        studentCount: sql<number>`(select count(*)::int from enrollments e where e.group_id = ${groups.id} and e.left_at is null)`,
      })
      .from(groups)
      .innerJoin(levels, eq(levels.id, groups.levelId))
      .innerJoin(programs, eq(programs.id, levels.programId))
      .where(
        and(
          eq(groups.academicYearId, yearId),
          isNull(groups.deletedAt),
          query.kind ? eq(groups.kind, query.kind) : undefined,
          query.levelId ? eq(groups.levelId, query.levelId) : undefined,
        ),
      )
      .orderBy(asc(levels.rank), asc(groups.name));
    return rows.map((r) =>
      this.groupDto(r.g, {
        levelName: r.levelName,
        programName: r.programName,
        studentCount: r.studentCount,
      }),
    );
  }

  async getGroup(id: string) {
    const tx = this.db.current();
    const row = await tx.query.groups.findFirst({
      where: and(eq(groups.id, id), isNull(groups.deletedAt)),
    });
    if (!row) throw AppError.notFound('Groupe');
    return this.groupDto(row);
  }

  async createGroup(input: z.infer<typeof CreateGroupSchema>) {
    const tx = this.db.current();
    const level = await tx.query.levels.findFirst({
      where: and(eq(levels.id, input.levelId), isNull(levels.deletedAt)),
    });
    if (!level) throw AppError.validation([{ path: 'levelId', message: 'Niveau inconnu' }]);
    if (input.kind === 'SUBGROUP' && !input.parentGroupId) {
      throw AppError.validation([
        {
          path: 'parentGroupId',
          message: 'Un sous-groupe doit être rattaché à une classe ou promotion',
        },
      ]);
    }
    if (input.parentGroupId) {
      const parent = await tx.query.groups.findFirst({
        where: and(eq(groups.id, input.parentGroupId), isNull(groups.deletedAt)),
      });
      if (!parent || parent.academicYearId !== input.academicYearId)
        throw AppError.validation([
          { path: 'parentGroupId', message: 'Groupe parent inconnu ou d’une autre année' },
        ]);
    }
    const id = randomUUID();
    try {
      await tx
        .insert(groups)
        .values({
          id,
          tenantId: this.tenantId,
          academicYearId: input.academicYearId,
          levelId: input.levelId,
          campusId: input.campusId ?? null,
          parentGroupId: input.parentGroupId ?? null,
          name: input.name,
          kind: input.kind,
          capacity: input.capacity ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    } catch (e) {
      if (uniqueViolation(e))
        throw AppError.conflict(`Le groupe « ${input.name} » existe déjà pour cette année`);
      throw e;
    }
    await this.audit.record({
      action: 'group.created',
      entityType: 'Group',
      entityId: id,
      after: input,
    });
    return this.getGroup(id);
  }

  async updateGroup(id: string, patch: z.infer<typeof UpdateGroupSchema>) {
    const tx = this.db.current();
    const before = await this.getGroup(id);
    try {
      await tx
        .update(groups)
        .set({ ...patch })
        .where(eq(groups.id, id));
    } catch (e) {
      if (uniqueViolation(e)) throw AppError.conflict('Nom déjà utilisé pour cette année');
      throw e;
    }
    const after = await this.getGroup(id);
    await this.audit.record({
      action: 'group.updated',
      entityType: 'Group',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  async deleteGroup(id: string) {
    const tx = this.db.current();
    const active = await tx
      .select({ n: count() })
      .from(enrollments)
      .where(and(eq(enrollments.groupId, id), isNull(enrollments.leftAt)));
    if ((active[0]?.n ?? 0) > 0)
      throw AppError.conflict('Des élèves sont encore inscrits dans ce groupe');
    const res = await tx
      .update(groups)
      .set({ deletedAt: new Date() })
      .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
      .returning({ id: groups.id });
    if (res.length === 0) throw AppError.notFound('Groupe');
    await this.audit.record({ action: 'group.deleted', entityType: 'Group', entityId: id });
  }

  // ---------------------------------------------------------------- matières
  async listSubjects() {
    const rows = await this.db
      .current()
      .query.subjects.findMany({
        where: isNull(subjects.deletedAt),
        orderBy: [asc(subjects.name)],
      });
    return rows.map((s) => ({ id: s.id, code: s.code, name: s.name, levelId: s.levelId }));
  }

  async createSubject(input: z.infer<typeof CreateSubjectSchema>) {
    const tx = this.db.current();
    const id = randomUUID();
    try {
      await tx
        .insert(subjects)
        .values({
          id,
          tenantId: this.tenantId,
          code: input.code,
          name: input.name,
          levelId: input.levelId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    } catch (e) {
      if (uniqueViolation(e)) throw AppError.conflict(`Le code « ${input.code} » existe déjà`);
      throw e;
    }
    await this.audit.record({
      action: 'subject.created',
      entityType: 'Subject',
      entityId: id,
      after: input,
    });
    return { id, code: input.code, name: input.name, levelId: input.levelId ?? null };
  }

  async updateSubject(id: string, patch: z.infer<typeof UpdateSubjectSchema>) {
    const tx = this.db.current();
    const before = await tx.query.subjects.findFirst({
      where: and(eq(subjects.id, id), isNull(subjects.deletedAt)),
    });
    if (!before) throw AppError.notFound('Matière');
    try {
      await tx
        .update(subjects)
        .set({ ...patch })
        .where(eq(subjects.id, id));
    } catch (e) {
      if (uniqueViolation(e)) throw AppError.conflict('Code déjà utilisé');
      throw e;
    }
    await this.audit.record({
      action: 'subject.updated',
      entityType: 'Subject',
      entityId: id,
      before: { code: before.code, name: before.name },
      after: patch,
    });
    return {
      id,
      code: patch.code ?? before.code,
      name: patch.name ?? before.name,
      levelId: patch.levelId === undefined ? before.levelId : (patch.levelId ?? null),
    };
  }

  async deleteSubject(id: string) {
    const tx = this.db.current();
    const used = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from course_offerings where subject_id = ${id} and deleted_at is null`,
    );
    if ((used.rows[0]?.n ?? 0) > 0)
      throw AppError.conflict('Des cours utilisent encore cette matière : désactivez-les d’abord');
    const res = await tx
      .update(subjects)
      .set({ deletedAt: new Date() })
      .where(and(eq(subjects.id, id), isNull(subjects.deletedAt)))
      .returning({ id: subjects.id });
    if (res.length === 0) throw AppError.notFound('Matière');
    await this.audit.record({ action: 'subject.deleted', entityType: 'Subject', entityId: id });
  }

  // ---------------------------------------------------------------- dto
  yearDto(r: typeof academicYears.$inferSelect) {
    return {
      id: r.id,
      label: r.label,
      startDate: r.startDate,
      endDate: r.endDate,
      isCurrent: r.isCurrent,
    };
  }
  groupDto(
    g: typeof groups.$inferSelect,
    extra: { levelName?: string; programName?: string; studentCount?: number } = {},
  ) {
    return {
      id: g.id,
      academicYearId: g.academicYearId,
      levelId: g.levelId,
      campusId: g.campusId,
      parentGroupId: g.parentGroupId,
      name: g.name,
      kind: g.kind,
      capacity: g.capacity,
      ...extra,
    };
  }
}
