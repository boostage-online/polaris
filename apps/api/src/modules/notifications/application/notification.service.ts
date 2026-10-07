import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  InboxQuerySchema,
  NotificationPreferencesSchema,
  NotificationsQuerySchema,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor, page } from '../../../common/http/cursor';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { notificationPreferences, notifications, users } from '../../../database/schema';
import { AuditService } from '../../audit';
import { DEFAULT_CHANNELS, type NotificationKind } from '../domain/templates';
import { NotificationPlanner } from './notification-planner.service';

/** Boîte de réception, journal administrateur, renvoi, préférences, consommation SMS. */
@Injectable()
export class NotificationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly planner: NotificationPlanner,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }
  private get userId() {
    return RequestContextStore.require().actor!.userId;
  }

  /** Mes notifications in-app (tous types), plus récentes d'abord. */
  async inbox(query: z.infer<typeof InboxQuerySchema>) {
    const tx = this.db.current();
    const cur = decodeCursor<{ t: string; id: string }>(query.cursor);
    const rows = await tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, this.userId),
          eq(notifications.channel, 'INAPP'),
          query.unread ? isNull(notifications.readAt) : undefined,
          cur
            ? sql`(${notifications.createdAt}, ${notifications.id}) < (${new Date(cur.t)}, ${cur.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit + 1);
    const unread = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, this.userId),
          eq(notifications.channel, 'INAPP'),
          isNull(notifications.readAt),
        ),
      );
    const p = page(
      rows.map((r) => this.dto(r)),
      query.limit,
      (last) => ({ t: last.createdAt, id: last.id }),
    );
    return { data: p.data, meta: { ...p.meta, unread: unread[0]?.n ?? 0 } };
  }

  async markRead(id: string | 'all') {
    const tx = this.db.current();
    const where = and(
      eq(notifications.recipientUserId, this.userId),
      eq(notifications.channel, 'INAPP'),
      isNull(notifications.readAt),
      id === 'all' ? undefined : eq(notifications.id, id),
    );
    const res = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(where)
      .returning({ id: notifications.id });
    if (id !== 'all' && res.length === 0) {
      const exists = await tx.query.notifications.findFirst({
        where: and(eq(notifications.id, id), eq(notifications.recipientUserId, this.userId)),
      });
      if (!exists) throw AppError.notFound('Notification');
    }
    return { marked: res.length };
  }

  /** Journal : qui, quoi, quand, canal, statut — réponse à « je n'ai jamais été prévenu ». */
  async journal(query: z.infer<typeof NotificationsQuerySchema>) {
    const tx = this.db.current();
    const cur = decodeCursor<{ t: string; id: string }>(query.cursor);
    const rows = await tx
      .select({ n: notifications, recipientName: users.displayName })
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.recipientUserId))
      .where(
        and(
          query.studentId ? eq(notifications.studentId, query.studentId) : undefined,
          query.recipientUserId
            ? eq(notifications.recipientUserId, query.recipientUserId)
            : undefined,
          query.channel ? eq(notifications.channel, query.channel) : undefined,
          query.status ? eq(notifications.status, query.status) : undefined,
          query.kind ? eq(notifications.kind, query.kind) : undefined,
          cur
            ? sql`(${notifications.createdAt}, ${notifications.id}) < (${new Date(cur.t)}, ${cur.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit + 1);
    return page(
      rows.map((r) => ({ ...this.dto(r.n), recipientName: r.recipientName })),
      query.limit,
      (last) => ({ t: last.createdAt, id: last.id }),
    );
  }

  /** Renvoi manuel : remet en file une notification échouée ou supprimée ; l'envoi est fait hors transaction. */
  async requeue(id: string) {
    const tx = this.db.current();
    const n = await tx.query.notifications.findFirst({ where: eq(notifications.id, id) });
    if (!n) throw AppError.notFound('Notification');
    if (n.status !== 'FAILED' && n.status !== 'SUPPRESSED')
      throw AppError.conflict('Seules les notifications échouées ou suspendues se renvoient');
    await tx
      .update(notifications)
      .set({ status: 'QUEUED', error: null })
      .where(eq(notifications.id, id));
    await this.audit.record({
      action: 'notification.requeued',
      entityType: 'Notification',
      entityId: id,
      before: { status: n.status },
    });
    return { requeued: true };
  }

  async resend(id: string) {
    const tenantId = this.tenantId;
    await this.db.withTenantTx(tenantId, () => this.requeue(id));
    await this.planner.dispatch(tenantId);
    return this.db.withTenantTx(tenantId, async (tx) =>
      this.dto((await tx.query.notifications.findFirst({ where: eq(notifications.id, id) }))!),
    );
  }

  async usage() {
    return this.planner.smsUsage(this.tenantId);
  }

  async preferences() {
    const tx = this.db.current();
    const rows = await tx
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, this.userId));
    const preferences: Record<string, string[]> = {};
    for (const k of Object.keys(DEFAULT_CHANNELS) as NotificationKind[])
      preferences[k] = DEFAULT_CHANNELS[k];
    for (const r of rows) preferences[r.kind] = r.channels;
    return { preferences };
  }

  async setPreferences(input: z.infer<typeof NotificationPreferencesSchema>) {
    const tx = this.db.current();
    for (const [kind, channels] of Object.entries(input.preferences)) {
      if (!channels) continue;
      await tx
        .insert(notificationPreferences)
        .values({
          tenantId: this.tenantId,
          userId: this.userId,
          kind,
          channels,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.tenantId,
            notificationPreferences.userId,
            notificationPreferences.kind,
          ],
          set: { channels, updatedAt: new Date() },
        });
    }
    return this.preferences();
  }

  private dto(n: typeof notifications.$inferSelect) {
    return {
      id: n.id,
      kind: n.kind,
      channel: n.channel,
      status: n.status,
      title: n.title,
      body: n.body,
      actionUrl: n.actionUrl,
      recipientUserId: n.recipientUserId,
      studentId: n.studentId,
      error: n.error,
      createdAt: n.createdAt.toISOString(),
      sentAt: n.sentAt?.toISOString() ?? null,
      readAt: n.readAt?.toISOString() ?? null,
    };
  }
}
