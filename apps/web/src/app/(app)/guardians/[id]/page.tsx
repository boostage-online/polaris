'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useCan } from '@/components/app-shell';
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
  Modal,
  PageHeader,
  Select,
  Table,
} from '@/components/ui';
import { fmtDateTime, RELATIONSHIPS } from '@/lib/format';
import { guardians } from '@/lib/resources';

/** Fiche tuteur : coordonnées, compte parent, enfants rattachés. */
export default function GuardianPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['guardians', id], queryFn: () => guardians.get(id) });
  const [editing, setEditing] = useState(false);
  const invite = useMutation({
    mutationFn: () => guardians.invite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guardians'] }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const g = q.data;
  return (
    <>
      <PageHeader
        title={`${g.lastName} ${g.firstName}`}
        subtitle={<span className="font-mono">{g.phone}</span>}
        actions={
          can('MANAGE_GUARDIANS') && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Modifier
              </Button>
              {!g.activated && (
                <Button disabled={invite.isPending} onClick={() => invite.mutate()}>
                  {g.invitedAt ? 'Renvoyer l’invitation' : 'Inviter (SMS)'}
                </Button>
              )}
            </>
          )
        }
      />
      {invite.isSuccess && (
        <div className="mb-4">
          <Alert tone="success">SMS d&apos;invitation envoyé.</Alert>
        </div>
      )}
      {invite.error && (
        <div className="mb-4">
          <ErrorAlert error={invite.error} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Coordonnées">
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-slate-500">E-mail</dt>
            <dd>{g.email ?? '—'}</dd>
            <dt className="text-slate-500">Canal</dt>
            <dd>{g.preferredChannel}</dd>
            <dt className="text-slate-500">Compte parent</dt>
            <dd>
              {g.activated ? (
                <Badge tone="green">Activé</Badge>
              ) : (
                <Badge tone="amber">Non activé</Badge>
              )}
            </dd>
            <dt className="text-slate-500">Invité le</dt>
            <dd>{g.invitedAt ? fmtDateTime(g.invitedAt) : '—'}</dd>
          </dl>
        </Card>
        <Card title={`Enfants (${g.links?.length ?? 0})`} className="lg:col-span-2">
          {!g.links?.length ? (
            <Empty>Aucun enfant rattaché.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Élève</th>
                  <th>Matricule</th>
                  <th>Lien</th>
                  <th>Droits</th>
                  <th>Depuis</th>
                </>
              }
            >
              {g.links.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link
                      href={`/students/${l.studentId}`}
                      className="font-medium text-[var(--color-brand)] hover:underline"
                    >
                      {l.student?.lastName} {l.student?.firstName}
                    </Link>
                    {l.isPrimary && (
                      <>
                        {' '}
                        <Badge tone="blue">principal</Badge>
                      </>
                    )}
                  </td>
                  <td className="font-mono text-xs">{l.student?.matricule}</td>
                  <td>{RELATIONSHIPS[l.relationship] ?? l.relationship}</td>
                  <td className="space-x-1">
                    {l.canViewAttendance && <Badge tone="green">Assiduité</Badge>}
                    {l.canJustify && <Badge tone="green">Justifier</Badge>}
                    {l.canViewFinance && <Badge tone="green">Frais</Badge>}
                    {l.canPay && <Badge tone="green">Payer</Badge>}
                  </td>
                  <td className="text-xs text-slate-500">{fmtDateTime(l.linkedAt)}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Les droits se modifient depuis la fiche de chaque élève.
          </p>
        </Card>
      </div>
      <EditModal open={editing} onClose={() => setEditing(false)} guardian={g} />
    </>
  );
}

function EditModal({
  open,
  onClose,
  guardian: g,
}: {
  open: boolean;
  onClose: () => void;
  guardian: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    preferredChannel: 'SMS' | 'PUSH' | 'EMAIL' | 'WHATSAPP';
  };
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: g.firstName,
    lastName: g.lastName,
    phone: g.phone,
    email: g.email ?? '',
    preferredChannel: g.preferredChannel,
  });
  const m = useMutation({
    mutationFn: () =>
      guardians.update(g.id, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.replace(/\s/g, ''),
        email: form.email.trim() || null,
        preferredChannel: form.preferredChannel,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['guardians'] });
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Modal open={open} title="Modifier le tuteur" onClose={onClose}>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Nom">
          <Input value={form.lastName} onChange={set('lastName')} required />
        </Field>
        <Field label="Prénom">
          <Input value={form.firstName} onChange={set('firstName')} required />
        </Field>
        <Field
          label="Téléphone"
          hint="Changer le numéro change l'identifiant de connexion du parent."
        >
          <Input value={form.phone} onChange={set('phone')} required />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Canal préféré">
          <Select value={form.preferredChannel} onChange={set('preferredChannel')}>
            <option value="SMS">SMS</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">E-mail</option>
            <option value="PUSH">Notification</option>
          </Select>
        </Field>
        <div className="md:col-span-2">
          <ErrorAlert error={m.error} />
        </div>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" disabled={m.isPending}>
            Enregistrer
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}
