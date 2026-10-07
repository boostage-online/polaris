'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ClassSession } from '@polaris/contracts';
import { useMe } from '@/components/app-shell';
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
  Table,
} from '@/components/ui';
import { addDaysIso, fmtDate, fmtTime, todayIso, SESSION_STATUS } from '@/lib/format';
import { sessions } from '@/lib/resources';

/** Emploi du temps de l'utilisateur : ses cours (enseignant) ou tout l'établissement (portée globale). */
export default function SchedulePage() {
  const me = useMe();
  const [from, setFrom] = useState(todayIso());
  const [days, setDays] = useState(7);
  const to = addDaysIso(from, days);
  const q = useQuery({
    queryKey: ['me', 'schedule', from, to],
    queryFn: () =>
      sessions.mine({ from: `${from}T00:00:00.000Z`, to: `${to}T00:00:00.000Z`, limit: 200 }),
  });
  const byDay = new Map<string, ClassSession[]>();
  for (const s of q.data?.data ?? []) {
    const key = fmtDate(s.startsAt, me.tenantTimezone);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  return (
    <>
      <PageHeader
        title="Mon emploi du temps"
        actions={
          <div className="flex items-end gap-2">
            <Field label="À partir du">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <div className="flex gap-1">
              {[7, 14, 30].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={days === d ? 'primary' : 'secondary'}
                  onClick={() => setDays(d)}
                >
                  {d} j
                </Button>
              ))}
            </div>
          </div>
        }
      />
      {q.isPending && <Loading />}
      {q.isError && <ErrorAlert error={q.error} />}
      {q.data && byDay.size === 0 && <Empty>Aucune séance sur la période.</Empty>}
      <div className="space-y-4">
        {[...byDay.entries()].map(([day, list]) => (
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
                </>
              }
            >
              {list.map((s) => (
                <tr
                  key={s.id}
                  className={s.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}
                >
                  <td className="whitespace-nowrap">
                    {fmtTime(s.startsAt, me.tenantTimezone)} –{' '}
                    {fmtTime(s.endsAt, me.tenantTimezone)}
                  </td>
                  <td>{s.subjectName}</td>
                  <td>{s.groupName}</td>
                  <td>{(s.teachers ?? []).map((t) => t.displayName ?? '—').join(', ') || '—'}</td>
                  <td>{s.room ?? '—'}</td>
                  <td>
                    <Badge
                      tone={
                        s.status === 'CANCELLED' ? 'red' : s.status === 'HELD' ? 'green' : 'blue'
                      }
                    >
                      {SESSION_STATUS[s.status] ?? s.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}
      </div>
    </>
  );
}
