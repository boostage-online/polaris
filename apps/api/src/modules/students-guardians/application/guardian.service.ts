import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  CreateGuardianSchema,
  GuardiansQuerySchema,
  LinkGuardianSchema,
  UnlinkGuardianSchema,
  UpdateGuardianSchema,
  UpdateLinkSchema,
} from '@polaris/contracts';
import { ENV, type Env } from '../../../config/env';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor, page } from '../../../common/http/cursor';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  academicYears,
  enrollments,
  groups,
  guardians,
  memberships,
  studentGuardians,
  students,
  tenants,
  users,
} from '../../../database/schema';
import { StructureService } from '../../academic';
import { AuditService } from '../../audit';
import { OutboxService, SMS_GATEWAY, type DomainEvent, type SmsGateway } from '../../shared';
import { GuardianPolicy, type GuardianRight } from '../domain/policies';

export const guardianLinked = (p: {
  tenantId: string;
  studentId: string;
  guardianId: string;
  linkId: string;
}): DomainEvent => ({
  type: 'GuardianLinked',
  aggregateType: 'StudentGuardian',
  aggregateId: p.linkId,
  tenantId: p.tenantId,
  payload: p,
});
export const guardianUnlinked = (p: {
  tenantId: string;
  studentId: string;
  guardianId: string;
  linkId: string;
  reason: string;
}): DomainEvent => ({
  type: 'GuardianUnlinked',
  aggregateType: 'StudentGuardian',
  aggregateId: p.linkId,
  tenantId: p.tenantId,
  payload: p,
});

@Injectable()
export class GuardianService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly structure: StructureService,
    @Inject(SMS_GATEWAY) private readonly sms: SmsGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  // ---------------------------------------------------------------- tuteurs
  async list(query: z.infer<typeof GuardiansQuerySchema>) {
    const tx = this.db.current();
    const cur = decodeCursor<{ n: string; id: string }>(query.cursor);
    const rows = await tx
      .select({ g: guardians, activated: sql<boolean>`${guardians.userId} is not null` })
      .from(guardians)
      .where(
        and(
          isNull(guardians.deletedAt),
          query.q
            ? or(
                ilike(sql`${guardians.lastName} || ' ' || ${guardians.firstName}`, `%${query.q}%`),
                ilike(guardians.phoneE164, `%${query.q.replace(/\s/g, '')}%`),
              )
            : undefined,
          query.activated === undefined
            ? undefined
            : query.activated
              ? sql`${guardians.userId} is not null`
              : isNull(guardians.userId),
          cur
            ? sql`(${guardians.lastName} || ' ' || ${guardians.firstName}, ${guardians.id}) > (${cur.n}, ${cur.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(sql`${guardians.lastName} || ' ' || ${guardians.firstName}`), asc(guardians.id))
      .limit(query.limit + 1);
    return page(
      rows.map((r) => this.dto(r.g)),
      query.limit,
      (last) => ({ n: `${last.lastName} ${last.firstName}`, id: last.id }),
    );
  }

  async get(id: string) {
    const tx = this.db.current();
    const g = await tx.query.guardians.findFirst({
      where: and(eq(guardians.id, id), isNull(guardians.deletedAt)),
    });
    if (!g) throw AppError.notFound('Tuteur');
    const links = await this.linksOf(tx, { guardianId: id });
    return { ...this.dto(g), links };
  }

  /** Crée ou réutilise un tuteur par téléphone (le téléphone est l'identité du parent). */
  async createOrReuse(input: z.infer<typeof CreateGuardianSchema>, tx: Db = this.db.current()) {
    const existing = await tx.query.guardians.findFirst({
      where: and(eq(guardians.phoneE164, input.phone), isNull(guardians.deletedAt)),
    });
    if (existing) return { guardian: existing, created: false };
    const id = randomUUID();
    await tx.insert(guardians).values({
      id,
      tenantId: this.tenantId,
      userId: null,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phoneE164: input.phone,
      email: input.email ?? null,
      preferredChannel: input.preferredChannel,
      locale: 'fr',
      invitedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Si un compte utilisateur porte déjà ce téléphone (parent dans un autre établissement), on le rattache.
    const user = await tx.query.users.findFirst({ where: eq(users.phoneE164, input.phone) });
    if (user) await tx.update(guardians).set({ userId: user.id }).where(eq(guardians.id, id));
    await this.audit.record({
      action: 'guardian.created',
      entityType: 'Guardian',
      entityId: id,
      after: { ...input },
    });
    return {
      guardian: (await tx.query.guardians.findFirst({ where: eq(guardians.id, id) }))!,
      created: true,
    };
  }

  async create(input: z.infer<typeof CreateGuardianSchema>) {
    const { guardian, created } = await this.createOrReuse(input);
    if (!created)
      throw AppError.conflict('Un tuteur avec ce téléphone existe déjà', 'CONFLICT', {
        guardianId: guardian.id,
      });
    return this.get(guardian.id);
  }

  async update(id: string, patch: z.infer<typeof UpdateGuardianSchema>) {
    const tx = this.db.current();
    const before = await tx.query.guardians.findFirst({
      where: and(eq(guardians.id, id), isNull(guardians.deletedAt)),
    });
    if (!before) throw AppError.notFound('Tuteur');
    try {
      await tx
        .update(guardians)
        .set({
          firstName: patch.firstName,
          lastName: patch.lastName,
          phoneE164: patch.phone,
          email: patch.email,
          preferredChannel: patch.preferredChannel,
        })
        .where(eq(guardians.id, id));
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw AppError.conflict('Ce téléphone est déjà utilisé par un autre tuteur');
      throw e;
    }
    const afterRow = (await tx.query.guardians.findFirst({ where: eq(guardians.id, id) }))!;
    await this.audit.record({
      action: 'guardian.updated',
      entityType: 'Guardian',
      entityId: id,
      before: this.dto(before),
      after: this.dto(afterRow),
    });
    return this.get(id);
  }

  /**
   * Invitation : crée le compte (téléphone) et l'appartenance GUARDIAN s'ils manquent, puis envoie le SMS.
   * L'activation réelle = première connexion par OTP (identité). Appelée hors transaction pour le SMS.
   */
  async invite(guardianId: string) {
    const { phone, name, tenantName } = await this.db.withTenantTx(this.tenantId, async (tx) => {
      const g = await tx.query.guardians.findFirst({
        where: and(eq(guardians.id, guardianId), isNull(guardians.deletedAt)),
      });
      if (!g) throw AppError.notFound('Tuteur');
      const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
      let userId = g.userId;
      if (!userId) {
        const existing = await tx.query.users.findFirst({
          where: eq(users.phoneE164, g.phoneE164),
        });
        if (existing) userId = existing.id;
        else {
          userId = randomUUID();
          await tx.insert(users).values({
            id: userId,
            email: null,
            phoneE164: g.phoneE164,
            passwordHash: null,
            displayName: `${g.firstName} ${g.lastName}`,
            status: 'ACTIVE',
            mfaEnabled: false,
            tokenVersion: 0,
            locale: g.locale,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        await tx.update(guardians).set({ userId }).where(eq(guardians.id, g.id));
      }
      const m = await tx.query.memberships.findFirst({
        where: and(eq(memberships.userId, userId), eq(memberships.tenantId, this.tenantId)),
      });
      if (!m) {
        await tx.insert(memberships).values({
          id: randomUUID(),
          userId,
          tenantId: this.tenantId,
          kind: 'GUARDIAN',
          status: 'ACTIVE',
          permissionsVersion: 1,
          invitedBy: RequestContextStore.require().actor?.userId ?? null,
          acceptedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      await tx.update(guardians).set({ invitedAt: new Date() }).where(eq(guardians.id, g.id));
      await this.audit.record({
        action: 'guardian.invited',
        entityType: 'Guardian',
        entityId: g.id,
        after: { phone: g.phoneE164 },
      });
      return { phone: g.phoneE164, name: g.firstName, tenantName: tenant.name };
    });
    await this.sms.send({
      to: phone,
      body: `${name}, ${tenantName} vous a ouvert un accès Polaris pour suivre vos enfants. Connectez-vous avec ce numéro sur ${this.env.WEB_ORIGIN}/login`,
      reference: `guardian-invite:${guardianId}`,
    });
    return { invited: true };
  }

  // ---------------------------------------------------------------- liens parent-enfant
  async linksOf(tx: Db, by: { studentId?: string; guardianId?: string }) {
    const rows = await tx
      .select({ l: studentGuardians, s: students, g: guardians })
      .from(studentGuardians)
      .innerJoin(students, eq(students.id, studentGuardians.studentId))
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(
        and(
          isNull(studentGuardians.unlinkedAt),
          by.studentId ? eq(studentGuardians.studentId, by.studentId) : undefined,
          by.guardianId ? eq(studentGuardians.guardianId, by.guardianId) : undefined,
        ),
      )
      .orderBy(desc(studentGuardians.isPrimary), asc(studentGuardians.linkedAt));
    return rows.map((r) => this.linkDto(r.l, r.s, r.g));
  }

  async link(studentId: string, input: z.infer<typeof LinkGuardianSchema>) {
    const tx = this.db.current();
    const student = await tx.query.students.findFirst({
      where: and(eq(students.id, studentId), isNull(students.deletedAt)),
    });
    if (!student) throw AppError.notFound('Élève');
    let guardianId = input.guardianId;
    if (!guardianId) {
      const { guardian } = await this.createOrReuse(input.guardian!, tx);
      guardianId = guardian.id;
    } else {
      const g = await tx.query.guardians.findFirst({
        where: and(eq(guardians.id, guardianId), isNull(guardians.deletedAt)),
      });
      if (!g) throw AppError.validation([{ path: 'guardianId', message: 'Tuteur inconnu' }]);
    }
    const id = randomUUID();
    if (input.isPrimary)
      await tx
        .update(studentGuardians)
        .set({ isPrimary: false })
        .where(and(eq(studentGuardians.studentId, studentId), isNull(studentGuardians.unlinkedAt)));
    try {
      await tx.insert(studentGuardians).values({
        id,
        tenantId: this.tenantId,
        studentId,
        guardianId,
        relationship: input.relationship,
        isPrimary: input.isPrimary,
        canViewAttendance: input.canViewAttendance,
        canViewFinance: input.canViewFinance,
        canPay: input.canPay,
        canJustify: input.canJustify,
        linkedBy: RequestContextStore.require().actor?.userId ?? null,
        linkedAt: new Date(),
        unlinkedAt: null,
        unlinkedBy: null,
        unlinkReason: null,
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw AppError.conflict('Ce tuteur est déjà lié à cet élève');
      throw e;
    }
    await this.audit.record({
      action: 'guardian.linked',
      entityType: 'StudentGuardian',
      entityId: id,
      after: {
        studentId,
        guardianId,
        relationship: input.relationship,
        isPrimary: input.isPrimary,
        canViewAttendance: input.canViewAttendance,
        canViewFinance: input.canViewFinance,
        canPay: input.canPay,
        canJustify: input.canJustify,
      },
    });
    await this.outbox.publish(
      guardianLinked({ tenantId: this.tenantId, studentId, guardianId, linkId: id }),
    );
    return (await this.linksOf(tx, { studentId })).find((l) => l.id === id)!;
  }

  async updateLink(linkId: string, patch: z.infer<typeof UpdateLinkSchema>) {
    const tx = this.db.current();
    const before = await tx.query.studentGuardians.findFirst({
      where: and(eq(studentGuardians.id, linkId), isNull(studentGuardians.unlinkedAt)),
    });
    if (!before) throw AppError.notFound('Lien');
    if (patch.isPrimary)
      await tx
        .update(studentGuardians)
        .set({ isPrimary: false })
        .where(
          and(
            eq(studentGuardians.studentId, before.studentId),
            isNull(studentGuardians.unlinkedAt),
          ),
        );
    await tx
      .update(studentGuardians)
      .set({ ...patch })
      .where(eq(studentGuardians.id, linkId));
    const after = (await this.linksOf(tx, { studentId: before.studentId })).find(
      (l) => l.id === linkId,
    )!;
    await this.audit.record({
      action: 'guardian.link_updated',
      entityType: 'StudentGuardian',
      entityId: linkId,
      before: {
        relationship: before.relationship,
        isPrimary: before.isPrimary,
        canViewAttendance: before.canViewAttendance,
        canViewFinance: before.canViewFinance,
        canPay: before.canPay,
        canJustify: before.canJustify,
      },
      after: patch,
    });
    return after;
  }

  async unlink(linkId: string, input: z.infer<typeof UnlinkGuardianSchema>) {
    const tx = this.db.current();
    const before = await tx.query.studentGuardians.findFirst({
      where: and(eq(studentGuardians.id, linkId), isNull(studentGuardians.unlinkedAt)),
    });
    if (!before) throw AppError.notFound('Lien');
    await tx
      .update(studentGuardians)
      .set({
        unlinkedAt: new Date(),
        unlinkedBy: RequestContextStore.require().actor?.userId ?? null,
        unlinkReason: input.reason,
      })
      .where(eq(studentGuardians.id, linkId));
    await this.audit.record({
      action: 'guardian.unlinked',
      entityType: 'StudentGuardian',
      entityId: linkId,
      before: { studentId: before.studentId, guardianId: before.guardianId },
      after: { reason: input.reason },
    });
    await this.outbox.publish(
      guardianUnlinked({
        tenantId: this.tenantId,
        studentId: before.studentId,
        guardianId: before.guardianId,
        linkId,
        reason: input.reason,
      }),
    );
  }

  // ---------------------------------------------------------------- côté parent
  /** Le tuteur de l'acteur courant (membership GUARDIAN) dans le tenant courant. */
  async guardianOfActor(tx: Db) {
    const actor = RequestContextStore.require().actor;
    if (!actor || actor.kind !== 'GUARDIAN') throw AppError.notFound();
    const g = await tx.query.guardians.findFirst({
      where: and(eq(guardians.userId, actor.userId), isNull(guardians.deletedAt)),
    });
    if (!g) throw AppError.notFound();
    return g;
  }

  async myChildren() {
    const tx = this.db.current();
    const g = await this.guardianOfActor(tx);
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
    const year = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    const rows = await tx
      .select({ l: studentGuardians, s: students })
      .from(studentGuardians)
      .innerJoin(students, eq(students.id, studentGuardians.studentId))
      .where(
        and(
          eq(studentGuardians.guardianId, g.id),
          isNull(studentGuardians.unlinkedAt),
          isNull(students.deletedAt),
        ),
      )
      .orderBy(asc(students.firstName));
    const studentIds = rows.map((r) => r.s.id);
    const current =
      year && studentIds.length
        ? await tx
            .select({
              studentId: enrollments.studentId,
              groupId: groups.id,
              groupName: groups.name,
            })
            .from(enrollments)
            .innerJoin(groups, eq(groups.id, enrollments.groupId))
            .where(
              and(
                inArray(enrollments.studentId, studentIds),
                eq(enrollments.academicYearId, year.id),
                eq(enrollments.isPrimary, true),
                isNull(enrollments.leftAt),
              ),
            )
        : [];
    return rows.map((r) => {
      const grp = current.find((c) => c.studentId === r.s.id);
      return {
        linkId: r.l.id,
        student: {
          id: r.s.id,
          firstName: r.s.firstName,
          lastName: r.s.lastName,
          matricule: r.s.matricule,
          status: r.s.status,
        },
        tenant: { id: tenant.id, name: tenant.name, code: tenant.code },
        currentGroup: grp ? { id: grp.groupId, name: grp.groupName } : null,
        relationship: r.l.relationship,
        rights: {
          attendance: r.l.canViewAttendance,
          finance: r.l.canViewFinance,
          pay: r.l.canPay && r.l.canViewFinance,
          justify: r.l.canJustify && r.l.canViewAttendance,
        },
      };
    });
  }

  /** Garde de portée réutilisable par les modules suivants (assiduité, finance). 404 si pas de droit. */
  async assertGuardianAccess(studentId: string, right: GuardianRight, tx: Db = this.db.current()) {
    const g = await this.guardianOfActor(tx);
    const link = await tx.query.studentGuardians.findFirst({
      where: and(
        eq(studentGuardians.guardianId, g.id),
        eq(studentGuardians.studentId, studentId),
        isNull(studentGuardians.unlinkedAt),
      ),
    });
    if (!GuardianPolicy.canAccess(link ?? null, right)) throw AppError.notFound('Élève');
    return link!;
  }

  // ---------------------------------------------------------------- dto
  dto(g: typeof guardians.$inferSelect) {
    return {
      id: g.id,
      firstName: g.firstName,
      lastName: g.lastName,
      phone: g.phoneE164,
      email: g.email,
      preferredChannel: g.preferredChannel,
      activated: g.userId !== null,
      invitedAt: g.invitedAt ? g.invitedAt.toISOString() : null,
    };
  }
  private linkDto(
    l: typeof studentGuardians.$inferSelect,
    s: typeof students.$inferSelect,
    g: typeof guardians.$inferSelect,
  ) {
    return {
      id: l.id,
      studentId: l.studentId,
      guardianId: l.guardianId,
      relationship: l.relationship,
      isPrimary: l.isPrimary,
      canViewAttendance: l.canViewAttendance,
      canViewFinance: l.canViewFinance,
      canPay: l.canPay,
      canJustify: l.canJustify,
      linkedAt: l.linkedAt.toISOString(),
      student: { id: s.id, firstName: s.firstName, lastName: s.lastName, matricule: s.matricule },
      guardian: {
        id: g.id,
        firstName: g.firstName,
        lastName: g.lastName,
        phone: g.phoneE164,
        activated: g.userId !== null,
      },
    };
  }
}
