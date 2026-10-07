'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useCan, useMe } from '@/components/app-shell';
import { SheetState } from '@/components/attendance';
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
  Tabs,
} from '@/components/ui';
import { addDaysIso, fmtDate, fmtTime, todayIso } from '@/lib/format';
import { attendance, groups } from '@/lib/resources';

type Tab = 'sheets' | 'missing';

/** Vie scolaire : feuilles d'appel de la période, appels manquants, verrouillage. */
export default function SheetsPage() {
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('missing');
  const [from, setFrom] = useState(addDaysIso(todayIso(), -7));
  const [to, setTo] = useState(todayIso());
  const [groupId, setGroupId] = useState('');
  const grps = useQuery({ queryKey: ['groups', 'ALL'], queryFn: () => groups.list({}) });
  const sheets = useQuery({
    queryKey: ['attendance', 'sheets', { from, to, groupId }],
    queryFn: () => attendance.sheets({ from, to, groupId: groupId || undefined, limit: 200 }),
    enabled: tab === 'sheets',
  });
  const missing = useQuery({
    queryKey: ['attendance', 'missing', { from, to, groupId }],
    queryFn: () => attendance.missing({ from, to, groupId: groupId || undefined }),
    enabled: tab === 'missing',
  });
  const lock = useMutation({
    mutationFn: (action: 'LOCK' | 'UNLOCK') =>
      attendance.lock({ from, to, groupId: groupId || undefined, action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
  });
  return (
    <>
      <PageHeader
        title="Feuilles d'appel"
        subtitle="Suivez les appels soumis, relancez les manquants, verrouillez une période close."
        actions={
          can('EDIT_ATTENDANCE_LOCKED') && (
            <>
              <Button
                variant="secondary"
                disabled={lock.isPending}
                onClick={() => lock.mutate('LOCK')}
              >
                Verrouiller la période
              </Button>
              <Button
                variant="ghost"
                disabled={lock.isPending}
                onClick={() => lock.mutate('UNLOCK')}
              >
                Déverrouiller
              </Button>
            </>
          )
        }
      />
      {lock.data && (
        <div className="mb-3">
          <Badge tone="green">{lock.data.count} feuille(s) modifiée(s)</Badge>
        </div>
      )}
      <ErrorAlert error={lock.error} />
      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-4" onSubmit={(e: FormEvent) => e.preventDefault()}>
          <Field label="Du">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Au">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
        </form>
      </Card>
      <Tabs
        tabs={[
          { id: 'missing', label: 'Appels manquants' },
          { id: 'sheets', label: 'Feuilles soumises' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'missing' && (
        <Card>
          {missing.isPending && <Loading />}
          {missing.isError && <ErrorAlert error={missing.error} />}
          {missing.data && missing.data.length === 0 && (
            <Empty>Aucun appel manquant sur la période.</Empty>
          )}
          {missing.data && missing.data.length > 0 && (
            <Table
              head={
                <>
                  <th>Séance</th>
                  <th>Matière</th>
                  <th>Groupe</th>
                  <th>Enseignant(s)</th>
                  <th>État</th>
                  <th></th>
                </>
              }
            >
              {missing.data.map((m) => (
                <tr key={m.sessionId}>
                  <td className="whitespace-nowrap">
                    {fmtDate(m.startsAt, me.tenantTimezone)}{' '}
                    {fmtTime(m.startsAt, me.tenantTimezone)}
                  </td>
                  <td>{m.subjectName}</td>
                  <td>{m.groupName}</td>
                  <td>
                    {m.teachers.map((t) => t.displayName ?? '—').join(', ') || (
                      <Badge tone="amber">Aucun</Badge>
                    )}
                  </td>
                  <td>
                    {m.sheetStatus === 'DRAFT' ? (
                      <Badge tone="amber">Brouillon</Badge>
                    ) : (
                      <Badge tone="red">Non fait</Badge>
                    )}
                  </td>
                  <td className="text-right">
                    {can('TAKE_ATTENDANCE_ANY') && (
                      <Link href={`/attendance/sessions/${m.sessionId}`}>
                        <Button size="sm" variant="secondary">
                          Saisir
                        </Button>
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {tab === 'sheets' && (
        <Card>
          {sheets.isPending && <Loading />}
          {sheets.isError && <ErrorAlert error={sheets.error} />}
          {sheets.data && sheets.data.data.length === 0 && (
            <Empty>Aucune feuille sur la période.</Empty>
          )}
          {sheets.data && sheets.data.data.length > 0 && (
            <Table
              head={
                <>
                  <th>Séance</th>
                  <th>Matière</th>
                  <th>Groupe</th>
                  <th>Appel</th>
                  <th>Soumis le</th>
                  <th></th>
                </>
              }
            >
              {sheets.data.data.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap">
                    {fmtDate(s.session!.startsAt, me.tenantTimezone)}{' '}
                    {fmtTime(s.session!.startsAt, me.tenantTimezone)}
                  </td>
                  <td>{s.session?.subjectName}</td>
                  <td>{s.session?.groupName}</td>
                  <td>
                    <SheetState
                      sheet={{
                        status: s.status,
                        counts: s.counts ?? { present: 0, absent: 0, late: 0 },
                      }}
                    />
                  </td>
                  <td className="text-xs text-slate-500">
                    {s.submittedAt ? fmtDate(s.submittedAt, me.tenantTimezone) : '—'}
                  </td>
                  <td className="text-right">
                    <Link href={`/attendance/sessions/${s.sessionId}`}>
                      <Button size="sm" variant="ghost">
                        Ouvrir
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
