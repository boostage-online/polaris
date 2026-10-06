'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useCan } from '@/components/app-shell';
import {
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
import { fmtDateTime } from '@/lib/format';
import { guardians } from '@/lib/resources';

/** Tuteurs : recherche nom/téléphone, activation du compte parent, création. */
export default function GuardiansPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [activated, setActivated] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const params = {
    q: q || undefined,
    activated: activated === '' ? undefined : activated === 'true',
    limit: 50,
    cursor: cursors.at(-1),
  };
  const list = useQuery({ queryKey: ['guardians', params], queryFn: () => guardians.list(params) });
  const invite = useMutation({
    mutationFn: (id: string) => guardians.invite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guardians'] }),
  });

  return (
    <>
      <PageHeader
        title="Tuteurs"
        subtitle="Le téléphone est l'identifiant du parent : un même numéro = un même tuteur."
        actions={
          can('MANAGE_GUARDIANS') && (
            <Button onClick={() => setCreating(true)}>Nouveau tuteur</Button>
          )
        }
      />
      <Card className="mb-4">
        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setCursors([]);
            void list.refetch();
          }}
        >
          <Field label="Recherche" className="md:col-span-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom ou téléphone"
            />
          </Field>
          <Field label="Compte parent">
            <Select
              value={activated}
              onChange={(e) => {
                setActivated(e.target.value);
                setCursors([]);
              }}
            >
              <option value="">Tous</option>
              <option value="true">Activé</option>
              <option value="false">Non activé</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              Rechercher
            </Button>
          </div>
        </form>
      </Card>
      {list.isPending && <Loading />}
      {list.isError && <ErrorAlert error={list.error} />}
      {invite.error && (
        <div className="mb-3">
          <ErrorAlert error={invite.error} />
        </div>
      )}
      {list.data && (
        <Card>
          {list.data.data.length === 0 ? (
            <Empty>Aucun tuteur.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Nom</th>
                  <th>Téléphone</th>
                  <th>E-mail</th>
                  <th>Canal</th>
                  <th>Compte parent</th>
                  <th></th>
                </>
              }
            >
              {list.data.data.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link
                      href={`/guardians/${g.id}`}
                      className="font-medium text-[var(--color-brand)] hover:underline"
                    >
                      {g.lastName} {g.firstName}
                    </Link>
                  </td>
                  <td className="font-mono text-xs">{g.phone}</td>
                  <td>{g.email ?? '—'}</td>
                  <td>{g.preferredChannel}</td>
                  <td>
                    {g.activated ? (
                      <Badge tone="green">Activé</Badge>
                    ) : g.invitedAt ? (
                      <Badge tone="amber">Invité {fmtDateTime(g.invitedAt)}</Badge>
                    ) : (
                      <Badge>Non invité</Badge>
                    )}
                  </td>
                  <td className="text-right">
                    {can('MANAGE_GUARDIANS') && !g.activated && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={invite.isPending}
                        onClick={() => invite.mutate(g.id)}
                      >
                        {g.invitedAt ? 'Renvoyer le SMS' : 'Inviter'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <div className="mt-3 flex justify-between text-sm">
            <Button
              variant="ghost"
              size="sm"
              disabled={cursors.length === 0}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              ← Précédent
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!list.data.meta.nextCursor}
              onClick={() => {
                const n = list.data.meta.nextCursor;
                if (n) setCursors((c) => [...c, n]);
              }}
            >
              Suivant →
            </Button>
          </div>
        </Card>
      )}
      <CreateGuardianModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateGuardianModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '+229',
    email: '',
    preferredChannel: 'SMS' as 'SMS' | 'WHATSAPP' | 'EMAIL' | 'PUSH',
  });
  const m = useMutation({
    mutationFn: () =>
      guardians.create({
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
    <Modal open={open} title="Nouveau tuteur" onClose={onClose}>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Nom">
          <Input value={form.lastName} onChange={set('lastName')} required autoFocus />
        </Field>
        <Field label="Prénom">
          <Input value={form.firstName} onChange={set('firstName')} required />
        </Field>
        <Field label="Téléphone" hint="+229 01 97 12 34 56">
          <Input value={form.phone} onChange={set('phone')} inputMode="tel" required />
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
