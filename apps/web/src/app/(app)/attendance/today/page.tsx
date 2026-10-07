'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '@/components/app-shell';
import { SheetState } from '@/components/attendance';
import {
  Button,
  Card,
  Empty,
  ErrorAlert,
  Field,
  Input,
  Loading,
  PageHeader,
} from '@/components/ui';
import { fmtTime, todayIso } from '@/lib/format';
import { attendance } from '@/lib/resources';

/** Mes appels du jour : séance par séance, l'état de l'appel et un seul geste vers la feuille. */
export default function TodayPage() {
  const me = useMe();
  const [date, setDate] = useState(todayIso());
  const q = useQuery({
    queryKey: ['attendance', 'today', date],
    queryFn: () => attendance.today(date),
    refetchInterval: 60_000,
  });
  const next = q.data?.find((s) => s.isNext);
  return (
    <>
      <PageHeader
        title="Mes appels"
        subtitle="Un appel se fait en moins d'une minute : ouvrez la séance, touchez les absents, validez."
        actions={
          <Field label="Jour">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        }
      />
      {q.isPending && <Loading />}
      {q.isError && <ErrorAlert error={q.error} />}
      {next && (
        <Link
          href={`/attendance/sessions/${next.id}`}
          className="mb-4 block rounded-lg border-2 border-[var(--color-brand)] bg-white p-4 shadow-sm hover:bg-slate-50"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
            Prochain cours
          </p>
          <p className="mt-1 text-lg font-semibold">
            {next.subjectName} — {next.groupName}
          </p>
          <p className="text-sm text-slate-600">
            {fmtTime(next.startsAt, me.tenantTimezone)} – {fmtTime(next.endsAt, me.tenantTimezone)}
            {next.room ? ` · ${next.room}` : ''}
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--color-brand)]">
            {next.sheet?.status === 'DRAFT' ? "Reprendre l'appel →" : "Faire l'appel →"}
          </p>
        </Link>
      )}
      {q.data && q.data.length === 0 && <Empty>Aucune séance ce jour.</Empty>}
      <div className="space-y-2">
        {q.data?.map((s) => (
          <Card key={s.id} className={s.isNext ? 'opacity-60' : ''}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {s.subjectName} <span className="text-slate-500">— {s.groupName}</span>
                </p>
                <p className="text-sm text-slate-600">
                  {fmtTime(s.startsAt, me.tenantTimezone)} – {fmtTime(s.endsAt, me.tenantTimezone)}
                  {s.room ? ` · ${s.room}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <SheetState sheet={s.sheet} />
                <Link href={`/attendance/sessions/${s.id}`}>
                  <Button
                    size="sm"
                    variant={s.sheet && s.sheet.status !== 'DRAFT' ? 'secondary' : 'primary'}
                  >
                    {!s.sheet ? "Faire l'appel" : s.sheet.status === 'DRAFT' ? 'Reprendre' : 'Voir'}
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
