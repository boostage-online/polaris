import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { NotificationTrace, SheetTrace } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { auditLogs, notifications, users } from '../../../database/schema';

/**
 * Écrans de traçabilité (Partie 11, « sans jointure sur des logs texte ») : une feuille d'appel et une notification
 * reconstituées depuis les tables métier. Le détail d'une tentative de paiement vit dans le module Payments.
 */
@Injectable()
export class TraceService {
  constructor(private readonly db: DatabaseService) {}

  async sheet(id: string): Promise<SheetTrace> {
    const tx = this.db.current();
    const head = (
      await tx.execute<{
        id: string;
        status: string;
        version: number;
        retroactive: boolean;
        created_at: string;
        opened_by: string | null;
        submitted_at: string | null;
        submitted_by: string | null;
        locked_at: string | null;
        session_id: string;
        starts_at: string;
        ends_at: string;
        session_status: string;
        subject_name: string;
        group_name: string;
        teachers: string[] | null;
      }>(sql`
        select sh.id, sh.status, sh.version, sh.retroactive, sh.created_at, uo.display_name as opened_by, sh.submitted_at,
               us.display_name as submitted_by, sh.locked_at, s.id as session_id, s.starts_at, s.ends_at, s.status as session_status,
               sub.name as subject_name, g.name as group_name,
               (select array_agg(u.display_name) from course_teachers ct join staff_profiles sp on sp.id = ct.staff_profile_id
                  join memberships m on m.id = sp.membership_id join users u on u.id = m.user_id where ct.course_offering_id = co.id) as teachers
        from attendance_sheets sh
        join sessions s on s.id = sh.session_id
        join course_offerings co on co.id = s.course_offering_id
        join subjects sub on sub.id = co.subject_id
        join groups g on g.id = co.group_id
        left join users uo on uo.id = sh.opened_by
        left join users us on us.id = sh.submitted_by
        where sh.id = ${id}::uuid`)
    ).rows[0];
    if (!head) throw AppError.notFound("Feuille d'appel");
    const counts = (
      await tx.execute<{
        records: number;
        present: number;
        absent: number;
        late: number;
        excused: number;
      }>(sql`
        select count(*)::int as records, count(*) filter (where status = 'PRESENT')::int as present,
               count(*) filter (where status = 'ABSENT')::int as absent, count(*) filter (where status = 'LATE')::int as late,
               count(*) filter (where excuse_status = 'EXCUSED')::int as excused
        from attendance_records where sheet_id = ${id}::uuid`)
    ).rows[0]!;
    const revisions = await tx.execute<{
      at: string;
      student: string;
      before: string;
      after: string;
      reason: string;
      out_of_window: boolean;
      author: string | null;
    }>(sql`
      select rv.created_at as at, st.last_name || ' ' || st.first_name as student, rv.before_status as before, rv.after_status as after,
             rv.reason, rv.out_of_window, u.display_name as author
      from attendance_record_revisions rv
      join attendance_records r on r.id = rv.record_id
      join students st on st.id = r.student_id
      left join users u on u.id = rv.author_id
      where r.sheet_id = ${id}::uuid order by rv.created_at`);
    const notifs = await tx.execute<{
      id: string;
      kind: string;
      channel: string;
      status: string;
      recipient: string | null;
      sent_at: string | null;
      error: string | null;
    }>(sql`
      select n.id, n.kind, n.channel, n.status, coalesce(u.display_name, n.recipient_address) as recipient, n.sent_at, n.error
      from notifications n left join users u on u.id = n.recipient_user_id
      where n.event_id in (select o.id::text from outbox_events o where o.aggregate_type = 'AttendanceSheet' and o.aggregate_id = ${id})
         or n.event_id = ${`missing:${head.session_id}`}
      order by n.created_at`);
    const audit = await tx
      .select({ at: auditLogs.occurredAt, action: auditLogs.action, by: users.displayName })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.entityType, 'AttendanceSheet'), eq(auditLogs.entityId, id)))
      .orderBy(auditLogs.occurredAt);
    const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
    return {
      sheet: {
        id: head.id,
        status: head.status,
        version: head.version,
        retroactive: head.retroactive,
        openedAt: new Date(head.created_at).toISOString(),
        openedBy: head.opened_by,
        submittedAt: iso(head.submitted_at),
        submittedBy: head.submitted_by,
        lockedAt: iso(head.locked_at),
      },
      session: {
        id: head.session_id,
        startsAt: new Date(head.starts_at).toISOString(),
        endsAt: new Date(head.ends_at).toISOString(),
        status: head.session_status,
        subjectName: head.subject_name,
        groupName: head.group_name,
        teachers: head.teachers ?? [],
      },
      counts,
      revisions: revisions.rows.map((r) => ({
        at: new Date(r.at).toISOString(),
        student: r.student,
        before: r.before,
        after: r.after,
        reason: r.reason,
        outOfWindow: r.out_of_window,
        author: r.author,
      })),
      notifications: notifs.rows.map((x) => ({
        id: x.id,
        kind: x.kind,
        channel: x.channel,
        status: x.status,
        recipient: x.recipient,
        sentAt: iso(x.sent_at),
        error: x.error,
      })),
      audit: audit.map((a) => ({ at: a.at.toISOString(), action: a.action, by: a.by })),
    };
  }

  async notification(id: string): Promise<NotificationTrace> {
    const tx = this.db.current();
    const row = await tx.query.notifications.findFirst({ where: eq(notifications.id, id) });
    if (!row) throw AppError.notFound('Notification');
    const recipient = await tx.query.users.findFirst({ where: eq(users.id, row.recipientUserId) });
    const student = row.studentId
      ? (
          await tx.execute<{ name: string }>(
            sql`select last_name || ' ' || first_name as name from students where id = ${row.studentId}::uuid`,
          )
        ).rows[0]
      : undefined;
    // L'événement source : l'identifiant d'événement est celui de l'outbox (ou une clé synthétique « missing:<session> »).
    const ev = /^[0-9a-f-]{36}$/.test(row.eventId)
      ? (
          await tx.execute<{
            id: string;
            event_type: string;
            aggregate_type: string;
            aggregate_id: string | null;
            created_at: string | null;
            published_at: string | null;
          }>(
            sql`select id, event_type, aggregate_type, aggregate_id, occurred_at as created_at, published_at from outbox_events where id = ${row.eventId}::uuid`,
          )
        ).rows[0]
      : undefined;
    const siblings = await tx.execute<{
      id: string;
      channel: string;
      status: string;
      recipient: string | null;
    }>(sql`
      select n.id, n.channel, n.status, coalesce(u.display_name, n.recipient_address) as recipient
      from notifications n left join users u on u.id = n.recipient_user_id
      where n.event_id = ${row.eventId} and n.id <> ${id}::uuid order by n.created_at`);
    const pref = await tx.execute<{ channels: string[] }>(
      sql`select channels from notification_preferences where user_id = ${row.recipientUserId}::uuid and kind = ${row.kind}`,
    );
    const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
    return {
      notification: {
        id: row.id,
        kind: row.kind,
        channel: row.channel,
        status: row.status,
        title: row.title,
        body: row.body,
        recipient: {
          userId: row.recipientUserId,
          name: recipient?.displayName ?? null,
          address: row.recipientAddress,
        },
        studentName: student?.name ?? null,
        attempts: row.attempts,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        sentAt: iso(row.sentAt),
        deliveredAt: iso(row.deliveredAt),
        readAt: iso(row.readAt),
        providerMessageId: row.providerMessageId,
      },
      sourceEvent: ev
        ? {
            id: ev.id,
            type: ev.event_type,
            aggregateType: ev.aggregate_type,
            aggregateId: ev.aggregate_id,
            occurredAt: iso(ev.created_at),
            publishedAt: iso(ev.published_at),
          }
        : row.eventId
          ? {
              id: row.eventId,
              type: row.kind,
              aggregateType: 'synthetic',
              aggregateId: null,
              occurredAt: null,
              publishedAt: null,
            }
          : null,
      siblings: siblings.rows,
      preferences: pref.rows[0]?.channels ?? null,
    };
  }
}
