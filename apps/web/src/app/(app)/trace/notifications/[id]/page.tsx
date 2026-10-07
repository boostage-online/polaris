'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMe } from '@/components/app-shell';
import { KV } from '@/components/reporting';
import {
  Badge,
  Card,
  Empty,
  ErrorAlert,
  LinkButton,
  Loading,
  PageHeader,
  Table,
} from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { reporting } from '@/lib/resources';

const TONE: Record<string, 'green' | 'red' | 'amber' | 'slate' | 'blue'> = {
  SENT: 'green',
  DELIVERED: 'green',
  READ: 'green',
  FAILED: 'red',
  SUPPRESSED: 'amber',
  QUEUED: 'blue',
};

/** Traçabilité d'une notification : événement source, rendu, envois, préférences du destinataire. */
export default function NotificationTracePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const tz = me.tenantTimezone;
  const q = useQuery({
    queryKey: ['trace', 'notification', id],
    queryFn: () => reporting.notificationTrace(id),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const { notification: n, sourceEvent, siblings, preferences } = q.data;
  const sheetId = sourceEvent?.aggregateType === 'AttendanceSheet' ? sourceEvent.aggregateId : null;
  return (
    <>
      <PageHeader
        title={`Notification · ${n.kind}`}
        subtitle={
          <>
            <Badge>{n.channel}</Badge> <Badge tone={TONE[n.status] ?? 'slate'}>{n.status}</Badge> ·
            créée le {fmtDateTime(n.createdAt, tz)}
          </>
        }
        actions={<LinkButton href="/admin/notifications">Journal des notifications</LinkButton>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Destinataire et acheminement">
          <KV
            rows={[
              ['Destinataire', n.recipient.name ?? n.recipient.userId],
              ['Adresse', n.recipient.address ?? '—'],
              ['Élève concerné', n.studentName ?? '—'],
              ['Tentatives', n.attempts],
              ['Envoyée le', n.sentAt ? fmtDateTime(n.sentAt, tz) : '—'],
              ['Remise le', n.deliveredAt ? fmtDateTime(n.deliveredAt, tz) : '—'],
              ['Lue le', n.readAt ? fmtDateTime(n.readAt, tz) : '—'],
              ['Identifiant provider', n.providerMessageId ?? '—'],
              [
                'Erreur',
                n.error ? (
                  <span key="e" className="text-red-700">
                    {n.error}
                  </span>
                ) : (
                  '—'
                ),
              ],
              [
                'Préférences du destinataire',
                preferences === null ? 'par défaut' : preferences.join(', ') || 'aucun canal',
              ],
            ]}
          />
        </Card>
        <Card title="Message rendu">
          <p className="font-medium">{n.title}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
        </Card>
        <Card title="Événement source">
          {sourceEvent ? (
            <>
              <KV
                rows={[
                  [
                    'Type',
                    <span key="t" className="font-mono text-xs">
                      {sourceEvent.type}
                    </span>,
                  ],
                  [
                    'Agrégat',
                    `${sourceEvent.aggregateType} ${sourceEvent.aggregateId ?? ''}`.trim(),
                  ],
                  [
                    'Survenu le',
                    sourceEvent.occurredAt ? fmtDateTime(sourceEvent.occurredAt, tz) : '—',
                  ],
                  [
                    'Publié le',
                    sourceEvent.publishedAt ? fmtDateTime(sourceEvent.publishedAt, tz) : '—',
                  ],
                ]}
              />
              {sheetId && (
                <p className="mt-3 text-sm">
                  <Link href={`/trace/sheets/${sheetId}`} className="underline">
                    Tracer la feuille d&apos;appel →
                  </Link>
                </p>
              )}
            </>
          ) : (
            <Empty>Événement source introuvable (notification créée directement).</Empty>
          )}
        </Card>
        <Card title={`Autres envois du même événement (${siblings.length})`}>
          {siblings.length === 0 ? (
            <Empty>Aucun autre envoi.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Canal</th>
                  <th>Destinataire</th>
                  <th>Statut</th>
                  <th></th>
                </>
              }
            >
              {siblings.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Badge>{s.channel}</Badge>
                  </td>
                  <td>{s.recipient ?? '—'}</td>
                  <td>
                    <Badge tone={TONE[s.status] ?? 'slate'}>{s.status}</Badge>
                  </td>
                  <td className="text-right">
                    <Link href={`/trace/notifications/${s.id}`} className="text-xs underline">
                      Tracer
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
