import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  CoursesQuerySchema,
  CreateCourseSchema,
  CreateScheduleSlotSchema,
  SetCourseTeachersSchema,
  UpdateStaffSchema,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  courseOfferings,
  courseTeachers,
  groups,
  memberships,
  membershipRoles,
  roles,
  scheduleSlots,
  staffProfiles,
  subjects,
  users,
} from '../../../database/schema';
import { AuditService } from '../../audit';
import { SchedulePolicy } from '../domain/policies';
import { StructureService } from './structure.service';

/** Personnel enseignant, cours (CourseOffering), enseignants d'un cours, créneaux récurrents. */
@Injectable()
export class CourseService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  // ---------------------------------------------------------------- personnel
  async listStaff() {
    const tx = this.db.current();
    const rows = await tx
      .select({
        membershipId: memberships.id,
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        status: memberships.status,
        sp: staffProfiles,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(staffProfiles, eq(staffProfiles.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.tenantId, this.tenantId),
          eq(memberships.kind, 'STAFF'),
          eq(memberships.status, 'ACTIVE'),
        ),
      )
      .orderBy(asc(users.displayName));
    const rr = rows.length
      ? await tx
          .select({ membershipId: membershipRoles.membershipId, id: roles.id, name: roles.name })
          .from(membershipRoles)
          .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
          .where(
            inArray(
              membershipRoles.membershipId,
              rows.map((r) => r.membershipId),
            ),
          )
      : [];
    return rows.map((r) => ({
      membershipId: r.membershipId,
      staffProfileId: r.sp?.id ?? null,
      userId: r.userId,
      displayName: r.displayName,
      email: r.email,
      isTeacher: r.sp?.isTeacher ?? false,
      employeeNumber: r.sp?.employeeNumber ?? null,
      title: r.sp?.title ?? null,
      roles: rr
        .filter((x) => x.membershipId === r.membershipId)
        .map((x) => ({ id: x.id, name: x.name })),
    }));
  }

  /** Crée le profil à la demande : tout membre du personnel peut devenir enseignant d'un clic. */
  async ensureStaffProfile(tx: Db, membershipId: string) {
    const existing = await tx.query.staffProfiles.findFirst({
      where: eq(staffProfiles.membershipId, membershipId),
    });
    if (existing) return existing;
    const m = await tx.query.memberships.findFirst({
      where: and(
        eq(memberships.id, membershipId),
        eq(memberships.tenantId, this.tenantId),
        eq(memberships.kind, 'STAFF'),
      ),
    });
    if (!m) throw AppError.notFound('Membre');
    const id = randomUUID();
    await tx.insert(staffProfiles).values({
      id,
      tenantId: this.tenantId,
      membershipId,
      employeeNumber: null,
      title: null,
      isTeacher: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return (await tx.query.staffProfiles.findFirst({ where: eq(staffProfiles.id, id) }))!;
  }

  async updateStaff(membershipId: string, patch: z.infer<typeof UpdateStaffSchema>) {
    const tx = this.db.current();
    const before = await this.ensureStaffProfile(tx, membershipId);
    try {
      await tx
        .update(staffProfiles)
        .set({ ...patch })
        .where(eq(staffProfiles.id, before.id));
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw AppError.conflict('Matricule employé déjà utilisé');
      throw e;
    }
    await this.audit.record({
      action: 'staff.updated',
      entityType: 'StaffProfile',
      entityId: before.id,
      before: {
        isTeacher: before.isTeacher,
        employeeNumber: before.employeeNumber,
        title: before.title,
      },
      after: patch,
    });
    return (await this.listStaff()).find((s) => s.membershipId === membershipId)!;
  }

  /** Profil enseignant de l'acteur courant (null s'il n'en a pas). */
  async staffProfileOfActor(tx: Db): Promise<string | null> {
    const mid = RequestContextStore.require().actor?.membershipId;
    if (!mid) return null;
    const sp = await tx.query.staffProfiles.findFirst({
      where: eq(staffProfiles.membershipId, mid),
    });
    return sp?.id ?? null;
  }

  // ---------------------------------------------------------------- cours
  async listCourses(query: z.infer<typeof CoursesQuerySchema>) {
    const tx = this.db.current();
    const yearId = query.academicYearId ?? (await this.structure.currentYear(tx)).id;
    const rows = await tx
      .select({ c: courseOfferings, subjectName: subjects.name, groupName: groups.name })
      .from(courseOfferings)
      .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
      .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
      .where(
        and(
          eq(courseOfferings.academicYearId, yearId),
          isNull(courseOfferings.deletedAt),
          query.groupId ? eq(courseOfferings.groupId, query.groupId) : undefined,
        ),
      )
      .orderBy(asc(groups.name), asc(subjects.name));
    const ids = rows.map((r) => r.c.id);
    const teachers = await this.teachersOf(tx, ids);
    const slots = ids.length
      ? await tx.query.scheduleSlots.findMany({
          where: and(inArray(scheduleSlots.courseOfferingId, ids), isNull(scheduleSlots.deletedAt)),
        })
      : [];
    let out = rows.map((r) =>
      this.courseDto(
        r.c,
        { subjectName: r.subjectName, groupName: r.groupName },
        teachers.filter((t) => t.courseOfferingId === r.c.id),
        slots.filter((s) => s.courseOfferingId === r.c.id),
      ),
    );
    if (query.teacherStaffProfileId)
      out = out.filter((c) =>
        c.teachers.some((t) => t.staffProfileId === query.teacherStaffProfileId),
      );
    return out;
  }

  async getCourse(id: string) {
    const tx = this.db.current();
    const row = await tx
      .select({ c: courseOfferings, subjectName: subjects.name, groupName: groups.name })
      .from(courseOfferings)
      .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
      .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
      .where(and(eq(courseOfferings.id, id), isNull(courseOfferings.deletedAt)))
      .limit(1);
    const r = row[0];
    if (!r) throw AppError.notFound('Cours');
    const teachers = await this.teachersOf(tx, [id]);
    const slots = await tx.query.scheduleSlots.findMany({
      where: and(eq(scheduleSlots.courseOfferingId, id), isNull(scheduleSlots.deletedAt)),
      orderBy: [asc(scheduleSlots.weekday), asc(scheduleSlots.startTime)],
    });
    return this.courseDto(
      r.c,
      { subjectName: r.subjectName, groupName: r.groupName },
      teachers,
      slots,
    );
  }

  async createCourse(input: z.infer<typeof CreateCourseSchema>) {
    const tx = this.db.current();
    const group = await tx.query.groups.findFirst({
      where: and(eq(groups.id, input.groupId), isNull(groups.deletedAt)),
    });
    if (!group) throw AppError.validation([{ path: 'groupId', message: 'Groupe inconnu' }]);
    const subject = await tx.query.subjects.findFirst({
      where: and(eq(subjects.id, input.subjectId), isNull(subjects.deletedAt)),
    });
    if (!subject) throw AppError.validation([{ path: 'subjectId', message: 'Matière inconnue' }]);
    const id = randomUUID();
    try {
      await tx.insert(courseOfferings).values({
        id,
        tenantId: this.tenantId,
        subjectId: input.subjectId,
        groupId: input.groupId,
        academicYearId: group.academicYearId,
        termId: input.termId ?? null,
        label: input.label ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw AppError.conflict('Ce cours existe déjà pour ce groupe et cette période');
      throw e;
    }
    if (input.teachers.length) await this.setTeachers(id, { teachers: input.teachers }, false);
    await this.audit.record({
      action: 'course.created',
      entityType: 'CourseOffering',
      entityId: id,
      after: input,
    });
    return this.getCourse(id);
  }

  async setTeachers(
    courseId: string,
    input: z.infer<typeof SetCourseTeachersSchema>,
    audit = true,
  ) {
    const tx = this.db.current();
    const course = await tx.query.courseOfferings.findFirst({
      where: and(eq(courseOfferings.id, courseId), isNull(courseOfferings.deletedAt)),
    });
    if (!course) throw AppError.notFound('Cours');
    const ids = input.teachers.map((t) => t.staffProfileId);
    const valid = ids.length
      ? await tx.query.staffProfiles.findMany({ where: inArray(staffProfiles.id, ids) })
      : [];
    if (valid.length !== new Set(ids).size)
      throw AppError.validation([{ path: 'teachers', message: 'Profil enseignant inconnu' }]);
    const before = await this.teachersOf(tx, [courseId]);
    await tx.delete(courseTeachers).where(eq(courseTeachers.courseOfferingId, courseId));
    if (input.teachers.length) {
      await tx.insert(courseTeachers).values(
        input.teachers.map((t) => ({
          tenantId: this.tenantId,
          courseOfferingId: courseId,
          staffProfileId: t.staffProfileId,
          role: t.role,
        })),
      );
      await tx.update(staffProfiles).set({ isTeacher: true }).where(inArray(staffProfiles.id, ids));
    }
    if (audit)
      await this.audit.record({
        action: 'course.teachers_set',
        entityType: 'CourseOffering',
        entityId: courseId,
        before: before.map((b) => ({ staffProfileId: b.staffProfileId, role: b.role })),
        after: input.teachers,
      });
    return this.getCourse(courseId);
  }

  async deleteCourse(id: string) {
    const tx = this.db.current();
    const res = await tx
      .update(courseOfferings)
      .set({ deletedAt: new Date() })
      .where(and(eq(courseOfferings.id, id), isNull(courseOfferings.deletedAt)))
      .returning({ id: courseOfferings.id });
    if (res.length === 0) throw AppError.notFound('Cours');
    await tx
      .update(scheduleSlots)
      .set({ deletedAt: new Date() })
      .where(eq(scheduleSlots.courseOfferingId, id));
    await tx.execute(
      sql`update sessions set status = 'CANCELLED', cancel_reason = 'Cours supprimé' where course_offering_id = ${id} and status = 'PLANNED' and starts_at > now()`,
    );
    await this.audit.record({
      action: 'course.deleted',
      entityType: 'CourseOffering',
      entityId: id,
    });
  }

  // ---------------------------------------------------------------- créneaux
  async addSlot(courseId: string, input: z.infer<typeof CreateScheduleSlotSchema>) {
    const tx = this.db.current();
    const course = await tx.query.courseOfferings.findFirst({
      where: and(eq(courseOfferings.id, courseId), isNull(courseOfferings.deletedAt)),
    });
    if (!course) throw AppError.notFound('Cours');
    // Chevauchements : avertissement (meta), pas blocage — les établissements ont des cas légitimes (dédoublements).
    const warnings = await this.overlapWarnings(tx, course, input);
    const id = randomUUID();
    await tx.insert(scheduleSlots).values({
      id,
      tenantId: this.tenantId,
      courseOfferingId: courseId,
      weekday: input.weekday,
      startTime: input.startTime,
      endTime: input.endTime,
      room: input.room ?? null,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      createdAt: new Date(),
    });
    await this.audit.record({
      action: 'schedule_slot.created',
      entityType: 'ScheduleSlot',
      entityId: id,
      after: { courseId, ...input },
    });
    return {
      data: {
        id,
        courseOfferingId: courseId,
        ...input,
        room: input.room ?? null,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
      },
      meta: { warnings },
    };
  }

  async deleteSlot(slotId: string) {
    const tx = this.db.current();
    const res = await tx
      .update(scheduleSlots)
      .set({ deletedAt: new Date() })
      .where(and(eq(scheduleSlots.id, slotId), isNull(scheduleSlots.deletedAt)))
      .returning({ id: scheduleSlots.id });
    if (res.length === 0) throw AppError.notFound('Créneau');
    await tx.execute(
      sql`update sessions set status = 'CANCELLED', cancel_reason = 'Créneau supprimé' where schedule_slot_id = ${slotId} and status = 'PLANNED' and starts_at > now()`,
    );
    await this.audit.record({
      action: 'schedule_slot.deleted',
      entityType: 'ScheduleSlot',
      entityId: slotId,
    });
  }

  private async overlapWarnings(
    tx: Db,
    course: typeof courseOfferings.$inferSelect,
    slot: { weekday: number; startTime: string; endTime: string },
  ) {
    const warnings: string[] = [];
    const sameGroup = await tx
      .select({ s: scheduleSlots, subjectName: subjects.name })
      .from(scheduleSlots)
      .innerJoin(courseOfferings, eq(courseOfferings.id, scheduleSlots.courseOfferingId))
      .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
      .where(
        and(
          eq(courseOfferings.groupId, course.groupId),
          isNull(scheduleSlots.deletedAt),
          isNull(courseOfferings.deletedAt),
          eq(scheduleSlots.weekday, slot.weekday),
        ),
      );
    for (const r of sameGroup) {
      if (
        SchedulePolicy.overlaps(slot, {
          weekday: r.s.weekday,
          startTime: r.s.startTime.slice(0, 5),
          endTime: r.s.endTime.slice(0, 5),
        })
      ) {
        warnings.push(
          `Chevauchement pour le groupe avec ${r.subjectName} (${r.s.startTime.slice(0, 5)}–${r.s.endTime.slice(0, 5)})`,
        );
      }
    }
    const teacherIds = (await this.teachersOf(tx, [course.id])).map((t) => t.staffProfileId);
    if (teacherIds.length) {
      const sameTeacher = await tx
        .select({ s: scheduleSlots, subjectName: subjects.name, groupName: groups.name })
        .from(scheduleSlots)
        .innerJoin(courseOfferings, eq(courseOfferings.id, scheduleSlots.courseOfferingId))
        .innerJoin(courseTeachers, eq(courseTeachers.courseOfferingId, courseOfferings.id))
        .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
        .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
        .where(
          and(
            inArray(courseTeachers.staffProfileId, teacherIds),
            isNull(scheduleSlots.deletedAt),
            isNull(courseOfferings.deletedAt),
            eq(scheduleSlots.weekday, slot.weekday),
            sql`${courseOfferings.id} <> ${course.id}`,
          ),
        );
      for (const r of sameTeacher) {
        if (
          SchedulePolicy.overlaps(slot, {
            weekday: r.s.weekday,
            startTime: r.s.startTime.slice(0, 5),
            endTime: r.s.endTime.slice(0, 5),
          })
        ) {
          warnings.push(
            `Chevauchement pour l'enseignant avec ${r.subjectName} · ${r.groupName} (${r.s.startTime.slice(0, 5)}–${r.s.endTime.slice(0, 5)})`,
          );
        }
      }
    }
    return warnings;
  }

  async teachersOf(tx: Db, courseIds: string[]) {
    if (courseIds.length === 0) return [];
    return tx
      .select({
        courseOfferingId: courseTeachers.courseOfferingId,
        staffProfileId: courseTeachers.staffProfileId,
        role: courseTeachers.role,
        membershipId: staffProfiles.membershipId,
        displayName: users.displayName,
      })
      .from(courseTeachers)
      .innerJoin(staffProfiles, eq(staffProfiles.id, courseTeachers.staffProfileId))
      .innerJoin(memberships, eq(memberships.id, staffProfiles.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(inArray(courseTeachers.courseOfferingId, courseIds));
  }

  private courseDto(
    c: typeof courseOfferings.$inferSelect,
    names: { subjectName: string; groupName: string },
    teachers: {
      staffProfileId: string;
      role: 'MAIN' | 'ASSISTANT';
      membershipId: string;
      displayName: string | null;
    }[],
    slots: (typeof scheduleSlots.$inferSelect)[],
  ) {
    return {
      id: c.id,
      subjectId: c.subjectId,
      subjectName: names.subjectName,
      groupId: c.groupId,
      groupName: names.groupName,
      academicYearId: c.academicYearId,
      termId: c.termId,
      label: c.label,
      teachers: teachers.map((t) => ({
        staffProfileId: t.staffProfileId,
        membershipId: t.membershipId,
        displayName: t.displayName,
        role: t.role,
      })),
      slots: slots.map((s) => ({
        id: s.id,
        weekday: s.weekday,
        startTime: s.startTime.slice(0, 5),
        endTime: s.endTime.slice(0, 5),
        room: s.room,
        validFrom: s.validFrom,
        validTo: s.validTo,
      })),
    };
  }
}
