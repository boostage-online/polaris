'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Staff } from '@polaris/contracts';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorAlert,
  Alert,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Table,
} from '@/components/ui';
import { useCan } from '@/components/app-shell';
import { staff, support } from '@/lib/resources';

/** Personnel : qui est enseignant (et peut donc être affecté à un cours), matricule employé, titre. */
export default function StaffPage() {
  const list = useQuery({ queryKey: ['staff'], queryFn: staff.list });
  return (
    <>
      <PageHeader
        title="Personnel"
        subtitle="Les membres sont invités depuis la gestion des accès ; ici on précise leur profil enseignant."
      />
      <Card>
        {list.isPending && <Loading />}
        {list.isError && <ErrorAlert error={list.error} />}
        {list.data && list.data.length === 0 && <Empty>Aucun membre du personnel.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table
            head={
              <>
                <th>Nom</th>
                <th>E-mail</th>
                <th>Rôles</th>
                <th>Enseignant</th>
                <th>Matricule</th>
                <th>Titre</th>
                <th></th>
              </>
            }
          >
            {list.data.map((s) => (
              <StaffRow key={s.membershipId} s={s} />
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function StaffRow({ s }: { s: Staff }) {
  const qc = useQueryClient();
  const can = useCan();
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [reason, setReason] = useState('');
  const reset = useMutation({
    mutationFn: () => support.resetMemberMfa(s.membershipId, reason.trim()),
    onSuccess: () => {
      setResetting(false);
      setReason('');
    },
  });
  const [employeeNumber, setEmployeeNumber] = useState(s.employeeNumber ?? '');
  const [title, setTitle] = useState(s.title ?? '');
  const m = useMutation({
    mutationFn: (b: {
      isTeacher?: boolean;
      employeeNumber?: string | null;
      title?: string | null;
    }) => staff.update(s.membershipId, b),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['staff'] });
      setEditing(false);
    },
  });
  return (
    <>
      <tr>
        <td className="font-medium">{s.displayName ?? '—'}</td>
        <td className="text-slate-600">{s.email ?? '—'}</td>
        <td className="space-x-1">
          {s.roles.map((r) => (
            <Badge key={r.id}>{r.name}</Badge>
          ))}
        </td>
        <td>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.isTeacher}
              disabled={m.isPending}
              onChange={(e) => m.mutate({ isTeacher: e.target.checked })}
            />
            {s.isTeacher ? (
              <Badge tone="green">Oui</Badge>
            ) : (
              <span className="text-slate-500">Non</span>
            )}
          </label>
        </td>
        <td>
          {editing ? (
            <Input
              value={employeeNumber}
              onChange={(e) => setEmployeeNumber(e.target.value)}
              className="w-28"
            />
          ) : (
            <span className="font-mono text-xs">{s.employeeNumber ?? '—'}</span>
          )}
        </td>
        <td>
          {editing ? (
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-40" />
          ) : (
            (s.title ?? '—')
          )}
        </td>
        <td className="whitespace-nowrap text-right">
          {editing ? (
            <>
              <Button
                size="sm"
                disabled={m.isPending}
                onClick={() =>
                  m.mutate({
                    employeeNumber: employeeNumber.trim() || null,
                    title: title.trim() || null,
                  })
                }
              >
                OK
              </Button>{' '}
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Annuler
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Modifier
              </Button>
              {can('RESET_USER_MFA') && (
                <Button size="sm" variant="ghost" onClick={() => setResetting(true)}>
                  Réinitialiser la MFA
                </Button>
              )}
            </>
          )}
        </td>
      </tr>
      {reset.isSuccess && (
        <tr>
          <td colSpan={7}>
            <Alert tone="success">
              MFA réinitialisée : {reset.data?.sessionsRevoked ?? 0} session(s) fermée(s). La
              personne se reconnecte avec son mot de passe et réactive la MFA depuis « Sécurité du
              compte ».
            </Alert>
          </td>
        </tr>
      )}
      {resetting && (
        <Modal
          open
          title={`Réinitialiser la MFA · ${s.displayName ?? s.email ?? ''}`}
          onClose={() => setResetting(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              reset.mutate();
            }}
            className="space-y-3"
          >
            <Alert tone="warning">
              Téléphone perdu, plus de code de récupération : vérifiez l&apos;identité de la
              personne en face à face ou par un canal connu avant de continuer. Toutes ses sessions
              seront fermées. Cette action exige votre propre MFA et est journalisée.
            </Alert>
            <Field label="Motif (journalisé)">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={5}
                required
                placeholder="Ex. : nouveau téléphone, identité vérifiée au secrétariat"
              />
            </Field>
            <ErrorAlert error={reset.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setResetting(false)}>
                Annuler
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={reason.trim().length < 5 || reset.isPending}
              >
                Réinitialiser
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {m.error && (
        <tr>
          <td colSpan={7}>
            <ErrorAlert error={m.error} />
          </td>
        </tr>
      )}
    </>
  );
}
