'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useMe } from '@/components/app-shell';
import { JUSTIF_STATUS, StatusBadge } from '@/components/attendance';
import { ChildFinanceSection } from '@/components/parent-finance';
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
  Textarea,
} from '@/components/ui';
import { addDaysIso, fmtDate, fmtDateTime, fmtTime, todayIso } from '@/lib/format';
import { parent } from '@/lib/resources';

/** Espace parent : historique d'assiduité d'un enfant, justificatifs déposés, dépôt d'un justificatif. */
export default function ChildPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const me = useMe();
  const qc = useQueryClient();
  const [from, setFrom] = useState(addDaysIso(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [status, setStatus] = useState('');
  const summary = useQuery({ queryKey: ['parent', 'summary'], queryFn: parent.summary });
  const child = summary.data?.find((c) => c.student.id === studentId);
  const hist = useQuery({
    queryKey: ['parent', 'history', studentId, from, to, status],
    queryFn: () => parent.history(studentId, { from, to, limit: 200 }),
  });
  const justifs = useQuery({
    queryKey: ['parent', 'justifications', studentId],
    queryFn: () => parent.justifications(studentId),
  });
  const [form, setForm] = useState({ fromDate: todayIso(), toDate: '', reason: '' });
  const submit = useMutation({
    mutationFn: () =>
      parent.submitJustification(studentId, {
        fromDate: form.fromDate,
        toDate: form.toDate || form.fromDate,
        reason: form.reason,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['parent'] });
      setForm({ fromDate: todayIso(), toDate: '', reason: '' });
    },
  });
  const items = (hist.data?.data ?? []).filter((h) => !status || h.status === status);
  return (
    <>
      <PageHeader
        title={child ? `${child.student.firstName} ${child.student.lastName}` : 'Mon enfant'}
        subtitle={child?.student.groupName ?? undefined}
      />
      {summary.isError && <ErrorAlert error={summary.error} />}
      {child && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Présence (30 j)"
            value={
              child.last30Days.presenceRate === null ? '—' : `${child.last30Days.presenceRate} %`
            }
          />
          <Stat
            label="Absences"
            value={child.last30Days.absent}
            tone={child.last30Days.unjustified ? 'red' : undefined}
          />
          <Stat label="Retards" value={child.last30Days.late} />
          <Stat
            label="Non justifiées"
            value={child.last30Days.unjustified}
            tone={child.last30Days.unjustified ? 'amber' : undefined}
          />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Historique"
          className="lg:col-span-2"
          actions={
            <div className="flex items-end gap-2">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Tout</option>
                <option value="ABSENT">Absences</option>
                <option value="LATE">Retards</option>
              </Select>
            </div>
          }
        >
          {hist.isPending && <Loading />}
          {hist.isError && <ErrorAlert error={hist.error} />}
          {hist.data && items.length === 0 && <Empty>Rien sur la période.</Empty>}
          {items.length > 0 && (
            <Table
              head={
                <>
                  <th>Date</th>
                  <th>Heure</th>
                  <th>Cours</th>
                  <th>Statut</th>
                  <th>Note</th>
                </>
              }
            >
              {items.map((h) => (
                <tr key={h.recordId}>
                  <td>{fmtDate(h.startsAt, me.tenantTimezone)}</td>
                  <td>{fmtTime(h.startsAt, me.tenantTimezone)}</td>
                  <td>{h.subjectName}</td>
                  <td>
                    <StatusBadge
                      status={h.status}
                      excuse={h.excuseStatus}
                      lateMinutes={h.lateMinutes}
                    />
                  </td>
                  <td className="text-xs text-slate-500">{h.note ?? ''}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <div className="space-y-4">
          {child?.canJustify && (
            <Card title="Déposer un justificatif">
              <form
                className="space-y-2"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  submit.mutate();
                }}
              >
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Du">
                    <Input
                      type="date"
                      value={form.fromDate}
                      onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Au">
                    <Input
                      type="date"
                      value={form.toDate}
                      onChange={(e) => setForm({ ...form, toDate: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Motif">
                  <Textarea
                    rows={3}
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="Maladie, rendez-vous médical…"
                    required
                  />
                </Field>
                <ErrorAlert error={submit.error} />
                {submit.isSuccess && <Badge tone="green">Justificatif transmis</Badge>}
                <Button type="submit" disabled={submit.isPending || form.reason.trim().length < 3}>
                  Envoyer
                </Button>
                <p className="text-xs text-slate-500">
                  Le document (certificat) pourra être joint quand le dépôt de fichiers sera ouvert
                  ; indiquez-le dans le motif en attendant.
                </p>
              </form>
            </Card>
          )}
          <Card title="Justificatifs">
            {justifs.isPending && <Loading />}
            {justifs.data && justifs.data.length === 0 && <Empty>Aucun justificatif.</Empty>}
            <ul className="space-y-2 text-sm">
              {justifs.data?.map((j) => (
                <li key={j.id} className="rounded-md border border-slate-200 p-2">
                  <p className="flex items-center justify-between">
                    <span>
                      {fmtDate(j.fromDate)}
                      {j.toDate !== j.fromDate ? ` → ${fmtDate(j.toDate)}` : ''}
                    </span>
                    <Badge
                      tone={
                        j.status === 'APPROVED'
                          ? 'green'
                          : j.status === 'REJECTED'
                            ? 'red'
                            : 'amber'
                      }
                    >
                      {JUSTIF_STATUS[j.status] ?? j.status}
                    </Badge>
                  </p>
                  <p className="text-slate-600">{j.reason}</p>
                  {j.reviewComment && (
                    <p className="mt-1 text-xs text-slate-500">Réponse : {j.reviewComment}</p>
                  )}
                  <p className="text-xs text-slate-400">{fmtDateTime(j.createdAt)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <div className="mt-8">
        <ChildFinanceSection studentId={studentId} />
      </div>
    </>
  );
}
