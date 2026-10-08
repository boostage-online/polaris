'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorAlert,
  Field,
  Loading,
  Modal,
  PageHeader,
  Select,
  Table,
} from '@/components/ui';
import { WEEKDAYS_SHORT } from '@/lib/format';
import { courses, groups, sessions, staff, subjects } from '@/lib/resources';

/** Cours de l'année courante (matière × groupe), enseignants, créneaux ; génération des séances. */
export default function CoursesPage() {
  const qc = useQueryClient();
  const [groupId, setGroupId] = useState('');
  const list = useQuery({
    queryKey: ['courses', { groupId }],
    queryFn: () => courses.list(groupId ? { groupId } : {}),
  });
  const grps = useQuery({ queryKey: ['groups', 'ALL'], queryFn: () => groups.list({}) });
  const [creating, setCreating] = useState(false);
  const generate = useMutation({
    mutationFn: () => sessions.generate(14),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => courses.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses'] }),
  });
  return (
    <>
      <PageHeader
        title="Cours et emplois du temps"
        subtitle="Un cours = une matière enseignée à un groupe. Ses créneaux hebdomadaires engendrent les séances."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
            >
              Générer les séances (14 j)
            </Button>
            <Button onClick={() => setCreating(true)}>Nouveau cours</Button>
          </>
        }
      />
      {generate.data && (
        <div className="mb-4">
          <Alert tone="success">
            {generate.data.created} séance(s) créée(s) sur {generate.data.scanned} examinée(s). La
            génération est automatique chaque nuit.
          </Alert>
        </div>
      )}
      {generate.error && (
        <div className="mb-4">
          <ErrorAlert error={generate.error} />
        </div>
      )}
      <Card
        actions={
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-48">
            <option value="">Tous les groupes</option>
            {grps.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        }
        title="Cours de l'année courante"
      >
        {list.isPending && <Loading />}
        {list.isError && <ErrorAlert error={list.error} />}
        <ErrorAlert error={remove.error} />
        {list.data && list.data.length === 0 && (
          <Empty>Aucun cours. Créez-en un à partir d&apos;une matière et d&apos;un groupe.</Empty>
        )}
        {list.data && list.data.length > 0 && (
          <Table
            head={
              <>
                <th>Matière</th>
                <th>Groupe</th>
                <th>Enseignant(s)</th>
                <th>Créneaux</th>
                <th></th>
              </>
            }
          >
            {list.data.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link
                    href={`/courses/${c.id}`}
                    className="font-medium text-[var(--color-brand)] hover:underline"
                  >
                    {c.subjectName}
                  </Link>
                  {c.label && <span className="ml-1 text-xs text-slate-500">{c.label}</span>}
                </td>
                <td>{c.groupName}</td>
                <td>
                  {c.teachers.length === 0 ? (
                    <Badge tone="amber">Aucun</Badge>
                  ) : (
                    c.teachers.map((t) => t.displayName ?? '—').join(', ')
                  )}
                </td>
                <td className="space-x-1">
                  {(c.slots ?? []).length === 0 && <Badge tone="amber">Aucun</Badge>}
                  {(c.slots ?? []).map((s) => (
                    <Badge key={s.id} tone="blue">
                      {WEEKDAYS_SHORT[s.weekday]} {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}
                    </Badge>
                  ))}
                </td>
                <td className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(c.id)}
                  >
                    Supprimer
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {creating && <CourseModal onClose={() => setCreating(false)} />}
    </>
  );
}

function CourseModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const subs = useQuery({ queryKey: ['subjects'], queryFn: subjects.list });
  const grps = useQuery({ queryKey: ['groups', 'ALL'], queryFn: () => groups.list({}) });
  const teachers = useQuery({ queryKey: ['staff'], queryFn: staff.list });
  const [form, setForm] = useState({ subjectId: '', groupId: '', staffProfileId: '' });
  const m = useMutation({
    mutationFn: () =>
      courses.create({
        subjectId: form.subjectId,
        groupId: form.groupId,
        teachers: form.staffProfileId
          ? [{ staffProfileId: form.staffProfileId, role: 'MAIN' }]
          : [],
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['courses'] });
      onClose();
    },
  });
  const teacherOptions = (teachers.data ?? []).filter((t) => t.isTeacher && t.staffProfileId);
  return (
    <Modal open title="Nouveau cours" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Matière">
          <Select
            value={form.subjectId}
            onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
            required
          >
            <option value="">Choisir…</option>
            {subs.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Groupe">
          <Select
            value={form.groupId}
            onChange={(e) => setForm({ ...form, groupId: e.target.value })}
            required
          >
            <option value="">Choisir…</option>
            {grps.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.kind === 'SUBGROUP' ? '↳ ' : ''}
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Enseignant principal" hint="Les enseignants se déclarent dans « Personnel ».">
          <Select
            value={form.staffProfileId}
            onChange={(e) => setForm({ ...form, staffProfileId: e.target.value })}
          >
            <option value="">À affecter plus tard</option>
            {teacherOptions.map((t) => (
              <option key={t.staffProfileId} value={t.staffProfileId ?? ''}>
                {t.displayName ?? t.email}
              </option>
            ))}
          </Select>
        </Field>
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={m.isPending || !form.subjectId || !form.groupId}>
            Créer
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}
