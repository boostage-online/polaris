'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { Group, Program } from '@polaris/contracts';
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
  Tabs,
} from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { groups, programs, subjects, years } from '@/lib/resources';

type Tab = 'years' | 'programs' | 'groups' | 'subjects';

/** Structure académique : années et périodes, programmes et niveaux, classes et sous-groupes, matières. */
export default function StructurePage() {
  const [tab, setTab] = useState<Tab>('groups');
  return (
    <>
      <PageHeader
        title="Structure académique"
        subtitle="Le squelette sur lequel reposent les inscriptions, les cours et l'appel."
      />
      <Tabs
        tabs={[
          { id: 'groups', label: 'Classes et groupes' },
          { id: 'years', label: 'Années et périodes' },
          { id: 'programs', label: 'Programmes et niveaux' },
          { id: 'subjects', label: 'Matières' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'years' && <YearsTab />}
      {tab === 'programs' && <ProgramsTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'subjects' && <SubjectsTab />}
    </>
  );
}

const useInvalidate = () => {
  const qc = useQueryClient();
  return (...keys: string[]) =>
    Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
};

// ----------------------------------------------------------------------------- années
function YearsTab() {
  const inv = useInvalidate();
  const list = useQuery({ queryKey: ['years'], queryFn: years.list });
  const [form, setForm] = useState({ label: '', startDate: '', endDate: '' });
  const [termsFor, setTermsFor] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => years.create({ ...form, isCurrent: false }),
    onSuccess: async () => {
      await inv('years');
      setForm({ label: '', startDate: '', endDate: '' });
    },
  });
  const setCurrent = useMutation({
    mutationFn: (id: string) => years.setCurrent(id),
    onSuccess: () => inv('years', 'groups', 'courses', 'students', 'dashboards'),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Années académiques" className="lg:col-span-2">
        {list.isPending && <Loading />}
        {list.data && (
          <Table
            head={
              <>
                <th>Libellé</th>
                <th>Du</th>
                <th>Au</th>
                <th>Courante</th>
                <th></th>
              </>
            }
          >
            {list.data.map((y) => (
              <tr key={y.id}>
                <td className="font-medium">{y.label}</td>
                <td>{fmtDate(y.startDate)}</td>
                <td>{fmtDate(y.endDate)}</td>
                <td>
                  {y.isCurrent ? (
                    <Badge tone="green">Courante</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={setCurrent.isPending}
                      onClick={() => setCurrent.mutate(y.id)}
                    >
                      Rendre courante
                    </Button>
                  )}
                </td>
                <td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setTermsFor(y.id)}>
                    Périodes
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <ErrorAlert error={setCurrent.error} />
      </Card>
      <Card title="Nouvelle année">
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Libellé">
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="2027-2028"
              required
            />
          </Field>
          <Field label="Début">
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              required
            />
          </Field>
          <Field label="Fin">
            <Input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              required
            />
          </Field>
          <ErrorAlert error={create.error} />
          <Button type="submit" disabled={create.isPending}>
            Créer
          </Button>
        </form>
      </Card>
      {termsFor && (
        <TermsModal
          yearId={termsFor}
          label={list.data?.find((y) => y.id === termsFor)?.label ?? ''}
          onClose={() => setTermsFor(null)}
        />
      )}
    </div>
  );
}

function TermsModal({
  yearId,
  label,
  onClose,
}: {
  yearId: string;
  label: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['terms', yearId], queryFn: () => years.terms(yearId) });
  const [form, setForm] = useState({ label: '', startDate: '', endDate: '' });
  const add = useMutation({
    mutationFn: () => years.addTerm(yearId, form),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['terms', yearId] });
      setForm({ label: '', startDate: '', endDate: '' });
    },
  });
  return (
    <Modal open title={`Périodes — ${label}`} onClose={onClose}>
      {list.isPending && <Loading />}
      {list.data && list.data.length === 0 && (
        <Empty>Aucune période (trimestres, semestres) : facultatif.</Empty>
      )}
      {list.data && list.data.length > 0 && (
        <Table
          head={
            <>
              <th>Libellé</th>
              <th>Du</th>
              <th>Au</th>
            </>
          }
        >
          {list.data.map((t) => (
            <tr key={t.id}>
              <td>{t.label}</td>
              <td>{fmtDate(t.startDate)}</td>
              <td>{fmtDate(t.endDate)}</td>
            </tr>
          ))}
        </Table>
      )}
      <form
        className="mt-4 grid gap-3 md:grid-cols-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Libellé">
          <Input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Trimestre 1"
            required
          />
        </Field>
        <Field label="Début">
          <Input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            required
          />
        </Field>
        <Field label="Fin">
          <Input
            type="date"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            required
          />
        </Field>
        <div className="md:col-span-3">
          <ErrorAlert error={add.error} />
        </div>
        <div className="md:col-span-3">
          <Button type="submit" size="sm" disabled={add.isPending}>
            Ajouter la période
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------------------- programmes
function ProgramsTab() {
  const inv = useInvalidate();
  const list = useQuery({ queryKey: ['programs'], queryFn: programs.list });
  const [form, setForm] = useState({ code: '', name: '' });
  const create = useMutation({
    mutationFn: () => programs.create(form),
    onSuccess: async () => {
      await inv('programs');
      setForm({ code: '', name: '' });
    },
  });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {list.isPending && <Loading />}
        {list.data?.map((p) => (
          <ProgramCard key={p.id} program={p} />
        ))}
        {list.data && list.data.length === 0 && (
          <Empty>
            Aucun programme. Les écoles n&apos;en ont souvent qu&apos;un (« Enseignement général »).
          </Empty>
        )}
      </div>
      <Card title="Nouveau programme / filière">
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Code" hint="Court, sans espace (ex. GEN, INFO-L)">
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              required
            />
          </Field>
          <Field label="Nom">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </Field>
          <ErrorAlert error={create.error} />
          <Button type="submit" disabled={create.isPending}>
            Créer
          </Button>
        </form>
      </Card>
    </div>
  );
}

function ProgramCard({ program: p }: { program: Program }) {
  const inv = useInvalidate();
  const [name, setName] = useState('');
  const [rank, setRank] = useState(String((p.levels?.length ?? 0) + 1));
  const addLevel = useMutation({
    mutationFn: () => programs.addLevel(p.id, { name, rank: Number(rank) }),
    onSuccess: async () => {
      await inv('programs');
      setName('');
      setRank((r) => String(Number(r) + 1));
    },
  });
  const remove = useMutation({
    mutationFn: () => programs.remove(p.id),
    onSuccess: () => inv('programs'),
  });
  return (
    <Card
      title={
        <>
          {p.name} <span className="ml-2 font-mono text-xs text-slate-500">{p.code}</span>
          {p.isDefault && <Badge>par défaut</Badge>}
        </>
      }
      actions={
        <Button
          size="sm"
          variant="danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Supprimer
        </Button>
      }
    >
      <ErrorAlert error={remove.error} />
      <div className="flex flex-wrap gap-1.5">
        {(p.levels ?? []).map((l) => (
          <Badge key={l.id} tone="blue">
            {l.rank}. {l.name}
          </Badge>
        ))}
        {!p.levels?.length && <span className="text-sm text-slate-500">Aucun niveau.</span>}
      </div>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          addLevel.mutate();
        }}
      >
        <Field label="Nouveau niveau" className="w-40">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="6e, L1, CP…"
            required
          />
        </Field>
        <Field label="Rang" className="w-20">
          <Input type="number" min={0} value={rank} onChange={(e) => setRank(e.target.value)} />
        </Field>
        <Button type="submit" size="sm" variant="secondary" disabled={addLevel.isPending}>
          Ajouter
        </Button>
        <div className="basis-full">
          <ErrorAlert error={addLevel.error} />
        </div>
      </form>
    </Card>
  );
}

// ----------------------------------------------------------------------------- groupes
function GroupsTab() {
  const inv = useInvalidate();
  const yrs = useQuery({ queryKey: ['years'], queryFn: years.list });
  const current = yrs.data?.find((y) => y.isCurrent);
  const [yearId, setYearId] = useState('');
  const effectiveYear = yearId || current?.id || '';
  const list = useQuery({
    queryKey: ['groups', 'year', effectiveYear],
    queryFn: () => groups.list({ academicYearId: effectiveYear }),
    enabled: Boolean(effectiveYear),
  });
  const progs = useQuery({ queryKey: ['programs'], queryFn: programs.list });
  const [creating, setCreating] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => groups.remove(id),
    onSuccess: () => inv('groups', 'dashboards'),
  });
  const classes = (list.data ?? []).filter((g) => g.kind === 'CLASS');
  const subs = (list.data ?? []).filter((g) => g.kind === 'SUBGROUP');
  return (
    <>
      {yrs.data && !current && (
        <div className="mb-4">
          <Alert tone="warning">
            Aucune année courante : créez-en une dans l&apos;onglet « Années ».
          </Alert>
        </div>
      )}
      <Card
        title="Classes et sous-groupes"
        actions={
          <>
            <Select
              value={effectiveYear}
              onChange={(e) => setYearId(e.target.value)}
              className="w-40"
            >
              {yrs.data?.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                  {y.isCurrent ? ' (courante)' : ''}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={() => setCreating(true)} disabled={!effectiveYear}>
              Nouveau groupe
            </Button>
          </>
        }
      >
        {list.isPending && effectiveYear && <Loading />}
        <ErrorAlert error={remove.error} />
        {list.data && list.data.length === 0 && <Empty>Aucun groupe pour cette année.</Empty>}
        {classes.length > 0 && (
          <Table
            head={
              <>
                <th>Classe</th>
                <th>Niveau</th>
                <th>Programme</th>
                <th>Effectif</th>
                <th>Sous-groupes</th>
                <th></th>
              </>
            }
          >
            {classes.map((g) => (
              <tr key={g.id}>
                <td className="font-medium">{g.name}</td>
                <td>{g.levelName}</td>
                <td>{g.programName}</td>
                <td>
                  {g.studentCount ?? 0}
                  {g.capacity ? ` / ${g.capacity}` : ''}
                  {g.capacity && (g.studentCount ?? 0) > g.capacity ? (
                    <>
                      {' '}
                      <Badge tone="red">dépassée</Badge>
                    </>
                  ) : null}
                </td>
                <td className="space-x-1">
                  {subs
                    .filter((s) => s.parentGroupId === g.id)
                    .map((s) => (
                      <Badge key={s.id}>
                        {s.name} ({s.studentCount ?? 0})
                      </Badge>
                    ))}
                </td>
                <td className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(g.id)}
                  >
                    Supprimer
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {creating && effectiveYear && (
        <GroupModal
          yearId={effectiveYear}
          programs={progs.data ?? []}
          classes={classes}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

function GroupModal({
  yearId,
  programs: progs,
  classes,
  onClose,
}: {
  yearId: string;
  programs: Program[];
  classes: Group[];
  onClose: () => void;
}) {
  const inv = useInvalidate();
  const [form, setForm] = useState({
    name: '',
    levelId: '',
    kind: 'CLASS' as 'CLASS' | 'SUBGROUP',
    parentGroupId: '',
    capacity: '',
  });
  const m = useMutation({
    mutationFn: () =>
      groups.create({
        academicYearId: yearId,
        name: form.name.trim(),
        levelId: form.levelId,
        kind: form.kind,
        parentGroupId: form.kind === 'SUBGROUP' ? form.parentGroupId : null,
        capacity: form.capacity ? Number(form.capacity) : null,
      }),
    onSuccess: async () => {
      await inv('groups');
      onClose();
    },
  });
  const levels = progs.flatMap((p) => (p.levels ?? []).map((l) => ({ ...l, program: p.name })));
  return (
    <Modal open title="Nouveau groupe" onClose={onClose}>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Type">
          <Select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as 'CLASS' | 'SUBGROUP' })}
          >
            <option value="CLASS">Classe / promotion</option>
            <option value="SUBGROUP">Sous-groupe (TD, option…)</option>
          </Select>
        </Field>
        <Field label="Nom">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="6e A, L1 Info, TD1…"
            required
            autoFocus
          />
        </Field>
        <Field label="Niveau">
          <Select
            value={form.levelId}
            onChange={(e) => setForm({ ...form, levelId: e.target.value })}
            required
          >
            <option value="">Choisir…</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} — {l.program}
              </option>
            ))}
          </Select>
        </Field>
        {form.kind === 'SUBGROUP' ? (
          <Field label="Classe parente">
            <Select
              value={form.parentGroupId}
              onChange={(e) => setForm({ ...form, parentGroupId: e.target.value })}
              required
            >
              <option value="">Choisir…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Capacité (facultatif)">
            <Input
              type="number"
              min={1}
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
          </Field>
        )}
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

// ----------------------------------------------------------------------------- matières
function SubjectsTab() {
  const inv = useInvalidate();
  const list = useQuery({ queryKey: ['subjects'], queryFn: subjects.list });
  const [form, setForm] = useState({ code: '', name: '' });
  const create = useMutation({
    mutationFn: () => subjects.create(form),
    onSuccess: async () => {
      await inv('subjects');
      setForm({ code: '', name: '' });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => subjects.remove(id),
    onSuccess: () => inv('subjects'),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Matières" className="lg:col-span-2">
        {list.isPending && <Loading />}
        <ErrorAlert error={remove.error} />
        {list.data && list.data.length === 0 && <Empty>Aucune matière.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table
            head={
              <>
                <th>Code</th>
                <th>Nom</th>
                <th></th>
              </>
            }
          >
            {list.data.map((s) => (
              <tr key={s.id}>
                <td className="font-mono text-xs">{s.code}</td>
                <td>{s.name}</td>
                <td className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(s.id)}
                  >
                    Supprimer
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Nouvelle matière">
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Code">
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="MATH"
              required
            />
          </Field>
          <Field label="Nom">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Mathématiques"
              required
            />
          </Field>
          <ErrorAlert error={create.error} />
          <Button type="submit" disabled={create.isPending}>
            Créer
          </Button>
        </form>
      </Card>
    </div>
  );
}
