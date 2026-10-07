'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useMe } from '@/components/app-shell';
import {
  Alert,
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
import {
  addDaysIso,
  fmtDateTime,
  todayIso,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  SESSION_STATUS,
} from '@/lib/format';
import { courses, sessions, staff } from '@/lib/resources';

/** Détail d'un cours : enseignants, créneaux récurrents (conflits signalés), séances à venir et séance ponctuelle. */
export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['courses', id], queryFn: () => courses.get(id) });
  const teachers = useQuery({ queryKey: ['staff'], queryFn: staff.list });
  const from = `${todayIso()}T00:00:00.000Z`;
  const to = `${addDaysIso(todayIso(), 30)}T00:00:00.000Z`;
  const upcoming = useQuery({
    queryKey: ['sessions', { courseOfferingId: id, from, to }],
    queryFn: () => sessions.list({ courseOfferingId: id, from, to, limit: 100 }),
  });
  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['courses'] }),
      qc.invalidateQueries({ queryKey: ['sessions'] }),
    ]);

  const [warnings, setWarnings] = useState<string[]>([]);
  const [slot, setSlot] = useState({
    weekday: '1',
    startTime: '08:00',
    endTime: '10:00',
    room: '',
  });
  const addSlot = useMutation({
    mutationFn: () =>
      courses.addSlot(id, {
        weekday: Number(slot.weekday),
        startTime: slot.startTime,
        endTime: slot.endTime,
        room: slot.room.trim() || null,
      }),
    onSuccess: async (res) => {
      setWarnings(res.meta.warnings ?? []);
      await invalidate();
    },
  });
  const removeSlot = useMutation({
    mutationFn: (slotId: string) => courses.removeSlot(slotId),
    onSuccess: invalidate,
  });
  const setTeachers = useMutation({
    mutationFn: (ids: string[]) =>
      courses.setTeachers(
        id,
        ids.map((staffProfileId, i) => ({
          staffProfileId,
          role: i === 0 ? ('MAIN' as const) : ('ASSISTANT' as const),
        })),
      ),
    onSuccess: invalidate,
  });
  const [extra, setExtra] = useState({
    date: todayIso(),
    startTime: '08:00',
    endTime: '09:00',
    room: '',
  });
  const addSession = useMutation({
    mutationFn: () =>
      courses.addSession(id, {
        startsAt: localToIso(extra.date, extra.startTime, me.tenantTimezone),
        endsAt: localToIso(extra.date, extra.endTime, me.tenantTimezone),
        room: extra.room.trim() || null,
      }),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: (sid: string) =>
      sessions.update(sid, { status: 'CANCELLED', cancelReason: 'Annulée par l’administration' }),
    onSuccess: invalidate,
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const c = q.data;
  const teacherIds = c.teachers.map((t) => t.staffProfileId);
  const options = (teachers.data ?? []).filter((t) => t.isTeacher && t.staffProfileId);

  return (
    <>
      <PageHeader
        title={`${c.subjectName ?? 'Cours'} — ${c.groupName ?? ''}`}
        subtitle={c.label ?? undefined}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Enseignants">
          {c.teachers.length === 0 && (
            <div className="mb-3">
              <Alert tone="warning">
                Aucun enseignant : personne ne pourra faire l&apos;appel sur ce cours.
              </Alert>
            </div>
          )}
          <ul className="mb-3 space-y-1 text-sm">
            {c.teachers.map((t) => (
              <li key={t.staffProfileId} className="flex items-center justify-between">
                <span>
                  {t.displayName ?? t.staffProfileId}{' '}
                  <Badge>{t.role === 'MAIN' ? 'principal' : 'assistant'}</Badge>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={setTeachers.isPending}
                  onClick={() =>
                    setTeachers.mutate(teacherIds.filter((x) => x !== t.staffProfileId))
                  }
                >
                  Retirer
                </Button>
              </li>
            ))}
          </ul>
          <Select
            value=""
            onChange={(e) => {
              if (e.target.value) setTeachers.mutate([...teacherIds, e.target.value]);
            }}
          >
            <option value="">Ajouter un enseignant…</option>
            {options
              .filter((t) => !teacherIds.includes(t.staffProfileId ?? ''))
              .map((t) => (
                <option key={t.staffProfileId} value={t.staffProfileId ?? ''}>
                  {t.displayName ?? t.email}
                </option>
              ))}
          </Select>
          <ErrorAlert error={setTeachers.error} />
        </Card>

        <Card title="Créneaux hebdomadaires">
          {(c.slots ?? []).length === 0 ? (
            <Empty>Aucun créneau : aucune séance ne sera générée.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Jour</th>
                  <th>Horaire</th>
                  <th>Salle</th>
                  <th>Validité</th>
                  <th></th>
                </>
              }
            >
              {(c.slots ?? []).map((s) => (
                <tr key={s.id}>
                  <td>{WEEKDAYS[s.weekday]}</td>
                  <td>
                    {s.startTime.slice(0, 5)} – {s.endTime.slice(0, 5)}
                  </td>
                  <td>{s.room ?? '—'}</td>
                  <td className="text-xs text-slate-500">
                    {s.validFrom ?? '…'} → {s.validTo ?? '…'}
                  </td>
                  <td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={removeSlot.isPending}
                      onClick={() => removeSlot.mutate(s.id)}
                    >
                      Supprimer
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <form
            className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              addSlot.mutate();
            }}
          >
            <Field label="Jour">
              <Select
                value={slot.weekday}
                onChange={(e) => setSlot({ ...slot, weekday: e.target.value })}
              >
                {WEEKDAYS_SHORT.slice(1).map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Début">
              <Input
                type="time"
                value={slot.startTime}
                onChange={(e) => setSlot({ ...slot, startTime: e.target.value })}
                required
              />
            </Field>
            <Field label="Fin">
              <Input
                type="time"
                value={slot.endTime}
                onChange={(e) => setSlot({ ...slot, endTime: e.target.value })}
                required
              />
            </Field>
            <Field label="Salle">
              <Input
                value={slot.room}
                onChange={(e) => setSlot({ ...slot, room: e.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" size="sm" variant="secondary" disabled={addSlot.isPending}>
                Ajouter
              </Button>
            </div>
          </form>
          <div className="mt-2 space-y-1">
            <ErrorAlert error={addSlot.error ?? removeSlot.error} />
            {warnings.map((w) => (
              <Alert key={w} tone="warning">
                {w}
              </Alert>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Séances des 30 prochains jours" className="mt-4">
        {upcoming.isPending && <Loading />}
        {upcoming.data && upcoming.data.data.length === 0 && (
          <Empty>
            Aucune séance planifiée. Ajoutez un créneau puis lancez la génération, ou créez une
            séance ponctuelle.
          </Empty>
        )}
        {upcoming.data && upcoming.data.data.length > 0 && (
          <Table
            head={
              <>
                <th>Quand</th>
                <th>Salle</th>
                <th>Statut</th>
                <th></th>
              </>
            }
          >
            {upcoming.data.data.map((s) => (
              <tr key={s.id} className={s.status === 'CANCELLED' ? 'text-slate-400' : ''}>
                <td>
                  {fmtDateTime(s.startsAt, me.tenantTimezone)} →{' '}
                  {fmtDateTime(s.endsAt, me.tenantTimezone).split(' ').pop()}
                </td>
                <td>{s.room ?? '—'}</td>
                <td>
                  <Badge
                    tone={s.status === 'CANCELLED' ? 'red' : s.status === 'HELD' ? 'green' : 'blue'}
                  >
                    {SESSION_STATUS[s.status] ?? s.status}
                  </Badge>
                  {s.cancelReason && <span className="ml-1 text-xs">{s.cancelReason}</span>}
                </td>
                <td className="text-right">
                  {s.status === 'PLANNED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(s.id)}
                    >
                      Annuler
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <form
          className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            addSession.mutate();
          }}
        >
          <Field label="Séance ponctuelle le">
            <Input
              type="date"
              value={extra.date}
              onChange={(e) => setExtra({ ...extra, date: e.target.value })}
              required
            />
          </Field>
          <Field label="Début">
            <Input
              type="time"
              value={extra.startTime}
              onChange={(e) => setExtra({ ...extra, startTime: e.target.value })}
              required
            />
          </Field>
          <Field label="Fin">
            <Input
              type="time"
              value={extra.endTime}
              onChange={(e) => setExtra({ ...extra, endTime: e.target.value })}
              required
            />
          </Field>
          <Field label="Salle">
            <Input
              value={extra.room}
              onChange={(e) => setExtra({ ...extra, room: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" size="sm" variant="secondary" disabled={addSession.isPending}>
              Créer
            </Button>
          </div>
        </form>
        <div className="mt-2">
          <ErrorAlert error={addSession.error ?? cancel.error} />
        </div>
      </Card>
    </>
  );
}

/** Date + heure locales (fuseau de l'établissement) → ISO UTC, via le décalage calculé par Intl. */
function localToIso(date: string, time: string, tz: string | null): string {
  const zone = tz ?? 'UTC';
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
  );
  const offset = asIfUtc - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}
