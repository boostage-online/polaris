'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ClassSession } from '@polaris/contracts';
import { useCan, useMe } from '@/components/app-shell';
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
  Table,
} from '@/components/ui';
import { addDaysIso, fmtDate, fmtTime, todayIso, SESSION_STATUS } from '@/lib/format';
import { groups, sessions } from '@/lib/resources';

/** Planning des séances de l'établissement : période, groupe, statut ; annulation motivée. */
export default function SessionsPage() {
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const [from, setFrom] = useState(todayIso());
  const [days, setDays] = useState(7);
  const [groupId, setGroupId] = useState('');
  const [status, setStatus] = useState('');
  const to = addDaysIso(from, days);
  const params = {
    from: `${from}T00:00:00.000Z`,
    to: `${to}T00:00:00.000Z`,
    groupId: groupId || undefined,
    status: (status || undefined) as ClassSession['status'] | undefined,
    limit: 200,
  };
  const list = useQuery({ queryKey: ['sessions', params], queryFn: () => sessions.list(params) });
  const grps = useQuery({ queryKey: ['groups', 'ALL'], queryFn: () => groups.list({}) });
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => {
      if (!cancelId) throw new Error('Aucune séance sélectionnée');
      return sessions.update(cancelId, { status: 'CANCELLED', cancelReason: reason });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['sessions'] });
      setCancelId(null);
      setReason('');
    },
  });

  const byDay = new Map<string, ClassSession[]>();
  for (const s of list.data?.data ?? []) {
    const key = fmtDate(s.startsAt, me.tenantTimezone);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }

  return (
    <>
      <PageHeader
        title="Planning des séances"
        subtitle="Les séances naissent des créneaux des cours ; c'est sur elles que l'appel se fera."
      />
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="À partir du">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Durée">
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={1}>1 jour</option>
              <option value={7}>7 jours</option>
              <option value={14}>14 jours</option>
              <option value={30}>30 jours</option>
            </Select>
          </Field>
          <Field label="Groupe">
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Tous</option>
              {grps.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statut">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tous</option>
              {Object.entries(SESSION_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end text-sm text-slate-500">
            {list.data ? `${list.data.data.length} séance(s)` : ''}
          </div>
        </div>
      </Card>
      {list.isPending && <Loading />}
      {list.isError && <ErrorAlert error={list.error} />}
      {list.data && byDay.size === 0 && (
        <Empty>
          Aucune séance sur la période. Vérifiez les créneaux des cours et lancez la génération.
        </Empty>
      )}
      <div className="space-y-4">
        {[...byDay.entries()].map(([day, items]) => (
          <Card key={day} title={day}>
            <Table
              head={
                <>
                  <th>Heure</th>
                  <th>Matière</th>
                  <th>Groupe</th>
                  <th>Enseignant(s)</th>
                  <th>Salle</th>
                  <th>Statut</th>
                  <th></th>
                </>
              }
            >
              {items.map((s) => (
                <tr key={s.id} className={s.status === 'CANCELLED' ? 'text-slate-400' : ''}>
                  <td className="whitespace-nowrap">
                    {fmtTime(s.startsAt, me.tenantTimezone)} –{' '}
                    {fmtTime(s.endsAt, me.tenantTimezone)}
                  </td>
                  <td>{s.subjectName}</td>
                  <td>{s.groupName}</td>
                  <td>
                    {s.teachers.map((t) => t.displayName ?? '—').join(', ') || (
                      <Badge tone="amber">Aucun</Badge>
                    )}
                  </td>
                  <td>{s.room ?? '—'}</td>
                  <td>
                    <Badge
                      tone={
                        s.status === 'CANCELLED' ? 'red' : s.status === 'HELD' ? 'green' : 'blue'
                      }
                    >
                      {SESSION_STATUS[s.status] ?? s.status}
                    </Badge>
                    {s.cancelReason && <span className="ml-1 text-xs">{s.cancelReason}</span>}
                  </td>
                  <td className="text-right">
                    {can('MANAGE_SCHEDULES') &&
                      s.status === 'PLANNED' &&
                      (cancelId === s.id ? (
                        <form
                          className="flex items-center gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            cancel.mutate();
                          }}
                        >
                          <Input
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Motif"
                            className="w-40"
                            required
                            autoFocus
                          />
                          <Button
                            size="sm"
                            variant="danger"
                            type="submit"
                            disabled={cancel.isPending || !reason.trim()}
                          >
                            OK
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            onClick={() => setCancelId(null)}
                          >
                            ✕
                          </Button>
                        </form>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setCancelId(s.id)}>
                          Annuler
                        </Button>
                      ))}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}
      </div>
      <ErrorAlert error={cancel.error} />
    </>
  );
}
