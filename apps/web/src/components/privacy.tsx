'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { PersonalDataExport } from '@polaris/contracts';
import { Alert, Button, ErrorAlert, Field, Input, Modal } from '@/components/ui';
import { privacy } from '@/lib/resources';

/** Téléchargement d'un export JSON (données d'une personne) côté navigateur. */
export function downloadExport(data: PersonalDataExport) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `donnees-${data.subject.type.toLowerCase()}-${data.subject.id.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Boutons « Exporter les données » et « Anonymiser » d'une fiche (MANAGE_PRIVACY). */
export function PrivacyActions({
  subject,
  id,
  label,
  anonymizable,
}: {
  subject: 'STUDENT' | 'GUARDIAN';
  id: string;
  label: string;
  /** Faux tant que la personne est active (élève) ou a un enfant rattaché (tuteur). */
  anonymizable: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);
  const exp = useMutation({
    mutationFn: () =>
      subject === 'STUDENT' ? privacy.exportStudent(id) : privacy.exportGuardian(id),
    onSuccess: downloadExport,
  });
  const anon = useMutation({
    mutationFn: () =>
      subject === 'STUDENT'
        ? privacy.anonymizeStudent(id, reason.trim(), force)
        : privacy.anonymizeGuardian(id, reason.trim()),
    onSuccess: async () => {
      setOpen(false);
      await qc.invalidateQueries();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    anon.mutate();
  };
  return (
    <>
      <Button variant="secondary" disabled={exp.isPending} onClick={() => exp.mutate()}>
        {exp.isPending ? 'Export…' : 'Exporter les données'}
      </Button>
      {anonymizable && (
        <Button variant="danger" onClick={() => setOpen(true)}>
          Anonymiser
        </Button>
      )}
      <ErrorAlert error={exp.error} />
      <Modal open={open} title={`Anonymiser · ${label}`} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <Alert tone="warning">
            Irréversible : l&apos;identité, les notes, les justificatifs et les notifications sont
            effacés. Les enregistrements de présence et les pièces financières (créances, paiements,
            reçus) sont conservés, conformément aux obligations comptables.
          </Alert>
          <Field label="Motif (journalisé dans le registre des demandes)">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              required
            />
          </Field>
          {subject === 'STUDENT' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              Forcer avant la fin du délai de conservation (demande explicite et documentée)
            </label>
          )}
          <ErrorAlert error={anon.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={anon.isPending || reason.trim().length < 5}
            >
              Anonymiser définitivement
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
