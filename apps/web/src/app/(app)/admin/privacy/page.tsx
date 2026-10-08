'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
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
import { fmtDateTime } from '@/lib/format';
import { downloadExport } from '@/components/privacy';
import { privacy } from '@/lib/resources';

const KIND: Record<string, string> = { EXPORT: 'Export', ERASURE: 'Anonymisation' };
const SOURCE: Record<string, string> = {
  MANUAL: 'demande traitée par l’établissement',
  RETENTION: 'rétention automatique',
  SELF_SERVICE: 'par la personne elle-même',
};

/** Données personnelles (Partie 11) : registre des demandes, export et anonymisation sur identifiant. */
export default function PrivacyPage() {
  const qc = useQueryClient();
  const reg = useQuery({ queryKey: ['privacy', 'requests'], queryFn: privacy.requests });
  const [subject, setSubject] = useState<'STUDENT' | 'GUARDIAN'>('STUDENT');
  const [id, setId] = useState('');
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['privacy'] });
  const exp = useMutation({
    mutationFn: () =>
      subject === 'STUDENT' ? privacy.exportStudent(id.trim()) : privacy.exportGuardian(id.trim()),
    onSuccess: (data) => {
      downloadExport(data);
      return invalidate();
    },
  });
  const anon = useMutation({
    mutationFn: () =>
      subject === 'STUDENT'
        ? privacy.anonymizeStudent(id.trim(), reason.trim(), force)
        : privacy.anonymizeGuardian(id.trim(), reason.trim()),
    onSuccess: invalidate,
  });
  const submitAnon = (e: FormEvent) => {
    e.preventDefault();
    anon.mutate();
  };
  return (
    <>
      <PageHeader
        title="Données personnelles"
        subtitle="Export et anonymisation outillés (loi 2017-20 / RGPD). Les pièces financières sont conservées 10 ans ; l'anonymisation efface l'identité, les notes, les justificatifs et les notifications."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Traiter une demande">
          <form onSubmit={submitAnon} className="space-y-3">
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <Field label="Personne">
                <Select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value as 'STUDENT' | 'GUARDIAN')}
                >
                  <option value="STUDENT">Élève</option>
                  <option value="GUARDIAN">Tuteur</option>
                </Select>
              </Field>
              <Field
                label="Identifiant (depuis la fiche)"
                hint="Les fiches élève et tuteur proposent aussi ces actions directement."
              >
                <Input
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="uuid"
                  required
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={!id.trim() || exp.isPending}
                onClick={() => exp.mutate()}
              >
                {exp.isPending ? 'Export…' : 'Exporter les données (JSON)'}
              </Button>
            </div>
            <hr className="border-slate-100" />
            <Field label="Motif de l'anonymisation (journalisé)">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={5}
                placeholder="Demande écrite de la famille du …"
              />
            </Field>
            {subject === 'STUDENT' && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                />
                Forcer avant la fin du délai de conservation (demande explicite documentée)
              </label>
            )}
            <Alert tone="warning">
              Irréversible. Un élève doit avoir quitté l&apos;établissement ; un tuteur ne doit plus
              avoir d&apos;enfant rattaché.
            </Alert>
            <ErrorAlert error={exp.error ?? anon.error} />
            {anon.data && (
              <Alert tone="success">
                Anonymisation faite le {fmtDateTime(anon.data.anonymizedAt)} :{' '}
                {Object.entries(anon.data.touched)
                  .map(([t, n]) => `${t} ${n}`)
                  .join(', ')}
                .
              </Alert>
            )}
            <Button
              type="submit"
              variant="danger"
              disabled={!id.trim() || reason.trim().length < 5 || anon.isPending}
            >
              Anonymiser
            </Button>
          </form>
        </Card>
        <Card title="Registre des demandes (100 dernières)">
          {reg.isPending && <Loading />}
          <ErrorAlert error={reg.error} />
          {reg.data &&
            (reg.data.length === 0 ? (
              <Empty>Aucune demande enregistrée.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th>Quand</th>
                    <th>Type</th>
                    <th>Personne</th>
                    <th>Origine</th>
                    <th>Par</th>
                  </>
                }
              >
                {reg.data.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs text-slate-500">
                      {fmtDateTime(r.createdAt)}
                    </td>
                    <td>
                      <Badge tone={r.kind === 'ERASURE' ? 'red' : 'blue'}>
                        {KIND[r.kind] ?? r.kind}
                      </Badge>
                    </td>
                    <td className="text-xs">
                      {r.subjectType === 'STUDENT' ? 'Élève' : 'Tuteur'}{' '}
                      <span className="font-mono text-slate-400">{r.subjectId.slice(0, 8)}</span>
                      {r.reason && <p className="text-slate-600">{r.reason}</p>}
                    </td>
                    <td className="text-xs">{SOURCE[r.source] ?? r.source}</td>
                    <td className="text-xs">{r.requestedByName ?? 'système'}</td>
                  </tr>
                ))}
              </Table>
            ))}
        </Card>
      </div>
    </>
  );
}
