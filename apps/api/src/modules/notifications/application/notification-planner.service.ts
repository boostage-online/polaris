import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../database/database.service';
import type { Db } from '../../../database/request-context';
import {
  attendanceSheets,
  courseOfferings,
  courseTeachers,
  groups,
  guardians,
  memberships,
  membershipRoles,
  notificationPreferences,
  notifications,
  rolePermissions,
  sessions,
  staffProfiles,
  studentGuardians,
  students,
  subjects,
  tenants,
  users,
  type NotificationChannel,
} from '../../../database/schema';
import { AttendanceEvents, rulesFrom, type MarkedStudent } from '../../attendance';
import { BillingEvents, type ReminderItem } from '../../billing';
import { PaymentEvents } from '../../payments';
import { EMAIL_GATEWAY, SMS_GATEWAY, type EmailGateway, type SmsGateway } from '../../shared';
import {
  Templates,
  resolveChannels,
  type NotificationKind,
  type Rendered,
} from '../domain/templates';

/** Événement tel que le worker le livre (structure identique à `QueuedEvent` du worker). */
export interface IncomingEvent {
  id: string;
  type: string;
  tenantId: string | null;
  aggregateType: string;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

interface Recipient {
  userId: string;
  phone: string | null;
  email: string | null;
}
interface Draft {
  kind: NotificationKind;
  recipient: Recipient;
  studentId: string | null;
  rendered: Rendered;
  payload: Record<string, unknown>;
  preferred?: NotificationChannel[];
}

/**
 * Moteur de notifications (P3-E5) : un événement → N notifications (destinataire × canal), créées QUEUED
 * de façon idempotente (contrainte UNIQUE événement/destinataire/canal) puis envoyées. Rejouable sans doublon.
 */
@Injectable()
export class NotificationPlanner {
  private readonly logger = new Logger(NotificationPlanner.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(SMS_GATEWAY) private readonly sms: SmsGateway,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
  ) {}

  readonly handledTypes: readonly string[] = [
    AttendanceEvents.AttendanceSheetSubmitted,
    AttendanceEvents.JustificationSubmitted,
    AttendanceEvents.JustificationReviewed,
    AttendanceEvents.RepeatedAbsencesDetected,
    BillingEvents.PaymentRecorded,
    BillingEvents.PaymentReversed,
    BillingEvents.InstallmentsDueSoon,
    BillingEvents.InstallmentsOverdue,
    BillingEvents.LedgerIntegrityMismatch,
    PaymentEvents.PaymentAttemptFailed,
    PaymentEvents.PaymentReviewNeeded,
  ];

  /** Point d'entrée du worker : planifie puis envoie, dans le tenant de l'événement. */
  async handle(event: IncomingEvent) {
    if (!event.tenantId) return;
    const tenantId = event.tenantId;
    await this.db.withTenantTx(tenantId, async (tx) => {
      const drafts = await this.plan(tx, event);
      await this.enqueue(tx, tenantId, event.id, drafts);
    });
    await this.dispatch(tenantId);
  }

  // ---------------------------------------------------------------- planification
  private async plan(tx: Db, event: IncomingEvent): Promise<Draft[]> {
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, event.tenantId!) }))!;
    const tz = tenant.timezone;
    switch (event.type) {
      case AttendanceEvents.AttendanceSheetSubmitted: {
        const p = event.payload as {
          startsAt: string;
          subjectName: string;
          marked: MarkedStudent[];
        };
        if (p.marked.length === 0) return [];
        const studentIds = p.marked.map((m) => m.studentId);
        const names = await this.studentNames(tx, studentIds);
        const links = await this.guardiansOf(tx, studentIds, 'attendance');
        // Agrégation : un message par tuteur listant tous ses enfants concernés par cet appel.
        const byGuardian = new Map<string, { recipient: Recipient; marks: MarkedStudent[] }>();
        for (const l of links) {
          const e = byGuardian.get(l.recipient.userId) ?? { recipient: l.recipient, marks: [] };
          const mark = p.marked.find((m) => m.studentId === l.studentId);
          if (mark) e.marks.push(mark);
          byGuardian.set(l.recipient.userId, e);
        }
        return [...byGuardian.values()].map(({ recipient, marks }) => {
          const anyAbsent = marks.some((m) => m.status === 'ABSENT');
          return {
            kind: anyAbsent ? 'STUDENT_ABSENT' : 'STUDENT_LATE',
            recipient,
            studentId: marks.length === 1 ? marks[0]!.studentId : null,
            rendered: Templates.attendanceMarked({
              tenantName: tenant.name,
              startsAt: p.startsAt,
              tz,
              children: marks.map((m) => ({
                firstName: names.get(m.studentId) ?? 'Votre enfant',
                status: m.status,
                lateMinutes: m.lateMinutes,
                subjectName: p.subjectName,
              })),
            }),
            payload: { sessionStartsAt: p.startsAt, students: marks.map((m) => m.studentId) },
          } satisfies Draft;
        });
      }
      case AttendanceEvents.JustificationSubmitted: {
        const p = event.payload as {
          studentId: string;
          fromDate: string;
          toDate: string;
          submittedByKind: 'STAFF' | 'GUARDIAN';
        };
        if (p.submittedByKind !== 'GUARDIAN') return [];
        const s = await this.student(tx, p.studentId);
        const staff = await this.membersWithPermission(tx, 'REVIEW_JUSTIFICATION');
        return staff.map((recipient) => ({
          kind: 'JUSTIFICATION_SUBMITTED',
          recipient,
          studentId: p.studentId,
          rendered: Templates.justificationSubmitted({
            firstName: s.firstName,
            lastName: s.lastName,
            fromDate: p.fromDate,
            toDate: p.toDate,
            byGuardian: true,
          }),
          payload: { justificationId: event.aggregateId },
        }));
      }
      case AttendanceEvents.JustificationReviewed: {
        const p = event.payload as {
          studentId: string;
          decision: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED';
          comment: string | null;
          submittedBy: string | null;
          fromDate: string;
          toDate: string;
        };
        const s = await this.student(tx, p.studentId);
        // Destinataire : l'auteur s'il est tuteur ; sinon les tuteurs ayant la vue assiduité.
        const links = await this.guardiansOf(tx, [p.studentId], 'attendance');
        const targets = p.submittedBy
          ? links.filter((l) => l.recipient.userId === p.submittedBy)
          : links;
        const rendered = Templates.justificationReviewed({
          firstName: s.firstName,
          decision: p.decision,
          comment: p.comment,
          fromDate: p.fromDate,
          toDate: p.toDate,
        });
        return dedupe(targets.map((l) => l.recipient)).map((recipient) => ({
          kind: 'JUSTIFICATION_REVIEWED',
          recipient,
          studentId: p.studentId,
          rendered,
          payload: { justificationId: event.aggregateId, decision: p.decision },
        }));
      }
      case AttendanceEvents.RepeatedAbsencesDetected: {
        const p = event.payload as {
          studentId: string;
          count: number;
          windowFrom: string;
          windowTo: string;
        };
        const s = await this.student(tx, p.studentId);
        const rules = rulesFrom(tenant.settings);
        const staff = await this.membersWithPermission(tx, 'REVIEW_JUSTIFICATION');
        const links = await this.guardiansOf(tx, [p.studentId], 'attendance');
        const primary = links.find((l) => l.isPrimary) ?? links[0];
        const drafts: Draft[] = staff.map((recipient) => ({
          kind: 'REPEATED_ABSENCES',
          recipient,
          studentId: p.studentId,
          rendered: Templates.repeatedAbsences({
            firstName: s.firstName,
            lastName: s.lastName,
            count: p.count,
            windowDays: rules.repeatedAbsenceWindowDays,
            forGuardian: false,
          }),
          payload: { alertId: event.aggregateId },
          preferred: ['INAPP'],
        }));
        if (primary)
          drafts.push({
            kind: 'REPEATED_ABSENCES',
            recipient: primary.recipient,
            studentId: p.studentId,
            rendered: Templates.repeatedAbsences({
              firstName: s.firstName,
              lastName: s.lastName,
              count: p.count,
              windowDays: rules.repeatedAbsenceWindowDays,
              forGuardian: true,
            }),
            payload: { alertId: event.aggregateId },
          });
        return drafts;
      }
      case BillingEvents.PaymentRecorded:
      case BillingEvents.PaymentReversed: {
        const p = event.payload as {
          studentId: string;
          amount: number;
          receiptNumber: string;
          credit?: number;
        };
        const s = await this.student(tx, p.studentId);
        const links = await this.guardiansOf(tx, [p.studentId], 'finance');
        const rendered =
          event.type === BillingEvents.PaymentRecorded
            ? Templates.paymentReceived({
                tenantName: tenant.name,
                firstName: s.firstName,
                amount: p.amount,
                receiptNumber: p.receiptNumber,
                credit: p.credit ?? 0,
              })
            : Templates.paymentReversed({
                tenantName: tenant.name,
                firstName: s.firstName,
                amount: p.amount,
                receiptNumber: p.receiptNumber,
              });
        return dedupe(links.map((l) => l.recipient)).map((recipient) => ({
          kind:
            event.type === BillingEvents.PaymentRecorded
              ? ('PAYMENT_RECEIVED' as const)
              : ('PAYMENT_REVERSED' as const),
          recipient,
          studentId: p.studentId,
          rendered,
          payload: { paymentId: event.aggregateId, amount: p.amount },
        }));
      }
      case BillingEvents.InstallmentsDueSoon:
      case BillingEvents.InstallmentsOverdue: {
        const p = event.payload as { items: ReminderItem[]; message?: string };
        if (p.items.length === 0) return [];
        const kind =
          event.type === BillingEvents.InstallmentsDueSoon
            ? ('INSTALLMENT_DUE_SOON' as const)
            : ('INSTALLMENT_OVERDUE' as const);
        const studentIds = [...new Set(p.items.map((i) => i.studentId))];
        const names = await this.studentNames(tx, studentIds);
        const links = await this.guardiansOf(tx, studentIds, 'finance');
        // Un message par tuteur, toutes les échéances de ses enfants (plafond : 1 SMS par tuteur et par jour sur ce sujet).
        const byGuardian = new Map<string, { recipient: Recipient; items: ReminderItem[] }>();
        for (const l of links) {
          const e = byGuardian.get(l.recipient.userId) ?? { recipient: l.recipient, items: [] };
          for (const it of p.items.filter((i) => i.studentId === l.studentId)) e.items.push(it);
          byGuardian.set(l.recipient.userId, e);
        }
        return [...byGuardian.values()].map(({ recipient, items }) => ({
          kind,
          recipient,
          studentId: items.length === 1 ? items[0]!.studentId : null,
          rendered: Templates.installmentsReminder({
            tenantName: tenant.name,
            kind: kind === 'INSTALLMENT_DUE_SOON' ? 'DUE_SOON' : 'OVERDUE',
            items: items.map((i) => ({
              firstName: names.get(i.studentId) ?? 'votre enfant',
              amount: i.amount,
              dueDate: i.dueDate,
              label: i.label,
            })),
            message: p.message,
          }),
          payload: { installments: items.map((i) => i.installmentId) },
        }));
      }
      case BillingEvents.LedgerIntegrityMismatch: {
        const p = event.payload as { mismatches: number };
        const staff = await this.membersWithPermission(tx, 'VIEW_FINANCIAL_REPORTS');
        return staff.map((recipient) => ({
          kind: 'LEDGER_INTEGRITY' as const,
          recipient,
          studentId: null,
          rendered: Templates.ledgerIntegrity({ mismatches: p.mismatches }),
          payload: { checkId: event.aggregateId },
        }));
      }
      case PaymentEvents.PaymentAttemptFailed: {
        const p = event.payload as {
          studentId: string;
          payerUserId: string | null;
          amount: number;
          status: 'FAILED' | 'CANCELLED' | 'EXPIRED';
        };
        const s = await this.student(tx, p.studentId);
        // Au payeur s'il est connu, sinon aux tuteurs avec le droit finance.
        const links = await this.guardiansOf(tx, [p.studentId], 'finance');
        const recipients = dedupe(links.map((l) => l.recipient)).filter(
          (r) => !p.payerUserId || r.userId === p.payerUserId,
        );
        const rendered = Templates.paymentFailed({
          tenantName: tenant.name,
          firstName: s.firstName,
          amount: p.amount,
          status: p.status,
        });
        return recipients.map((recipient) => ({
          kind: 'PAYMENT_FAILED' as const,
          recipient,
          studentId: p.studentId,
          rendered,
          payload: { attemptId: event.aggregateId, status: p.status },
        }));
      }
      case PaymentEvents.PaymentReviewNeeded: {
        const p = event.payload as {
          reason: 'UNKNOWN_STATUS' | 'AMOUNT_MISMATCH' | 'ORPHAN_TRANSACTION' | 'PROVIDER_MUTE';
          amount: number | null;
          externalId: string | null;
        };
        const staff = await this.membersWithPermission(tx, 'VIEW_PAYMENTS');
        return staff.map((recipient) => ({
          kind: 'PAYMENT_REVIEW_NEEDED' as const,
          recipient,
          studentId: null,
          rendered: Templates.paymentReviewNeeded(p),
          payload: { attemptId: event.aggregateId, reason: p.reason },
        }));
      }
      default:
        return [];
    }
  }

  /** Appels manquants (cron horaire) : séances terminées depuis 2 h sans feuille soumise → in-app aux enseignants. */
  async planMissingSheets(tenantId: string) {
    let created = 0;
    await this.db.withTenantTx(tenantId, async (tx) => {
      const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
      const now = Date.now();
      const rows = await tx
        .select({
          s: sessions,
          subjectName: subjects.name,
          groupName: groups.name,
          sheetStatus: attendanceSheets.status,
        })
        .from(sessions)
        .innerJoin(courseOfferings, eq(courseOfferings.id, sessions.courseOfferingId))
        .innerJoin(subjects, eq(subjects.id, courseOfferings.subjectId))
        .innerJoin(groups, eq(groups.id, courseOfferings.groupId))
        .leftJoin(attendanceSheets, eq(attendanceSheets.sessionId, sessions.id))
        .where(
          and(
            lt(sessions.endsAt, new Date(now - 2 * 3_600_000)),
            gte(sessions.endsAt, new Date(now - 26 * 3_600_000)),
            eq(sessions.status, 'PLANNED'),
            isNull(attendanceSheets.submittedAt),
          ),
        );
      for (const r of rows) {
        const teachers = await tx
          .select({ userId: memberships.userId, phone: users.phoneE164, email: users.email })
          .from(courseTeachers)
          .innerJoin(staffProfiles, eq(staffProfiles.id, courseTeachers.staffProfileId))
          .innerJoin(memberships, eq(memberships.id, staffProfiles.membershipId))
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(eq(courseTeachers.courseOfferingId, r.s.courseOfferingId));
        const rendered = Templates.sheetMissing({
          subjectName: r.subjectName,
          groupName: r.groupName,
          startsAt: r.s.startsAt.toISOString(),
          tz: tenant.timezone,
          sessionId: r.s.id,
        });
        created += await this.enqueue(
          tx,
          tenantId,
          `missing:${r.s.id}`,
          teachers.map((t) => ({
            kind: 'ATTENDANCE_SHEET_MISSING' as const,
            recipient: t,
            studentId: null,
            rendered,
            payload: { sessionId: r.s.id },
            preferred: ['INAPP' as const],
          })),
        );
      }
    });
    if (created > 0) await this.dispatch(tenantId);
    return created;
  }

  // ---------------------------------------------------------------- création idempotente
  private async enqueue(tx: Db, tenantId: string, eventId: string, drafts: Draft[]) {
    if (drafts.length === 0) return 0;
    const userIds = [...new Set(drafts.map((d) => d.recipient.userId))];
    const prefRows = await tx
      .select()
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, userIds));
    const prefs = new Map(prefRows.map((p) => [`${p.userId}:${p.kind}`, p.channels]));
    const values: (typeof notifications.$inferInsert)[] = [];
    for (const d of drafts) {
      const channels = resolveChannels(
        d.kind,
        d.preferred ?? prefs.get(`${d.recipient.userId}:${d.kind}`),
      );
      for (const channel of channels) {
        const address =
          channel === 'SMS' ? d.recipient.phone : channel === 'EMAIL' ? d.recipient.email : null;
        if ((channel === 'SMS' || channel === 'EMAIL') && !address) continue;
        values.push({
          id: randomUUID(),
          tenantId,
          eventId,
          kind: d.kind,
          channel,
          status: 'QUEUED',
          recipientUserId: d.recipient.userId,
          recipientAddress: address,
          studentId: d.studentId,
          title: d.rendered.title,
          body: d.rendered.body,
          actionUrl: d.rendered.actionUrl,
          payload: d.payload,
          providerMessageId: null,
          error: null,
          attempts: 0,
          createdAt: new Date(),
          sentAt: null,
          deliveredAt: null,
          readAt: null,
        });
      }
    }
    if (values.length === 0) return 0;
    const inserted = await tx
      .insert(notifications)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    return inserted.length;
  }

  // ---------------------------------------------------------------- envoi
  /** Envoie les notifications QUEUED du tenant : in-app immédiat, SMS/e-mail via les passerelles, quota SMS mensuel. */
  async dispatch(tenantId: string) {
    const queued = await this.db.withTenantTx(tenantId, (tx) =>
      tx.query.notifications.findMany({
        where: eq(notifications.status, 'QUEUED'),
        orderBy: (n, { asc }) => [asc(n.createdAt)],
        limit: 200,
      }),
    );
    if (queued.length === 0) return;
    const { cap, sent } = await this.smsUsage(tenantId);
    let smsSent = sent;
    for (const n of queued) {
      let patch: Partial<typeof notifications.$inferInsert>;
      try {
        if (n.channel === 'INAPP') patch = { status: 'SENT', sentAt: new Date() };
        else if (n.channel === 'SMS') {
          if (smsSent >= cap)
            patch = { status: 'SUPPRESSED', error: `Quota SMS mensuel atteint (${cap})` };
          else {
            const r = await this.sms.send({
              to: n.recipientAddress!,
              body: n.body,
              reference: `notif:${n.id}`,
            });
            smsSent++;
            patch = { status: 'SENT', sentAt: new Date(), providerMessageId: r.providerMessageId };
          }
        } else if (n.channel === 'EMAIL') {
          const r = await this.email.send({
            to: n.recipientAddress!,
            subject: n.title,
            text: n.body,
            reference: `notif:${n.id}`,
          });
          patch = { status: 'SENT', sentAt: new Date(), providerMessageId: r.providerMessageId };
        } else patch = { status: 'SUPPRESSED', error: 'Canal non disponible' };
      } catch (e) {
        patch = { status: 'FAILED', error: (e as Error).message.slice(0, 500) };
        this.logger.warn({
          msg: 'notification send failed',
          id: n.id,
          channel: n.channel,
          err: (e as Error).message,
        });
      }
      await this.db.withTenantTx(tenantId, (tx) =>
        tx
          .update(notifications)
          .set({ ...patch, attempts: n.attempts + 1 })
          .where(eq(notifications.id, n.id)),
      );
    }
    if (cap > 0 && smsSent >= Math.ceil(cap * 0.8) && sent < Math.ceil(cap * 0.8))
      await this.warnSmsCap(tenantId, smsSent, cap);
  }

  /** Consommation SMS du mois courant et plafond du tenant (`settings.notifications.smsMonthlyCap`, défaut 2000). */
  async smsUsage(tenantId: string) {
    return this.db.withTenantTx(tenantId, async (tx) => {
      const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
      const cap = Number(
        (tenant.settings['notifications'] as { smsMonthlyCap?: number } | undefined)
          ?.smsMonthlyCap ?? 2000,
      );
      const month = new Date().toISOString().slice(0, 7);
      const r = await tx
        .select({
          sent: sql<number>`count(*) filter (where ${notifications.status} in ('SENT','DELIVERED'))::int`,
          suppressed: sql<number>`count(*) filter (where ${notifications.status} = 'SUPPRESSED')::int`,
          failed: sql<number>`count(*) filter (where ${notifications.status} = 'FAILED')::int`,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.channel, 'SMS'),
            gte(notifications.createdAt, new Date(`${month}-01T00:00:00Z`)),
          ),
        );
      return {
        month,
        cap,
        sent: r[0]?.sent ?? 0,
        suppressed: r[0]?.suppressed ?? 0,
        failed: r[0]?.failed ?? 0,
      };
    });
  }

  private async warnSmsCap(tenantId: string, sent: number, cap: number) {
    const month = new Date().toISOString().slice(0, 7);
    await this.db.withTenantTx(tenantId, async (tx) => {
      const admins = await this.membersWithPermission(tx, 'MANAGE_TENANT_SETTINGS');
      const rendered = Templates.smsCapWarning({ sent, cap, month });
      await this.enqueue(
        tx,
        tenantId,
        `smscap:${month}`,
        admins.map((recipient) => ({
          kind: 'SMS_CAP_WARNING' as const,
          recipient,
          studentId: null,
          rendered,
          payload: { sent, cap },
        })),
      );
    });
    // Les lignes créées partent au prochain passage (évite la récursion dans dispatch).
  }

  // ---------------------------------------------------------------- résolveurs de destinataires
  /** Tuteurs d'élèves ayant le droit demandé et un compte utilisateur (invités). */
  private async guardiansOf(tx: Db, studentIds: string[], right: 'attendance' | 'finance') {
    if (studentIds.length === 0) return [];
    const rows = await tx
      .select({
        studentId: studentGuardians.studentId,
        isPrimary: studentGuardians.isPrimary,
        userId: guardians.userId,
        phone: guardians.phoneE164,
        email: guardians.email,
        userPhone: users.phoneE164,
        userEmail: users.email,
      })
      .from(studentGuardians)
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .innerJoin(users, eq(users.id, guardians.userId))
      .where(
        and(
          inArray(studentGuardians.studentId, studentIds),
          isNull(studentGuardians.unlinkedAt),
          isNull(guardians.deletedAt),
          eq(
            right === 'attendance'
              ? studentGuardians.canViewAttendance
              : studentGuardians.canViewFinance,
            true,
          ),
        ),
      );
    return rows
      .filter((r) => r.userId !== null)
      .map((r) => ({
        studentId: r.studentId,
        isPrimary: r.isPrimary,
        recipient: {
          userId: r.userId!,
          phone: r.phone || r.userPhone,
          email: r.email ?? r.userEmail,
        },
      }));
  }

  /** Membres actifs du tenant dont un rôle porte la permission. */
  private async membersWithPermission(tx: Db, permission: string): Promise<Recipient[]> {
    const rows = await tx
      .selectDistinct({ userId: memberships.userId, phone: users.phoneE164, email: users.email })
      .from(membershipRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, membershipRoles.roleId))
      .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(rolePermissions.permissionCode, permission), eq(memberships.status, 'ACTIVE')));
    return rows;
  }

  private async studentNames(tx: Db, ids: string[]) {
    const rows = await tx
      .select({ id: students.id, firstName: students.firstName })
      .from(students)
      .where(inArray(students.id, ids));
    return new Map(rows.map((r) => [r.id, r.firstName]));
  }
  private async student(tx: Db, id: string) {
    const s = await tx.query.students.findFirst({ where: eq(students.id, id) });
    return s ?? { firstName: 'Élève', lastName: '' };
  }
}

function dedupe(rs: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of rs) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    out.push(r);
  }
  return out;
}
