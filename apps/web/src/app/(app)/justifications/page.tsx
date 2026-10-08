'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Justification } from '@polaris/contracts';
import { useCan } from '@/components/app-shell';
import { JUSTIF_STATUS, StatusBadge } from '@/components/attendance';
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
  Textarea,
} from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { justifications, students } from '@/lib/resources';

/** File des justificatifs : les plus anciens d'abord ; décision avec commentaire ; dépôt par la vie scolaire. */
export default function JustificationsPage() {
  const can = useCan();
  const [status, setStatus] = useState('PENDING');
  const q = useQuery({
    queryKey: ['justifications', status],
    queryFn: () => justifications.list({ status: status || undefined, limit: 100 }),
  });
  const [open, setOpen] = useState<Justification | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Justificatifs"
        subtitle="Un justificatif couvre un intervalle ; accepté, il excuse les absences et retards couverts."
        actions={
          <>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
              <option value="PENDING">À traiter</option>
              <option value="INFO_REQUESTED">Complément demandé</option>
              <option value="APPROVED">Acceptés</option>
              <option value="REJECTED">Refusés</option>
              <option value="">Tous</option>
            </Select>
            {can('REVIEW_JUSTIFICATION', 'TAKE_ATTENDANCE_ANY') && (
              <Button onClick={() => setCreating(true)}>Déposer</Button>
            )}
          </>
        }
      />
      <Card>
        {q.isPending && <Loading />}
        {q.isError && <ErrorAlert error={q.error} />}
        {q.data && q.data.data.length === 0 && <Empty>Rien à traiter.</Empty>}
        {q.data && q.data.data.length > 0 && (
          <Table
            head={
              <>
                <th>Déposé</th>
                <th>Élève</th>
                <th>Période</th>
                <th>Motif</th>
                <th>Par</th>
                <th>Couvre</th>
                <th>Statut</th>
                <th></th>
              </>
            }
          >
            {q.data.data.map((j) => (
              <tr key={j.id}>
                <td className="whitespace-nowrap text-xs text-slate-500">
                  {fmtDateTime(j.createdAt)}
                </td>
                <td>
                  <Link
                    href={`/students/${j.studentId}`}
                    className="font-medium text-[var(--color-brand)] hover:underline"
                  >
                    {j.student?.lastName} {j.student?.firstName}
                  </Link>
                </td>
                <td className="whitespace-nowrap">
                  {fmtDate(j.fromDate)}
                  {j.toDate !== j.fromDate ? ` → ${fmtDate(j.toDate)}` : ''}
                </td>
                <td className="max-w-xs truncate" title={j.reason}>
                  {j.reason}
                  {j.documentName && (
                    <span className="ml-1 text-xs text-slate-500">📎 {j.documentName}</span>
                  )}
                </td>
                <td>
                  {j.submittedByKind === 'GUARDIAN' ? (
                    <Badge tone="blue">Parent</Badge>
                  ) : (
                    <Badge>Vie scolaire</Badge>
                  )}
                </td>
                <td>{j.recordCount} enreg.</td>
                <td>
                  <Badge
                    tone={
                      j.status === 'APPROVED' ? 'green' : j.status === 'REJECTED' ? 'red' : 'amber'
                    }
                  >
                    {JUSTIF_STATUS[j.status] ?? j.status}
                  </Badge>
                </td>
                <td className="text-right">
                  <Button size="sm" variant="secondary" onClick={() => setOpen(j)}>
                    Ouvrir
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {open && <ReviewModal id={open.id} onClose={() => setOpen(null)} />}
      {creating && <CreateModal onClose={() => setCreating(false)} />}
    </>
  );
}

function ReviewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['justifications', 'detail', id],
    queryFn: () => justifications.get(id),
  });
  const [comment, setComment] = useState('');
  const m = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED') =>
      justifications.review(id, { decision, comment: comment.trim() || undefined }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['justifications'] }),
        qc.invalidateQueries({ queryKey: ['attendance'] }),
      ]);
      onClose();
    },
  });
  const j = q.data;
  const decided = j?.status === 'APPROVED' || j?.status === 'REJECTED';
  return (
    <Modal open title="Justificatif" onClose={onClose} wide>
      {q.isPending && <Loading />}
      {j && (
        <div className="space-y-3 text-sm">
          <p>
            <b>
              {j.student?.lastName} {j.student?.firstName}
            </b>{' '}
            · {fmtDate(j.fromDate)}
            {j.toDate !== j.fromDate ? ` → ${fmtDate(j.toDate)}` : ''} · déposé par{' '}
            {j.submittedByKind === 'GUARDIAN' ? 'un parent' : 'la vie scolaire'}
            {j.submittedByName ? ` (${j.submittedByName})` : ''} le {fmtDateTime(j.createdAt)}
          </p>
          <p className="rounded-md bg-slate-50 p-3">
            {j.reason}
            {j.documentName && (
              <>
                <br />
                <span className="text-xs text-slate-500">
                  Document : {j.documentName} (dépôt de fichier à venir avec le stockage objet)
                </span>
              </>
            )}
          </p>
          <div>
            <p className="mb-1 font-medium">Enregistrements couverts ({j.records.length})</p>
            {j.records.length === 0 ? (
              <p className="text-slate-500">
                Aucune absence ni retard soumis sur l&apos;intervalle (le rattachement se fera lors
                des prochains appels).
              </p>
            ) : (
              <ul className="space-y-1">
                {j.records.map((r) => (
                  <li key={r.recordId} className="flex items-center gap-2">
                    {fmtDateTime(r.startsAt)}{' '}
                    <StatusBadge status={r.status} excuse={r.excuseStatus} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {j.reviewComment && <p className="text-slate-600">Commentaire : {j.reviewComment}</p>}
          {decided ? (
            <Badge tone={j.status === 'APPROVED' ? 'green' : 'red'}>
              {JUSTIF_STATUS[j.status]}
            </Badge>
          ) : can('REVIEW_JUSTIFICATION') ? (
            <form className="space-y-2" onSubmit={(e: FormEvent) => e.preventDefault()}>
              <Field label="Commentaire (transmis au parent)">
                <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              <ErrorAlert error={m.error} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={m.isPending} onClick={() => m.mutate('APPROVED')}>
                  Accepter
                </Button>
                <Button
                  variant="danger"
                  disabled={m.isPending}
                  onClick={() => m.mutate('REJECTED')}
                >
                  Refuser
                </Button>
                <Button
                  variant="secondary"
                  disabled={m.isPending || j.status === 'INFO_REQUESTED'}
                  onClick={() => m.mutate('INFO_REQUESTED')}
                >
                  Demander un complément
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const found = useQuery({
    queryKey: ['students', { q: search, limit: 8 }],
    queryFn: () => students.list({ q: search, limit: 8 }),
    enabled: search.trim().length >= 2,
  });
  const [form, setForm] = useState({ fromDate: '', toDate: '', reason: '', documentName: '' });
  const m = useMutation({
    mutationFn: () =>
      justifications.create({
        studentId,
        fromDate: form.fromDate,
        toDate: form.toDate || form.fromDate,
        reason: form.reason,
        documentName: form.documentName || null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['justifications'] });
      onClose();
    },
  });
  return (
    <Modal open title="Déposer un justificatif" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Élève (nom ou matricule)">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setStudentId('');
            }}
            autoFocus
          />
        </Field>
        {found.data && (
          <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 text-sm">
            {found.data.data.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setStudentId(s.id)}
                  className={`w-full px-3 py-1.5 text-left hover:bg-slate-50 ${studentId === s.id ? 'bg-[var(--color-brand)]/10' : ''}`}
                >
                  {s.lastName} {s.firstName}{' '}
                  <span className="font-mono text-xs text-slate-500">{s.matricule}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Du">
            <Input
              type="date"
              value={form.fromDate}
              onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
              required
            />
          </Field>
          <Field label="Au (facultatif)">
            <Input
              type="date"
              value={form.toDate}
              onChange={(e) => setForm({ ...form, toDate: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Motif">
          <Textarea
            rows={3}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            required
          />
        </Field>
        <Field label="Document (nom, facultatif)">
          <Input
            value={form.documentName}
            onChange={(e) => setForm({ ...form, documentName: e.target.value })}
            placeholder="certificat.pdf"
          />
        </Field>
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={m.isPending || !studentId || !form.fromDate || form.reason.trim().length < 3}
          >
            Déposer
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}
