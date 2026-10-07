'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMe } from '@/components/app-shell';
import { SessionStatusBadge } from '@/components/attendance';
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
import { fmtDateTime, fmtTime } from '@/lib/format';
import { reporting } from '@/lib/resources';

const SHEET_STATUS: Record<string, { label: string; tone: 'slate' | 'blue' | 'green' | 'amber' }> =
  {
    DRAFT: { label: 'Brouillon', tone: 'amber' },
    SUBMITTED: { label: 'Soumise', tone: 'green' },
    LOCKED: { label: 'Verrouillée', tone: 'slate' },
  };
const NOTIF_TONE: Record<string, 'green' | 'red' | 'amber' | 'slate' | 'blue'> = {
  SENT: 'green',
  DELIVERED: 'green',
  FAILED: 'red',
  SUPPRESSED: 'amber',
  QUEUED: 'blue',
};

/** Traçabilité d'une feuille d'appel : qui a fait quoi, quand, et ce que les parents ont reçu. */
export default function SheetTracePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const tz = me.tenantTimezone;
  const q = useQuery({ queryKey: ['trace', 'sheet', id], queryFn: () => reporting.sheetTrace(id) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const t = q.data;
  const st = SHEET_STATUS[t.sheet.status] ?? { label: t.sheet.status, tone: 'slate' as const };
  return (
    <>
      <PageHeader
        title={`Feuille d'appel · ${t.session.subjectName} · ${t.session.groupName}`}
        subtitle={
          <>
            {fmtDateTime(t.session.startsAt, tz)} – {fmtTime(t.session.endsAt, tz)} ·{' '}
            <SessionStatusBadge status={t.session.status} />
          </>
        }
        actions={
          <LinkButton href={`/attendance/sessions/${t.session.id}`}>Ouvrir la séance</LinkButton>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Feuille">
          <KV
            rows={[
              [
                'État',
                <Badge key="s" tone={st.tone}>
                  {st.label}
                </Badge>,
              ],
              ['Version', t.sheet.version],
              ['Rétroactive', t.sheet.retroactive ? 'oui' : 'non'],
              ['Ouverte le', `${fmtDateTime(t.sheet.openedAt, tz)} par ${t.sheet.openedBy ?? '—'}`],
              [
                'Soumise le',
                t.sheet.submittedAt
                  ? `${fmtDateTime(t.sheet.submittedAt, tz)} par ${t.sheet.submittedBy ?? '—'}`
                  : '—',
              ],
              ['Verrouillée le', t.sheet.lockedAt ? fmtDateTime(t.sheet.lockedAt, tz) : '—'],
              ['Enseignant(s)', t.session.teachers.join(', ') || '—'],
            ]}
          />
        </Card>
        <Card title="Effectif">
          <div className="grid grid-cols-5 gap-2 text-center">
            {(
              [
                ['Inscrits', t.counts.records, ''],
                ['Présents', t.counts.present, 'text-emerald-700'],
                ['Absents', t.counts.absent, 'text-red-700'],
                ['Retards', t.counts.late, 'text-amber-700'],
                ['Excusés', t.counts.excused, 'text-slate-600'],
              ] as const
            ).map(([label, value, cls]) => (
              <div key={label}>
                <p className={`text-2xl font-semibold ${cls}`}>{value}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 space-y-4">
        <Card title={`Corrections après soumission (${t.revisions.length})`}>
          {t.revisions.length === 0 ? (
            <Empty>Aucune correction : la feuille est telle qu&apos;elle a été soumise.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Quand</th>
                  <th>Élève</th>
                  <th>Avant → après</th>
                  <th>Motif</th>
                  <th>Par</th>
                </>
              }
            >
              {t.revisions.map((r, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap text-xs text-slate-500">
                    {fmtDateTime(r.at, tz)}
                  </td>
                  <td>{r.student}</td>
                  <td>
                    {r.before} → <strong>{r.after}</strong>
                    {r.outOfWindow && (
                      <Badge tone="amber">
                        <span className="ml-1">hors délai</span>
                      </Badge>
                    )}
                  </td>
                  <td className="text-sm">{r.reason}</td>
                  <td>{r.author ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title={`Notifications aux parents (${t.notifications.length})`}>
          {t.notifications.length === 0 ? (
            <Empty>Aucune notification liée à cette feuille.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Type</th>
                  <th>Canal</th>
                  <th>Destinataire</th>
                  <th>Statut</th>
                  <th>Envoyée le</th>
                  <th></th>
                </>
              }
            >
              {t.notifications.map((n) => (
                <tr key={n.id}>
                  <td className="text-xs">{n.kind}</td>
                  <td>
                    <Badge>{n.channel}</Badge>
                  </td>
                  <td>{n.recipient ?? '—'}</td>
                  <td>
                    <Badge tone={NOTIF_TONE[n.status] ?? 'slate'}>{n.status}</Badge>
                    {n.error && (
                      <span className="ml-1 text-xs text-red-700" title={n.error}>
                        !
                      </span>
                    )}
                  </td>
                  <td className="text-xs text-slate-500">
                    {n.sentAt ? fmtDateTime(n.sentAt, tz) : '—'}
                  </td>
                  <td className="text-right">
                    <Link href={`/trace/notifications/${n.id}`} className="text-xs underline">
                      Tracer
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Journal d'audit">
          {t.audit.length === 0 ? (
            <Empty>Aucune entrée d&apos;audit.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {t.audit.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-40 shrink-0 text-xs text-slate-500">
                    {fmtDateTime(a.at, tz)}
                  </span>
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="text-slate-600">{a.by ?? 'système'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
