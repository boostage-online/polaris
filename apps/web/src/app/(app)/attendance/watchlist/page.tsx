'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCan } from '@/components/app-shell';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
  Table,
} from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { attendance } from '@/lib/resources';

/** Élèves à surveiller : seuil d'absences non justifiées atteint sur la fenêtre de l'établissement. */
export default function WatchlistPage() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['attendance', 'watchlist'], queryFn: attendance.watchlist });
  const resolve = useMutation({
    mutationFn: (id: string) => attendance.resolveAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance', 'watchlist'] }),
  });
  return (
    <>
      <PageHeader
        title="Élèves à surveiller"
        subtitle="Une alerte par élève ; elle se résout d'elle-même si la situation s'améliore, ou à la main après suivi."
      />
      <Card>
        {q.isPending && <Loading />}
        {q.isError && <ErrorAlert error={q.error} />}
        <ErrorAlert error={resolve.error} />
        {q.data && q.data.length === 0 && <Empty>Aucune alerte en cours.</Empty>}
        {q.data && q.data.length > 0 && (
          <Table
            head={
              <>
                <th>Élève</th>
                <th>Classe</th>
                <th>Absences non justifiées</th>
                <th>Fenêtre</th>
                <th>Depuis</th>
                <th></th>
              </>
            }
          >
            {q.data.map((w) => (
              <tr key={w.alertId}>
                <td>
                  <Link
                    href={`/students/${w.student.id}`}
                    className="font-medium text-[var(--color-brand)] hover:underline"
                  >
                    {w.student.lastName} {w.student.firstName}
                  </Link>
                </td>
                <td>{w.student.groupName ?? '—'}</td>
                <td>
                  <Badge tone="red">{w.count}</Badge>
                </td>
                <td className="text-xs text-slate-500">
                  {fmtDate(w.windowFrom)} → {fmtDate(w.windowTo)}
                </td>
                <td className="text-xs text-slate-500">{fmtDate(w.createdAt)}</td>
                <td className="text-right">
                  {can('REVIEW_JUSTIFICATION', 'EDIT_ATTENDANCE_LOCKED') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={resolve.isPending}
                      onClick={() => resolve.mutate(w.alertId)}
                    >
                      Suivi fait
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
