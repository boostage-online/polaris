import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  CloseEnrollmentSchema,
  CreateStudentSchema,
  EnrollStudentSchema,
  LeaveStudentSchema,
  StudentsQuerySchema,
  TransferStudentSchema,
  UpdateStudentSchema,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor, page } from '../../../common/http/cursor';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  academicYears,
  enrollments,
  groups,
  studentGuardians,
  students,
} from '../../../database/schema';
import { StructureService } from '../../academic';
import { AuditService } from '../../audit';
import { MatriculePolicy } from '../domain/policies';

const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class StudentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  async list(query: z.infer<typeof StudentsQuerySchema>) {
    const tx = this.db.current();
    const cur = decodeCursor<{ n: string; id: string }>(query.cursor);
    const yearId = query.academicYearId ?? (await this.structure.currentYear(tx)).id;
    const conds = [
      isNull(students.deletedAt),
      query.status ? eq(students.status, query.status) : undefined,
      query.q
        ? or(
            ilike(sql`${students.lastName} || ' ' || ${students.firstName}`, `%${query.q}%`),
            ilike(students.matricule, `%${query.q}%`),
          )
        : undefined,
      query.groupId
        ? sql`exists (select 1 from enrollments e where e.student_id = students.id and e.group_id = ${query.groupId} and e.left_at is null)`
        : undefined,
      query.incomplete
        ? or(
            isNull(students.birthDate),
            sql`not exists (select 1 from student_guardians sg where sg.student_id = students.id and sg.unlinked_at is null)`,
            sql`not exists (select 1 from enrollments e where e.student_id = students.id and e.academic_year_id = ${yearId} and e.is_primary and e.left_at is null)`,
          )
        : undefined,
      cur
        ? sql`(${students.lastName} || ' ' || ${students.firstName}, ${students.id}) > (${cur.n}, ${cur.id}::uuid)`
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    // Requête mono-table : Drizzle rend les colonnes sans préfixe de table dans les fragments `sql`,
    // d'où les références qualifiées en clair (`students.id`) dans les sous-requêtes corrélées.
    const rows = await tx
      .select({
        s: students,
        currentGroupId: sql<
          string | null
        >`(select e.group_id from enrollments e where e.student_id = students.id and e.academic_year_id = ${yearId} and e.is_primary and e.left_at is null limit 1)`,
        currentGroupName: sql<
          string | null
        >`(select g.name from enrollments e join groups g on g.id = e.group_id where e.student_id = students.id and e.academic_year_id = ${yearId} and e.is_primary and e.left_at is null limit 1)`,
        guardianCount: sql<number>`(select count(*)::int from student_guardians sg where sg.student_id = students.id and sg.unlinked_at is null)`,
      })
      .from(students)
      .where(and(...conds))
      .orderBy(asc(sql`${students.lastName} || ' ' || ${students.firstName}`), asc(students.id))
      .limit(query.limit + 1);

    return page(
      rows.map((r) => ({
        ...this.dto(r.s),
        currentGroup: r.currentGroupId
          ? { id: r.currentGroupId, name: r.currentGroupName ?? '' }
          : null,
        guardianCount: r.guardianCount,
      })),
      query.limit,
      (last) => ({ n: `${last.lastName} ${last.firstName}`, id: last.id }),
    );
  }

  async get(id: string) {
    const tx = this.db.current();
    const s = await tx.query.students.findFirst({
      where: and(eq(students.id, id), isNull(students.deletedAt)),
    });
    if (!s) throw AppError.notFound('Élève');
    const ens = await tx
      .select({
        e: enrollments,
        groupName: groups.name,
        groupKind: groups.kind,
        yearLabel: academicYears.label,
      })
      .from(enrollments)
      .innerJoin(groups, eq(groups.id, enrollments.groupId))
      .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
      .where(eq(enrollments.studentId, id))
      .orderBy(desc(enrollments.enrolledAt), desc(enrollments.createdAt));
    const current = ens.find((e) => e.e.isPrimary && !e.e.leftAt);
    const guardianCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(studentGuardians)
      .where(and(eq(studentGuardians.studentId, id), isNull(studentGuardians.unlinkedAt)));
    return {
      ...this.dto(s),
      currentGroup: current ? { id: current.e.groupId, name: current.groupName } : null,
      guardianCount: guardianCount[0]?.n ?? 0,
      enrollments: ens.map((x) => ({
        id: x.e.id,
        groupId: x.e.groupId,
        groupName: x.groupName,
        groupKind: x.groupKind,
        academicYearId: x.e.academicYearId,
        academicYearLabel: x.yearLabel,
        isPrimary: x.e.isPrimary,
        enrolledAt: x.e.enrolledAt,
        leftAt: x.e.leftAt,
        leftReason: x.e.leftReason,
      })),
    };
  }

  async create(input: z.infer<typeof CreateStudentSchema>) {
    const tx = this.db.current();
    const id = randomUUID();
    const matricule = input.matricule ?? (await this.nextMatricule(tx));
    try {
      await tx.insert(students).values({
        id,
        tenantId: this.tenantId,
        matricule,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        birthDate: input.birthDate ?? null,
        gender: input.gender ?? null,
        photoKey: null,
        status: 'ACTIVE',
        leftAt: null,
        notes: input.notes ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw AppError.conflict(`Le matricule « ${matricule} » existe déjà`);
      throw e;
    }
    await this.audit.record({
      action: 'student.created',
      entityType: 'Student',
      entityId: id,
      after: { ...input, matricule },
    });
    if (input.groupId) await this.enroll(id, { groupId: input.groupId }, false);
    return this.get(id);
  }

  async update(id: string, patch: z.infer<typeof UpdateStudentSchema>) {
    const tx = this.db.current();
    const before = await this.get(id);
    try {
      await tx
        .update(students)
        .set({ ...patch })
        .where(eq(students.id, id));
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw AppError.conflict('Matricule déjà utilisé');
      throw e;
    }
    const after = await this.get(id);
    await this.audit.record({
      action: 'student.updated',
      entityType: 'Student',
      entityId: id,
      before: this.dto(before),
      after: this.dto(after),
    });
    return after;
  }

  /** Inscription dans un groupe de l'année du groupe ; CLASS = inscription principale, unique et active. */
  async enroll(studentId: string, input: z.infer<typeof EnrollStudentSchema>, audit = true) {
    const tx = this.db.current();
    const student = await tx.query.students.findFirst({
      where: and(eq(students.id, studentId), isNull(students.deletedAt)),
    });
    if (!student) throw AppError.notFound('Élève');
    if (student.status !== 'ACTIVE') throw AppError.conflict("Cet élève n'est plus actif");
    const group = await tx.query.groups.findFirst({
      where: and(eq(groups.id, input.groupId), isNull(groups.deletedAt)),
    });
    if (!group) throw AppError.validation([{ path: 'groupId', message: 'Groupe inconnu' }]);
    if (group.capacity) {
      const n = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(enrollments)
        .where(and(eq(enrollments.groupId, group.id), isNull(enrollments.leftAt)));
      if ((n[0]?.n ?? 0) >= group.capacity)
        throw AppError.conflict(`Le groupe « ${group.name} » est complet (${group.capacity})`);
    }
    const id = randomUUID();
    try {
      await tx.insert(enrollments).values({
        id,
        tenantId: this.tenantId,
        studentId,
        groupId: group.id,
        academicYearId: group.academicYearId,
        isPrimary: group.kind === 'CLASS',
        enrolledAt: input.enrolledAt ?? today(),
        leftAt: null,
        leftReason: null,
        createdBy: RequestContextStore.require().actor?.userId ?? null,
        createdAt: new Date(),
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw AppError.conflict(
          group.kind === 'CLASS'
            ? 'Cet élève a déjà une classe active cette année : utilisez le changement de classe'
            : 'Déjà inscrit dans ce groupe',
        );
      }
      throw e;
    }
    if (audit)
      await this.audit.record({
        action: 'enrollment.created',
        entityType: 'Enrollment',
        entityId: id,
        after: { studentId, groupId: group.id },
      });
    return this.enrollment(studentId, id);
  }

  /** Une inscription telle que la fiche élève la présente. */
  private async enrollment(studentId: string, enrollmentId: string) {
    const fiche = await this.get(studentId);
    return fiche.enrollments.find((e) => e.id === enrollmentId)!;
  }

  /** Changement de classe : clôture de l'inscription principale active + nouvelle ligne (historique conservé). */
  async transfer(studentId: string, input: z.infer<typeof TransferStudentSchema>) {
    const tx = this.db.current();
    const student = await tx.query.students.findFirst({
      where: and(eq(students.id, studentId), isNull(students.deletedAt)),
      columns: { id: true },
    });
    if (!student) throw AppError.notFound('Élève');
    const target = await tx.query.groups.findFirst({
      where: and(eq(groups.id, input.toGroupId), isNull(groups.deletedAt)),
    });
    if (!target || target.kind !== 'CLASS')
      throw AppError.validation([
        { path: 'toGroupId', message: 'La classe cible est inconnue ou n’est pas une classe' },
      ]);
    const current = await tx.query.enrollments.findFirst({
      where: and(
        eq(enrollments.studentId, studentId),
        eq(enrollments.academicYearId, target.academicYearId),
        eq(enrollments.isPrimary, true),
        isNull(enrollments.leftAt),
      ),
    });
    const date = input.effectiveDate ?? today();
    if (current) {
      if (current.groupId === target.id)
        throw AppError.conflict('L’élève est déjà dans cette classe');
      await tx
        .update(enrollments)
        .set({ leftAt: date, leftReason: input.reason ?? 'Changement de classe' })
        .where(eq(enrollments.id, current.id));
      // Les sous-groupes rattachés à l'ancienne classe sont clôturés aussi.
      await tx.execute(
        sql`update enrollments set left_at = ${date}, left_reason = 'Changement de classe' where student_id = ${studentId} and left_at is null and group_id in (select id from groups where parent_group_id = ${current.groupId})`,
      );
    }
    await this.enroll(studentId, { groupId: target.id, enrolledAt: date }, false);
    await this.audit.record({
      action: 'student.transferred',
      entityType: 'Student',
      entityId: studentId,
      before: { groupId: current?.groupId ?? null },
      after: { groupId: target.id, effectiveDate: date, reason: input.reason },
    });
    return this.get(studentId);
  }

  async closeEnrollment(enrollmentId: string, input: z.infer<typeof CloseEnrollmentSchema>) {
    const tx = this.db.current();
    const e = await tx.query.enrollments.findFirst({
      where: and(eq(enrollments.id, enrollmentId), isNull(enrollments.leftAt)),
    });
    if (!e) throw AppError.notFound('Inscription');
    await tx
      .update(enrollments)
      .set({ leftAt: input.leftAt ?? today(), leftReason: input.reason ?? null })
      .where(eq(enrollments.id, enrollmentId));
    await this.audit.record({
      action: 'enrollment.closed',
      entityType: 'Enrollment',
      entityId: enrollmentId,
      before: { groupId: e.groupId },
      after: input,
    });
    return this.enrollment(e.studentId, enrollmentId);
  }

  async leave(studentId: string, input: z.infer<typeof LeaveStudentSchema>) {
    const tx = this.db.current();
    const before = await this.get(studentId);
    const date = input.leftAt ?? today();
    await tx
      .update(students)
      .set({ status: input.status, leftAt: date })
      .where(eq(students.id, studentId));
    await tx
      .update(enrollments)
      .set({ leftAt: date, leftReason: input.reason ?? input.status })
      .where(and(eq(enrollments.studentId, studentId), isNull(enrollments.leftAt)));
    await this.audit.record({
      action: 'student.left',
      entityType: 'Student',
      entityId: studentId,
      before: { status: before.status },
      after: input,
    });
    return this.get(studentId);
  }

  /** Candidats doublons pour une saisie (nom + date de naissance). */
  async duplicates(
    firstName: string,
    lastName: string,
    birthDate: string | null,
    tx: Db = this.db.current(),
  ) {
    const rows = await tx
      .select({
        id: students.id,
        matricule: students.matricule,
        firstName: students.firstName,
        lastName: students.lastName,
        birthDate: students.birthDate,
      })
      .from(students)
      .where(
        and(
          isNull(students.deletedAt),
          sql`unaccent_lite(${students.lastName}) = unaccent_lite(${lastName})`,
          sql`unaccent_lite(${students.firstName}) = unaccent_lite(${firstName})`,
        ),
      )
      .limit(5);
    return rows.filter((r) => !birthDate || !r.birthDate || r.birthDate === birthDate);
  }

  async nextMatricule(tx: Db) {
    const year = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    const n = await tx.select({ n: sql<number>`count(*)::int` }).from(students);
    let seq = (n[0]?.n ?? 0) + 1;
    for (;;) {
      const candidate = MatriculePolicy.generate(
        year?.label ?? String(new Date().getFullYear()),
        seq,
      );
      const exists = await tx.query.students.findFirst({
        where: eq(students.matricule, candidate),
        columns: { id: true },
      });
      if (!exists) return candidate;
      seq++;
    }
  }

  async idsByMatricule(tx: Db, matricules: string[]) {
    if (matricules.length === 0) return new Map<string, string>();
    const rows = await tx
      .select({ id: students.id, matricule: students.matricule })
      .from(students)
      .where(and(inArray(students.matricule, matricules), isNull(students.deletedAt)));
    return new Map(rows.map((r) => [r.matricule, r.id]));
  }

  dto(
    s: Pick<
      typeof students.$inferSelect,
      'id' | 'matricule' | 'firstName' | 'lastName' | 'birthDate' | 'gender' | 'status' | 'leftAt'
    > & { notes?: string | null },
  ) {
    return {
      id: s.id,
      matricule: s.matricule,
      firstName: s.firstName,
      lastName: s.lastName,
      birthDate: s.birthDate,
      gender: s.gender,
      status: s.status,
      leftAt: s.leftAt,
      notes: s.notes ?? null,
    };
  }
}
