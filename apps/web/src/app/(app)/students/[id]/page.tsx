'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Guardian, GuardianLink, Student } from '@polaris/contracts';
import { useCan } from '@/components/app-shell';
import { PrivacyActions } from '@/components/privacy';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorAlert,
  Field,
  Input,
  LinkButton,
  Loading,
  Modal,
  PageHeader,
  Select,
  Table,
} from '@/components/ui';
import { fmtDate, fmtDateTime, RELATIONSHIPS, STUDENT_STATUS, todayIso } from '@/lib/format';
import { groups, guardians, students } from '@/lib/resources';

/** Fiche élève : identité, inscriptions (historique + actions), tuteurs (liens et droits). */
export default function StudentPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['students', id], queryFn: () => students.get(id) });
  const links = useQuery({
    queryKey: ['students', id, 'guardians'],
    queryFn: () => students.guardians(id),
  });
  const [modal, setModal] = useState<null | 'edit' | 'enroll' | 'transfer' | 'leave' | 'link'>(
    null,
  );
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['students'] }),
      qc.invalidateQueries({ queryKey: ['dashboards'] }),
    ]);

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const s = q.data;
  const active = s.status === 'ACTIVE';

  return (
    <>
      <PageHeader
        title={`${s.lastName} ${s.firstName}`}
        subtitle={
          <>
            <span className="font-mono">{s.matricule}</span> ·{' '}
            <Badge tone={active ? 'green' : 'slate'}>{STUDENT_STATUS[s.status] ?? s.status}</Badge>
            {s.currentGroup && <> · {s.currentGroup.name}</>}
          </>
        }
        actions={
          <>
            {can('MANAGE_PRIVACY') && (
              <PrivacyActions
                subject="STUDENT"
                id={s.id}
                label={`${s.lastName} ${s.firstName}`}
                anonymizable={!active}
              />
            )}
            {can('VIEW_FEES') && (
              <LinkButton href={`/finance/students/${s.id}`}>Frais et paiements</LinkButton>
            )}
            {can('EDIT_STUDENT') && (
              <Button variant="secondary" onClick={() => setModal('edit')}>
                Modifier
              </Button>
            )}
            {can('MANAGE_ENROLLMENTS') && active && (
              <>
                <Button variant="secondary" onClick={() => setModal('enroll')}>
                  Inscrire
                </Button>
                <Button variant="secondary" onClick={() => setModal('transfer')}>
                  Changer de classe
                </Button>
                <Button variant="danger" onClick={() => setModal('leave')}>
                  Départ
                </Button>
              </>
            )}
          </>
        }
      />
      {!s.birthDate && (
        <div className="mb-4">
          <Alert tone="warning">Date de naissance manquante : fiche incomplète.</Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Identité">
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-slate-500">Naissance</dt>
            <dd>{fmtDate(s.birthDate)}</dd>
            <dt className="text-slate-500">Sexe</dt>
            <dd>
              {s.gender === 'F' ? 'Féminin' : s.gender === 'M' ? 'Masculin' : (s.gender ?? '—')}
            </dd>
            <dt className="text-slate-500">Statut</dt>
            <dd>
              {STUDENT_STATUS[s.status] ?? s.status}
              {s.leftAt ? ` (${fmtDate(s.leftAt)})` : ''}
            </dd>
            <dt className="text-slate-500">Notes</dt>
            <dd>{s.notes ?? '—'}</dd>
          </dl>
        </Card>

        <Card title="Inscriptions" className="lg:col-span-2">
          {!s.enrollments?.length ? (
            <Empty>Aucune inscription.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Année</th>
                  <th>Groupe</th>
                  <th>Type</th>
                  <th>Du</th>
                  <th>Au</th>
                  <th>Motif</th>
                  <th></th>
                </>
              }
            >
              {s.enrollments.map((e) => (
                <tr key={e.id} className={e.leftAt ? 'text-slate-500' : ''}>
                  <td>{e.academicYearLabel}</td>
                  <td className="font-medium">{e.groupName}</td>
                  <td>
                    {e.isPrimary ? <Badge tone="blue">Classe</Badge> : <Badge>Sous-groupe</Badge>}
                  </td>
                  <td>{fmtDate(e.enrolledAt)}</td>
                  <td>{e.leftAt ? fmtDate(e.leftAt) : <Badge tone="green">En cours</Badge>}</td>
                  <td>{e.leftReason ?? ''}</td>
                  <td className="text-right">
                    {!e.leftAt && !e.isPrimary && can('MANAGE_ENROLLMENTS') && (
                      <CloseEnrollmentButton enrollmentId={e.id} onDone={refresh} />
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card
        title={`Tuteurs (${links.data?.length ?? 0})`}
        className="mt-4"
        actions={
          can('LINK_GUARDIAN') && (
            <Button size="sm" onClick={() => setModal('link')}>
              Rattacher un tuteur
            </Button>
          )
        }
      >
        {links.isPending && <Loading />}
        {links.data && links.data.length === 0 && (
          <Alert tone="warning">
            Aucun tuteur rattaché : l&apos;élève est invisible côté parents.
          </Alert>
        )}
        {links.data && links.data.length > 0 && (
          <Table
            head={
              <>
                <th>Tuteur</th>
                <th>Téléphone</th>
                <th>Lien</th>
                <th>Droits</th>
                <th>Accès</th>
                <th>Depuis</th>
                <th></th>
              </>
            }
          >
            {links.data.map((l) => (
              <LinkRow
                key={l.id}
                link={l}
                canEdit={can('LINK_GUARDIAN')}
                onChanged={() => qc.invalidateQueries({ queryKey: ['students', id, 'guardians'] })}
              />
            ))}
          </Table>
        )}
      </Card>

      <EditModal
        open={modal === 'edit'}
        student={s}
        onClose={() => setModal(null)}
        onDone={refresh}
      />
      <EnrollModal
        open={modal === 'enroll'}
        student={s}
        onClose={() => setModal(null)}
        onDone={refresh}
      />
      <TransferModal
        open={modal === 'transfer'}
        student={s}
        onClose={() => setModal(null)}
        onDone={refresh}
      />
      <LeaveModal
        open={modal === 'leave'}
        student={s}
        onClose={() => setModal(null)}
        onDone={refresh}
      />
      <LinkModal
        open={modal === 'link'}
        student={s}
        onClose={() => setModal(null)}
        onDone={async () => {
          await qc.invalidateQueries({ queryKey: ['students', id, 'guardians'] });
          await qc.invalidateQueries({ queryKey: ['guardians'] });
        }}
      />
    </>
  );
}

type ModalProps = {
  open: boolean;
  student: Student;
  onClose: () => void;
  onDone: () => Promise<unknown>;
};

function EditModal({ open, student: s, onClose, onDone }: ModalProps) {
  const [form, setForm] = useState({
    firstName: s.firstName,
    lastName: s.lastName,
    birthDate: s.birthDate ?? '',
    gender: s.gender ?? '',
    matricule: s.matricule,
    notes: s.notes ?? '',
  });
  const m = useMutation({
    mutationFn: () =>
      students.update(s.id, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        birthDate: form.birthDate || null,
        gender: (form.gender || null) as 'F' | 'M' | 'X' | null,
        matricule: form.matricule.trim(),
        notes: form.notes.trim() || null,
      }),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Modal open={open} title="Modifier l'élève" onClose={onClose}>
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
        <Field label="Matricule">
          <Input value={form.matricule} onChange={set('matricule')} required />
        </Field>
        <Field label="Notes">
          <Input value={form.notes} onChange={set('notes')} />
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

function GroupSelect({
  value,
  onChange,
  kind,
  exclude,
}: {
  value: string;
  onChange: (v: string) => void;
  kind?: 'CLASS' | 'SUBGROUP';
  exclude?: string[];
}) {
  const q = useQuery({
    queryKey: ['groups', kind ?? 'ALL'],
    queryFn: () => groups.list(kind ? { kind } : {}),
  });
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">Choisir…</option>
      {q.data
        ?.filter((g) => !exclude?.includes(g.id))
        .map((g) => (
          <option key={g.id} value={g.id}>
            {g.kind === 'SUBGROUP' ? '↳ ' : ''}
            {g.name}
            {g.capacity ? ` (${g.studentCount ?? 0}/${g.capacity})` : ''}
          </option>
        ))}
    </Select>
  );
}

function EnrollModal({ open, student: s, onClose, onDone }: ModalProps) {
  const [groupId, setGroupId] = useState('');
  const [date, setDate] = useState(todayIso());
  const m = useMutation({
    mutationFn: () => students.enroll(s.id, { groupId, enrolledAt: date }),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  const activeIds = (s.enrollments ?? []).filter((e) => !e.leftAt).map((e) => e.groupId);
  return (
    <Modal open={open} title="Inscrire dans un groupe" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <p className="text-sm text-slate-600">
          {s.currentGroup
            ? `Déjà en ${s.currentGroup.name} : seule l'inscription à un sous-groupe est possible ici (utilisez « Changer de classe » sinon).`
            : "Choisissez la classe de l'année courante, ou un sous-groupe."}
        </p>
        <Field label="Groupe">
          <GroupSelect
            value={groupId}
            onChange={setGroupId}
            kind={s.currentGroup ? 'SUBGROUP' : undefined}
            exclude={activeIds}
          />
        </Field>
        <Field label="Date d'inscription">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={m.isPending || !groupId}>
            Inscrire
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TransferModal({ open, student: s, onClose, onDone }: ModalProps) {
  const [toGroupId, setToGroupId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () =>
      students.transfer(s.id, { toGroupId, effectiveDate: date, reason: reason || undefined }),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  return (
    <Modal open={open} title="Changer de classe" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <p className="text-sm text-slate-600">
          L&apos;inscription actuelle{s.currentGroup ? ` (${s.currentGroup.name})` : ''} et ses
          sous-groupes seront clôturés à la date choisie ; l&apos;historique est conservé.
        </p>
        <Field label="Nouvelle classe">
          <GroupSelect
            value={toGroupId}
            onChange={setToGroupId}
            kind="CLASS"
            exclude={s.currentGroup ? [s.currentGroup.id] : []}
          />
        </Field>
        <Field label="Date d'effet">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Motif">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Équilibrage, demande des parents…"
          />
        </Field>
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={m.isPending || !toGroupId}>
            Transférer
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LeaveModal({ open, student: s, onClose, onDone }: ModalProps) {
  const [status, setStatus] = useState<'LEFT' | 'GRADUATED'>('LEFT');
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => students.leave(s.id, { status, leftAt: date, reason: reason || undefined }),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  return (
    <Modal open={open} title="Départ de l'élève" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Alert tone="warning">
          Toutes les inscriptions actives seront clôturées. L&apos;élève reste consultable
          (historique, finances).
        </Alert>
        <Field label="Nature">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'LEFT' | 'GRADUATED')}
          >
            <option value="LEFT">Départ (transfert, abandon…)</option>
            <option value="GRADUATED">Fin de scolarité (diplômé)</option>
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Motif">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="danger" disabled={m.isPending}>
            Confirmer le départ
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CloseEnrollmentButton({
  enrollmentId,
  onDone,
}: {
  enrollmentId: string;
  onDone: () => Promise<unknown>;
}) {
  const m = useMutation({
    mutationFn: () => students.closeEnrollment(enrollmentId, { reason: 'Sortie du groupe' }),
    onSuccess: onDone,
  });
  return (
    <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate()}>
      Clore
    </Button>
  );
}

const RIGHTS: {
  key: 'canViewAttendance' | 'canJustify' | 'canViewFinance' | 'canPay';
  label: string;
}[] = [
  { key: 'canViewAttendance', label: 'Assiduité' },
  { key: 'canJustify', label: 'Justifier' },
  { key: 'canViewFinance', label: 'Frais' },
  { key: 'canPay', label: 'Payer' },
];

function LinkRow({
  link: l,
  canEdit,
  onChanged,
}: {
  link: GuardianLink;
  canEdit: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [reason, setReason] = useState('');
  const update = useMutation({
    mutationFn: (b: Parameters<typeof guardians.updateLink>[1]) => guardians.updateLink(l.id, b),
    onSuccess: onChanged,
  });
  const unlink = useMutation({
    mutationFn: () => guardians.unlink(l.id, reason),
    onSuccess: async () => {
      await onChanged();
      setUnlinking(false);
    },
  });
  return (
    <>
      <tr>
        <td>
          <Link
            href={`/guardians/${l.guardianId}`}
            className="font-medium text-[var(--color-brand)] hover:underline"
          >
            {l.guardian?.lastName} {l.guardian?.firstName}
          </Link>
          {l.isPrimary && <Badge tone="blue">principal</Badge>}
        </td>
        <td className="font-mono text-xs">{l.guardian?.phone}</td>
        <td>
          {editing && canEdit ? (
            <Select
              value={l.relationship}
              onChange={(e) =>
                update.mutate({ relationship: e.target.value as GuardianLink['relationship'] })
              }
            >
              {Object.entries(RELATIONSHIPS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          ) : (
            (RELATIONSHIPS[l.relationship] ?? l.relationship)
          )}
        </td>
        <td>
          <div className="flex flex-wrap gap-1">
            {RIGHTS.map((r) =>
              editing && canEdit ? (
                <label key={r.key} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={l[r.key]}
                    onChange={(e) => {
                      const body: Parameters<typeof guardians.updateLink>[1] = {};
                      body[r.key] = e.target.checked;
                      update.mutate(body);
                    }}
                  />
                  {r.label}
                </label>
              ) : (
                l[r.key] && (
                  <Badge key={r.key} tone="green">
                    {r.label}
                  </Badge>
                )
              ),
            )}
          </div>
        </td>
        <td>
          {l.guardian?.activated ? (
            <Badge tone="green">Activé</Badge>
          ) : (
            <Badge tone="amber">Non activé</Badge>
          )}
        </td>
        <td className="text-xs text-slate-500">{fmtDateTime(l.linkedAt)}</td>
        <td className="whitespace-nowrap text-right">
          {canEdit && (
            <>
              {!l.isPrimary && editing && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => update.mutate({ isPrimary: true })}
                >
                  Rendre principal
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
                {editing ? 'OK' : 'Droits'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setUnlinking(true)}>
                Détacher
              </Button>
            </>
          )}
        </td>
      </tr>
      {unlinking && (
        <tr>
          <td colSpan={7} className="bg-red-50">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                unlink.mutate();
              }}
            >
              <Field
                label="Motif du détachement (obligatoire, historisé)"
                className="min-w-64 flex-1"
              >
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={3}
                  required
                />
              </Field>
              <Button
                type="submit"
                variant="danger"
                size="sm"
                disabled={unlink.isPending || reason.trim().length < 3}
              >
                Confirmer
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setUnlinking(false)}
              >
                Annuler
              </Button>
              <div className="basis-full">
                <ErrorAlert error={unlink.error} />
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function LinkModal({ open, student: s, onClose, onDone }: ModalProps) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Guardian | null>(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: s.lastName,
    phone: '+229',
    email: '',
  });
  const [relationship, setRelationship] = useState<GuardianLink['relationship']>('MOTHER');
  const [rights, setRights] = useState({
    isPrimary: false,
    canViewAttendance: true,
    canJustify: true,
    canViewFinance: true,
    canPay: true,
  });
  const found = useQuery({
    queryKey: ['guardians', { q: search, limit: 8 }],
    queryFn: () => guardians.list({ q: search, limit: 8 }),
    enabled: mode === 'existing' && search.trim().length >= 2,
  });
  const m = useMutation({
    mutationFn: () =>
      students.linkGuardian(s.id, {
        ...(mode === 'existing'
          ? { guardianId: picked?.id }
          : {
              guardian: {
                firstName: form.firstName.trim(),
                lastName: form.lastName.trim(),
                phone: form.phone.replace(/\s/g, ''),
                email: form.email.trim() || null,
              },
            }),
        relationship,
        ...rights,
      }),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const ready =
    mode === 'existing'
      ? Boolean(picked)
      : Boolean(
          form.firstName &&
          form.lastName &&
          /^\+[1-9]\d{6,14}$/.test(form.phone.replace(/\s/g, '')),
        );
  return (
    <Modal open={open} title={`Rattacher un tuteur à ${s.firstName}`} onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === 'existing' ? 'primary' : 'secondary'}
            onClick={() => setMode('existing')}
          >
            Tuteur existant
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'new' ? 'primary' : 'secondary'}
            onClick={() => setMode('new')}
          >
            Nouveau tuteur
          </Button>
        </div>
        {mode === 'existing' ? (
          <div className="space-y-2">
            <Field label="Rechercher (nom ou téléphone)">
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPicked(null);
                }}
                autoFocus
              />
            </Field>
            {found.data && (
              <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 text-sm">
                {found.data.data.length === 0 && (
                  <li className="px-3 py-2 text-slate-500">
                    Aucun tuteur : créez-le dans l&apos;onglet « Nouveau tuteur ».
                  </li>
                )}
                {found.data.data.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(g)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50 ${picked?.id === g.id ? 'bg-[var(--color-brand)]/10' : ''}`}
                    >
                      <span>
                        {g.lastName} {g.firstName}
                      </span>
                      <span className="font-mono text-xs text-slate-500">{g.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nom">
              <Input value={form.lastName} onChange={set('lastName')} required />
            </Field>
            <Field label="Prénom">
              <Input value={form.firstName} onChange={set('firstName')} required />
            </Field>
            <Field
              label="Téléphone (identifiant du parent)"
              hint="Format international : +229 01 97 12 34 56"
            >
              <Input value={form.phone} onChange={set('phone')} inputMode="tel" required />
            </Field>
            <Field label="E-mail (facultatif)">
              <Input type="email" value={form.email} onChange={set('email')} />
            </Field>
            <p className="text-xs text-slate-500 md:col-span-2">
              Si ce téléphone existe déjà, le tuteur existant est réutilisé.
            </p>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Lien de parenté">
            <Select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value as GuardianLink['relationship'])}
            >
              {Object.entries(RELATIONSHIPS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="text-sm">
            <legend className="mb-1 font-medium text-slate-700">Droits</legend>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={rights.isPrimary}
                  onChange={(e) => setRights((r) => ({ ...r, isPrimary: e.target.checked }))}
                />{' '}
                Contact principal
              </label>
              {RIGHTS.map((r) => (
                <label key={r.key} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={rights[r.key]}
                    onChange={(e) => setRights((x) => ({ ...x, [r.key]: e.target.checked }))}
                  />{' '}
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={m.isPending || !ready}>
            Rattacher
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}
