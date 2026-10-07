'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorAlert,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Stat,
  Table,
} from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { notifs } from '@/lib/resources';

const STATUS_TONE: Record<string, 'green' | 'red' | 'amber' | 'slate' | 'blue'> = {
  SENT: 'green',
  DELIVERED: 'green',
  FAILED: 'red',
  SUPPRESSED: 'amber',
  QUEUED: 'blue',
};

/** Journal des notifications : qui, quoi, quand, par quel canal, avec quel résultat ; renvoi manuel ; quota SMS. */
export default function NotificationsJournalPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ channel: '', status: '', kind: '', studentId: '' });
  const usage = useQuery({ queryKey: ['notifications', 'usage'], queryFn: notifs.usage });
  const q = useQuery({
    queryKey: ['notifications', 'journal', filters],
    queryFn: () =>
      notifs.journal({
        channel: filters.channel || undefined,
        status: filters.status || undefined,
        kind: filters.kind || undefined,
        studentId: filters.studentId || undefined,
        limit: 100,
      }),
  });
  const resend = useMutation({
    mutationFn: (id: string) => notifs.resend(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <>
      <PageHeader
        title="Journal des notifications"
        subtitle="Réponse à « je n'ai jamais été prévenu » ; renvoi des échecs ; suivi du quota SMS."
      />
      {usage.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label={`SMS envoyés (${usage.data.month})`}
            value={`${usage.data.smsSent} / ${usage.data.smsCap}`}
            tone={usage.data.smsSent >= usage.data.smsCap * 0.8 ? 'amber' : undefined}
          />
          <Stat
            label="SMS suspendus (quota)"
            value={usage.data.suppressed}
            tone={usage.data.suppressed ? 'amber' : undefined}
          />
          <Stat
            label="SMS échoués"
            value={usage.data.failed}
            tone={usage.data.failed ? 'red' : undefined}
          />
        </div>
      )}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Canal">
            <Select
              value={filters.channel}
              onChange={(e) => setFilters({ ...filters, channel: e.target.value })}
            >
              <option value="">Tous</option>
              <option value="SMS">SMS</option>
              <option value="INAPP">In-app</option>
              <option value="EMAIL">E-mail</option>
            </Select>
          </Field>
          <Field label="Statut">
            <Select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Tous</option>
              <option value="SENT">Envoyé</option>
              <option value="FAILED">Échec</option>
              <option value="SUPPRESSED">Suspendu</option>
              <option value="QUEUED">En file</option>
            </Select>
          </Field>
          <Field label="Type">
            <Select
              value={filters.kind}
              onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
            >
              <option value="">Tous</option>
              <option value="STUDENT_ABSENT">Absence</option>
              <option value="STUDENT_LATE">Retard</option>
              <option value="JUSTIFICATION_REVIEWED">Décision justificatif</option>
              <option value="JUSTIFICATION_SUBMITTED">Justificatif déposé</option>
              <option value="REPEATED_ABSENCES">Absences répétées</option>
              <option value="ATTENDANCE_SHEET_MISSING">Appel non fait</option>
            </Select>
          </Field>
          <Field label="Identifiant élève">
            <Input
              value={filters.studentId}
              onChange={(e) => setFilters({ ...filters, studentId: e.target.value })}
              placeholder="uuid"
            />
          </Field>
        </div>
      </Card>
      <Card>
        {q.isPending && <Loading />}
        {q.isError && <ErrorAlert error={q.error} />}
        <ErrorAlert error={resend.error} />
        {q.data && q.data.data.length === 0 && <Empty>Aucune notification.</Empty>}
        {q.data && q.data.data.length > 0 && (
          <Table
            head={
              <>
                <th>Quand</th>
                <th>Destinataire</th>
                <th>Type</th>
                <th>Canal</th>
                <th>Message</th>
                <th>Statut</th>
                <th></th>
              </>
            }
          >
            {q.data.data.map((n) => (
              <tr key={n.id}>
                <td className="whitespace-nowrap text-xs text-slate-500">
                  {fmtDateTime(n.createdAt)}
                </td>
                <td>{n.recipientName ?? n.recipientUserId.slice(0, 8)}</td>
                <td className="text-xs">{n.kind}</td>
                <td>
                  <Badge>{n.channel}</Badge>
                </td>
                <td className="max-w-md truncate" title={n.body}>
                  {n.body}
                </td>
                <td>
                  <Badge tone={STATUS_TONE[n.status] ?? 'slate'}>{n.status}</Badge>
                  {n.error && (
                    <span className="ml-1 text-xs text-red-700" title={n.error}>
                      !
                    </span>
                  )}
                </td>
                <td className="text-right">
                  {(n.status === 'FAILED' || n.status === 'SUPPRESSED') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={resend.isPending}
                      onClick={() => resend.mutate(n.id)}
                    >
                      Renvoyer
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
