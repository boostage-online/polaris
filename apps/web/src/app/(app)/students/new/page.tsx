'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Card, ErrorAlert, Field, Input, PageHeader, Select } from '@/components/ui';
import { groups, students } from '@/lib/resources';

/** Création d'un élève : matricule facultatif (généré), inscription immédiate dans une classe. */
export default function NewStudentPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const classes = useQuery({
    queryKey: ['groups', 'CLASS'],
    queryFn: () => groups.list({ kind: 'CLASS' }),
  });
  const [form, setForm] = useState({
    matricule: '',
    firstName: '',
    lastName: '',
    birthDate: '',
    gender: '',
    groupId: '',
    notes: '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: () =>
      students.create({
        matricule: form.matricule.trim() || undefined,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        birthDate: form.birthDate || null,
        gender: (form.gender || null) as 'F' | 'M' | 'X' | null,
        groupId: form.groupId || undefined,
        notes: form.notes.trim() || null,
      }),
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: ['students'] });
      router.replace(`/students/${s.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <>
      <PageHeader
        title="Nouvel élève"
        subtitle="Le matricule est généré automatiquement s'il est laissé vide."
      />
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
          <Field label="Nom">
            <Input value={form.lastName} onChange={set('lastName')} required autoFocus />
          </Field>
          <Field label="Prénom(s)">
            <Input value={form.firstName} onChange={set('firstName')} required />
          </Field>
          <Field label="Date de naissance">
            <Input type="date" value={form.birthDate} onChange={set('birthDate')} />
          </Field>
          <Field label="Sexe">
            <Select value={form.gender} onChange={set('gender')}>
              <option value="">—</option>
              <option value="F">Féminin</option>
              <option value="M">Masculin</option>
              <option value="X">Autre</option>
            </Select>
          </Field>
          <Field label="Matricule" hint="Laissez vide pour le générer (ANNÉE-00001).">
            <Input value={form.matricule} onChange={set('matricule')} />
          </Field>
          <Field label="Classe (année courante)">
            <Select value={form.groupId} onChange={set('groupId')}>
              <option value="">Inscrire plus tard</option>
              {classes.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.capacity ? ` (${g.studentCount ?? 0}/${g.capacity})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" className="md:col-span-2">
            <Input value={form.notes} onChange={set('notes')} />
          </Field>
          <div className="md:col-span-2">
            <ErrorAlert error={create.error} />
          </div>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" disabled={create.isPending || !form.firstName || !form.lastName}>
              Créer l&apos;élève
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Annuler
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
