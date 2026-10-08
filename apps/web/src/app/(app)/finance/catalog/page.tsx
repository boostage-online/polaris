'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { FeeCategory, FeeStructure } from '@polaris/contracts';
import { useCan } from '@/components/app-shell';
import { Money } from '@/components/billing';
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
  Tabs,
} from '@/components/ui';
import { fmtDate, fmtXof } from '@/lib/format';
import { billing, groups, programs, years } from '@/lib/resources';

/** Catalogue de frais : catégories (scolarité, cantine…) et grilles avec échéancier type, par année. */
export default function CatalogPage() {
  const can = useCan();
  const [tab, setTab] = useState<'structures' | 'categories'>('structures');
  return (
    <>
      <PageHeader
        title="Catalogue de frais"
        subtitle="Les grilles définissent l'échéancier type ; chaque créance d'élève en garde une copie figée."
        actions={
          can('ASSIGN_FEES') && <LinkButton href="/finance/assign">Affecter des frais</LinkButton>
        }
      />
      <Tabs
        tabs={[
          { id: 'structures', label: 'Grilles' },
          { id: 'categories', label: 'Catégories' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'structures' ? <Structures /> : <Categories />}
    </>
  );
}

// ----------------------------------------------------------------------------- catégories

function Categories() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['billing', 'categories'], queryFn: billing.categories });
  const [form, setForm] = useState({ code: '', name: '' });
  const [editing, setEditing] = useState<FeeCategory | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['billing', 'categories'] });
  const create = useMutation({
    mutationFn: () =>
      billing.createCategory({ code: form.code.trim().toUpperCase(), name: form.name.trim() }),
    onSuccess: async () => {
      await refresh();
      setForm({ code: '', name: '' });
    },
  });
  const update = useMutation({
    mutationFn: (c: FeeCategory) => billing.updateCategory(c.id, { code: c.code, name: c.name }),
    onSuccess: async () => {
      await refresh();
      setEditing(null);
    },
  });
  const remove = useMutation({ mutationFn: billing.removeCategory, onSuccess: refresh });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Catégories" className="lg:col-span-2">
        {q.isPending && <Loading />}
        <ErrorAlert error={q.error ?? remove.error} />
        {q.data && q.data.length === 0 && (
          <Empty>Aucune catégorie : créez « Scolarité » pour commencer.</Empty>
        )}
        {q.data && q.data.length > 0 && (
          <Table
            head={
              <>
                <th>Code</th>
                <th>Nom</th>
                <th className="text-right">Grilles</th>
                <th></th>
              </>
            }
          >
            {q.data.map((c) =>
              editing?.id === c.id ? (
                <tr key={c.id}>
                  <td>
                    <Input
                      value={editing.code}
                      onChange={(e) =>
                        setEditing({ ...editing, code: e.target.value.toUpperCase() })
                      }
                    />
                  </td>
                  <td>
                    <Input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                  </td>
                  <td className="text-right">{c.structureCount ?? 0}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button
                      size="sm"
                      onClick={() => update.mutate(editing)}
                      disabled={update.isPending}
                    >
                      OK
                    </Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Annuler
                    </Button>
                  </td>
                </tr>
              ) : (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td className="font-medium">{c.name}</td>
                  <td className="text-right">{c.structureCount ?? 0}</td>
                  <td className="whitespace-nowrap text-right">
                    {can('MANAGE_FEE_STRUCTURES') && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                          Modifier
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={(c.structureCount ?? 0) > 0}
                          onClick={() => remove.mutate(c.id)}
                        >
                          Supprimer
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ),
            )}
          </Table>
        )}
        <ErrorAlert error={update.error} />
      </Card>
      {can('MANAGE_FEE_STRUCTURES') && (
        <Card title="Nouvelle catégorie">
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Code" hint="Majuscules, ex. SCOLARITE, CANTINE, TRANSPORT">
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                required
              />
            </Field>
            <Field label="Nom">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </Field>
            <ErrorAlert error={create.error} />
            <Button type="submit" disabled={create.isPending}>
              Créer
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- grilles

function Structures() {
  const can = useCan();
  const qc = useQueryClient();
  const yrs = useQuery({ queryKey: ['years'], queryFn: years.list });
  const [yearId, setYearId] = useState('');
  const effectiveYear = yearId || yrs.data?.find((y) => y.isCurrent)?.id || '';
  const q = useQuery({
    queryKey: ['billing', 'structures', effectiveYear],
    queryFn: () => billing.structures(effectiveYear ? { academicYearId: effectiveYear } : {}),
  });
  const [modal, setModal] = useState<null | { mode: 'create' } | { mode: 'edit'; s: FeeStructure }>(
    null,
  );
  const refresh = () => qc.invalidateQueries({ queryKey: ['billing', 'structures'] });
  const archive = useMutation({
    mutationFn: (s: FeeStructure) =>
      billing.updateStructure(s.id, { status: s.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: billing.removeStructure, onSuccess: refresh });
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <Field label="Année scolaire" className="w-56">
          <Select value={effectiveYear} onChange={(e) => setYearId(e.target.value)}>
            {yrs.data?.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
                {y.isCurrent ? ' (courante)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        {can('MANAGE_FEE_STRUCTURES') && (
          <Button onClick={() => setModal({ mode: 'create' })}>Nouvelle grille</Button>
        )}
      </div>
      <ErrorAlert error={q.error ?? archive.error ?? remove.error} />
      {q.isPending && <Loading />}
      {q.data && q.data.length === 0 && (
        <Empty>
          Aucune grille pour cette année. Créez-en une (ex. « Scolarité 6e », 3 tranches).
        </Empty>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {q.data?.map((s) => (
          <Card
            key={s.id}
            title={
              <span className="flex items-center gap-2">
                {s.name}
                <Badge tone={s.status === 'ACTIVE' ? 'green' : 'slate'}>
                  {s.status === 'ACTIVE' ? 'Active' : 'Archivée'}
                </Badge>
              </span>
            }
            actions={
              can('MANAGE_FEE_STRUCTURES') && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setModal({ mode: 'edit', s })}>
                    Modifier
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => archive.mutate(s)}>
                    {s.status === 'ACTIVE' ? 'Archiver' : 'Réactiver'}
                  </Button>
                  {(s.assignedCount ?? 0) === 0 && (
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(s.id)}>
                      Supprimer
                    </Button>
                  )}
                </>
              )
            }
          >
            <p className="text-sm text-slate-600">
              <span className="font-mono text-xs">{s.code}</span> · {s.categoryName} ·{' '}
              <span className="font-semibold">{fmtXof(s.totalAmount)}</span> ·{' '}
              {s.assignedCount ?? 0} créance(s)
            </p>
            <TargetSummary s={s} />
            <Table
              head={
                <>
                  <th>#</th>
                  <th>Tranche</th>
                  <th>Échéance</th>
                  <th className="text-right">Montant</th>
                </>
              }
            >
              {s.schedule.map((i) => (
                <tr key={i.id ?? i.seq}>
                  <td className="text-slate-500">{i.seq}</td>
                  <td>{i.label}</td>
                  <td>{fmtDate(i.dueDate)}</td>
                  <td className="text-right">
                    <Money value={i.amount} />
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}
      </div>
      {modal && (
        <StructureModal
          structure={modal.mode === 'edit' ? modal.s : null}
          yearId={effectiveYear}
          onClose={() => setModal(null)}
          onDone={refresh}
        />
      )}
    </>
  );
}

function TargetSummary({ s }: { s: FeeStructure }) {
  const progs = useQuery({ queryKey: ['programs'], queryFn: programs.list });
  const grps = useQuery({
    queryKey: ['groups', 'year', s.academicYearId],
    queryFn: () => groups.list({ academicYearId: s.academicYearId, kind: 'CLASS' }),
  });
  const levelNames = (progs.data ?? [])
    .flatMap((p) => p.levels ?? [])
    .filter((l) => s.appliesTo.levelIds.includes(l.id))
    .map((l) => l.name);
  const programNames = (progs.data ?? [])
    .filter((p) => s.appliesTo.programIds.includes(p.id))
    .map((p) => p.name);
  const groupNames = (grps.data ?? [])
    .filter((g) => s.appliesTo.groupIds.includes(g.id))
    .map((g) => g.name);
  const all = [...programNames, ...levelNames, ...groupNames];
  return (
    <p className="mb-2 text-xs text-slate-500">
      Cible par défaut : {all.length ? all.join(', ') : 'aucune (choisie à l’affectation)'}
    </p>
  );
}

type Line = { seq: number; label: string; amount: string; dueDate: string };

function StructureModal({
  structure: s,
  yearId,
  onClose,
  onDone,
}: {
  structure: FeeStructure | null;
  yearId: string;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const cats = useQuery({ queryKey: ['billing', 'categories'], queryFn: billing.categories });
  const progs = useQuery({ queryKey: ['programs'], queryFn: programs.list });
  const grps = useQuery({
    queryKey: ['groups', 'year', yearId],
    queryFn: () => groups.list({ academicYearId: yearId, kind: 'CLASS' }),
  });
  const frozen = Boolean(s && (s.assignedCount ?? 0) > 0);
  const [form, setForm] = useState({
    code: s?.code ?? '',
    name: s?.name ?? '',
    categoryId: s?.categoryId ?? '',
    levelIds: s?.appliesTo.levelIds ?? [],
    groupIds: s?.appliesTo.groupIds ?? [],
  });
  const [lines, setLines] = useState<Line[]>(
    s?.schedule.map((i) => ({
      seq: i.seq,
      label: i.label,
      amount: String(i.amount),
      dueDate: i.dueDate,
    })) ?? [{ seq: 1, label: 'Tranche 1', amount: '', dueDate: '' }],
  );
  const total = lines.reduce((t, l) => t + (Number(l.amount) || 0), 0);
  const m = useMutation({
    mutationFn: () => {
      const schedule = lines.map((l) => ({
        seq: l.seq,
        label: l.label.trim(),
        amount: Number(l.amount),
        dueDate: l.dueDate,
      }));
      const appliesTo = { programIds: [], levelIds: form.levelIds, groupIds: form.groupIds };
      if (s)
        return billing.updateStructure(s.id, {
          name: form.name.trim(),
          categoryId: form.categoryId,
          appliesTo,
          ...(frozen ? {} : { schedule }),
        });
      return billing.createStructure({
        academicYearId: yearId || undefined,
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        categoryId: form.categoryId,
        appliesTo,
        schedule,
      });
    },
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const toggle = (k: 'levelIds' | 'groupIds', id: string) =>
    setForm((f) => ({
      ...f,
      [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id],
    }));
  const valid =
    form.name.trim() &&
    form.categoryId &&
    (s || form.code.trim()) &&
    lines.length > 0 &&
    lines.every((l) => l.label.trim() && Number(l.amount) >= 0 && l.dueDate);
  return (
    <Modal
      open
      title={s ? `Modifier « ${s.name} »` : 'Nouvelle grille de frais'}
      onClose={onClose}
      wide
    >
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (valid) m.mutate();
        }}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Code" hint="Ex. SCOL-6E">
            <Input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              disabled={Boolean(s)}
              required={!s}
            />
          </Field>
          <Field label="Nom">
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </Field>
          <Field label="Catégorie">
            <Select
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              required
            >
              <option value="">Choisir…</option>
              {cats.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">
            Cible par défaut (niveaux et/ou classes) — modifiable à l&apos;affectation
          </legend>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-slate-200 p-2 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Niveaux</p>
              <div className="flex flex-wrap gap-2">
                {progs.data?.flatMap((p) =>
                  (p.levels ?? []).map((l) => (
                    <label key={l.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={form.levelIds.includes(l.id)}
                        onChange={() => toggle('levelIds', l.id)}
                      />
                      {l.name}
                    </label>
                  )),
                )}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 p-2 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Classes</p>
              <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                {grps.data?.map((g) => (
                  <label key={g.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.groupIds.includes(g.id)}
                      onChange={() => toggle('groupIds', g.id)}
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Échéancier type</legend>
          {frozen && (
            <Alert tone="warning">
              Cette grille a déjà {s?.assignedCount} créance(s) : l&apos;échéancier est figé. Pour
              un nouveau barème, créez une autre grille ; pour un cas particulier, ajustez la
              créance.
            </Alert>
          )}
          <Table
            head={
              <>
                <th>#</th>
                <th>Libellé</th>
                <th>Échéance</th>
                <th className="text-right">Montant</th>
                <th></th>
              </>
            }
          >
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="w-10 text-slate-500">{l.seq}</td>
                <td>
                  <Input
                    value={l.label}
                    onChange={(e) => setLine(i, { label: e.target.value })}
                    disabled={frozen}
                  />
                </td>
                <td className="w-44">
                  <Input
                    type="date"
                    value={l.dueDate}
                    onChange={(e) => setLine(i, { dueDate: e.target.value })}
                    disabled={frozen}
                  />
                </td>
                <td className="w-40">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    className="text-right"
                    value={l.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                    disabled={frozen}
                  />
                </td>
                <td className="w-10 text-right">
                  {!frozen && lines.length > 1 && (
                    <button
                      type="button"
                      className="text-slate-400 hover:text-red-600"
                      aria-label="Retirer"
                      onClick={() =>
                        setLines((ls) =>
                          ls.filter((_, j) => j !== i).map((x, j) => ({ ...x, seq: j + 1 })),
                        )
                      }
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <div className="mt-2 flex items-center justify-between">
            {!frozen ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    {
                      seq: ls.length + 1,
                      label: `Tranche ${ls.length + 1}`,
                      amount: '',
                      dueDate: '',
                    },
                  ])
                }
              >
                + Ajouter une tranche
              </Button>
            ) : (
              <span />
            )}
            <p className="text-sm">
              Total : <span className="font-semibold tabular-nums">{fmtXof(total)}</span>
            </p>
          </div>
        </fieldset>

        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={m.isPending || !valid}>
            {s ? 'Enregistrer' : 'Créer la grille'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}
