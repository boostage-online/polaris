'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  ReportDefinition,
  ReportKey,
  ScheduledReport,
  TenantExport,
} from '@polaris/contracts';
import { useCan, useMe } from '@/components/app-shell';
import { PeriodFilter, pct } from '@/components/reporting';
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
import { addDaysIso, fmtDate, fmtDateTime, todayIso } from '@/lib/format';
import { groups, reporting } from '@/lib/resources';

const FAMILY_LABELS: Record<ReportDefinition['family'], string> = {
  attendance: 'Assiduité',
  finance: 'Finance',
  adoption: 'Adoption',
};
const CADENCE_LABELS = { WEEKLY: 'Hebdomadaire', MONTHLY: 'Mensuel' } as const;
const WEEKDAY_LABELS = [
  '',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
];

type Tab = 'reports' | 'scheduled' | 'exports';

/** Rapports MVP : catalogue, aperçu, CSV ; rapports planifiés ; export complet de l'établissement. */
export default function ReportsPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('reports');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'reports', label: 'Rapports' },
    { id: 'scheduled', label: 'Rapports planifiés' },
  ];
  if (can('MANAGE_TENANT_SETTINGS')) tabs.push({ id: 'exports', label: 'Export complet' });
  return (
    <>
      <PageHeader
        title="Rapports"
        subtitle="Huit rapports prêts à l'emploi, exportables en CSV (Excel) et planifiables par e-mail."
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'reports' && <ReportsTab />}
      {tab === 'scheduled' && <ScheduledTab />}
      {tab === 'exports' && <ExportsTab />}
    </>
  );
}

// ------------------------------------------------------------------------------------------ rapports

function ReportsTab() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ['reports', 'catalog'], queryFn: reporting.catalog });
  const [key, setKey] = useState<ReportKey | null>(null);
  const refresh = useMutation({
    mutationFn: () => reporting.refresh(false),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
  if (catalog.isPending) return <Loading />;
  if (catalog.isError) return <ErrorAlert error={catalog.error} />;
  const defs = catalog.data;
  const selected = defs.find((d) => d.key === key) ?? null;
  const families = (['attendance', 'finance', 'adoption'] as const).filter((f) =>
    defs.some((d) => d.family === f),
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-4">
        {families.map((f) => (
          <div key={f}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {FAMILY_LABELS[f]}
            </p>
            <ul className="space-y-1">
              {defs
                .filter((d) => d.family === f)
                .map((d) => (
                  <li key={d.key}>
                    <button
                      onClick={() => setKey(d.key)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                        d.key === key
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/5'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span className="block font-medium">{d.title}</span>
                      <span className="block text-xs text-slate-500">{d.description}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Les agrégats d&apos;assiduité et de finance sont recalculés toutes les 5 minutes par le
          worker.{' '}
          <button
            className="underline"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? 'Rafraîchissement…' : 'Rafraîchir maintenant'}
          </button>
          <ErrorAlert error={refresh.error} />
        </div>
      </aside>
      <div>
        {selected ? (
          <ReportRunner def={selected} />
        ) : (
          <Card>
            <Empty>Choisissez un rapport dans la liste.</Empty>
          </Card>
        )}
      </div>
    </div>
  );
}

function ReportRunner({ def }: { def: ReportDefinition }) {
  const today = todayIso();
  const [period, setPeriod] = useState({
    from: addDaysIso(today, -(def.defaultDays - 1)),
    to: today,
  });
  const [groupId, setGroupId] = useState('');
  useEffect(() => {
    setPeriod({ from: addDaysIso(todayIso(), -(def.defaultDays - 1)), to: todayIso() });
  }, [def.key, def.defaultDays]);
  const filters = { ...period, ...(groupId ? { groupId } : {}) };
  const q = useQuery({
    queryKey: ['reports', 'run', def.key, filters],
    queryFn: () => reporting.run(def.key, filters),
    placeholderData: (prev) => prev,
  });
  const groupList = useQuery({ queryKey: ['groups', 'all'], queryFn: () => groups.list({}) });
  const csv = useMutation({ mutationFn: () => reporting.downloadCsv(def.key, filters) });
  const withGroup = def.family !== 'adoption' && def.key !== 'collections-by-channel';
  return (
    <Card
      title={def.title}
      actions={
        <Button size="sm" disabled={csv.isPending} onClick={() => csv.mutate()}>
          {csv.isPending ? 'Export…' : 'Télécharger le CSV'}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{def.description}</p>
      <PeriodFilter value={period} onChange={setPeriod}>
        {withGroup && (
          <div className="w-56">
            <Select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              aria-label="Classe"
            >
              <option value="">Toutes les classes</option>
              {groupList.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.levelName ? ` · ${g.levelName}` : ''}
                </option>
              ))}
            </Select>
          </div>
        )}
      </PeriodFilter>
      <ErrorAlert error={csv.error} />
      <ErrorAlert error={q.error} />
      {q.isPending && <Loading />}
      {q.data && (
        <>
          <p className="mb-2 text-xs text-slate-500">
            Du {fmtDate(q.data.period.from)} au {fmtDate(q.data.period.to)} · {q.data.total}{' '}
            ligne(s)
            {q.data.truncated && ' (aperçu limité : téléchargez le CSV pour le détail complet)'}
          </p>
          {q.data.rows.length === 0 ? (
            <Empty>Aucune ligne sur cette période.</Empty>
          ) : (
            <Table
              head={
                <>
                  {q.data.columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </>
              }
            >
              {q.data.rows.slice(0, 200).map((r, i) => (
                <tr key={i}>
                  {q.data.columns.map((c) => (
                    <td key={c.key} className="whitespace-nowrap">
                      <CellValue value={r[c.key] ?? null} label={c.label} />
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
          )}
          {q.data.rows.length > 200 && (
            <p className="mt-2 text-xs text-slate-500">
              200 premières lignes affichées sur {q.data.rows.length}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function CellValue({ value, label }: { value: string | number | boolean | null; label: string }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  if (typeof value === 'boolean') return <>{value ? 'oui' : 'non'}</>;
  if (typeof value === 'number') {
    if (/\(%\)/.test(label)) return <span className="tabular-nums">{pct(value)}</span>;
    if (/FCFA|Montant|montant/.test(label))
      return <span className="tabular-nums">{value.toLocaleString('fr-FR')}</span>;
    return <span className="tabular-nums">{value}</span>;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return <>{fmtDate(value)}</>;
  return <>{value}</>;
}

// -------------------------------------------------------------------------------- rapports planifiés

function ScheduledTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['reports', 'scheduled'], queryFn: reporting.scheduled });
  const catalog = useQuery({ queryKey: ['reports', 'catalog'], queryFn: reporting.catalog });
  const [creating, setCreating] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['reports', 'scheduled'] });
  const toggle = useMutation({
    mutationFn: (s: ScheduledReport) => reporting.updateScheduled(s.id, { enabled: !s.enabled }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => reporting.removeScheduled(id),
    onSuccess: invalidate,
  });
  const send = useMutation({
    mutationFn: (id: string) => reporting.sendScheduled(id),
    onSuccess: invalidate,
  });
  const title = (k: ReportKey) => catalog.data?.find((d) => d.key === k)?.title ?? k;
  return (
    <Card
      title="Rapports envoyés automatiquement par e-mail"
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          Planifier un rapport
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Le CSV du rapport est envoyé en pièce jointe le matin du jour choisi (hebdomadaire : jour de
        la semaine ; mensuel : jour du mois), sur la période écoulée.
      </p>
      <ErrorAlert error={toggle.error ?? remove.error ?? send.error} />
      {send.data && (
        <div className="mb-3">
          <Alert tone="success">Rapport envoyé à {send.data.sent} destinataire(s).</Alert>
        </div>
      )}
      {list.isPending && <Loading />}
      <ErrorAlert error={list.error} />
      {list.data &&
        (list.data.length === 0 ? (
          <Empty>Aucun rapport planifié.</Empty>
        ) : (
          <Table
            head={
              <>
                <th>Rapport</th>
                <th>Cadence</th>
                <th>Destinataires</th>
                <th>Dernier envoi</th>
                <th>État</th>
                <th></th>
              </>
            }
          >
            {list.data.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{title(s.reportKey)}</td>
                <td className="text-sm">
                  {CADENCE_LABELS[s.cadence]} ·{' '}
                  {s.cadence === 'WEEKLY'
                    ? WEEKDAY_LABELS[((s.dayOfPeriod - 1) % 7) + 1]
                    : `le ${s.dayOfPeriod}`}
                </td>
                <td className="max-w-xs truncate text-xs" title={s.recipients.join(', ')}>
                  {s.recipients.join(', ')}
                </td>
                <td className="text-xs text-slate-500">
                  {s.lastSentAt ? fmtDateTime(s.lastSentAt) : '—'}
                  {s.lastError && (
                    <span className="ml-1 text-red-700" title={s.lastError}>
                      ⚠
                    </span>
                  )}
                </td>
                <td>
                  <Badge tone={s.enabled ? 'green' : 'slate'}>
                    {s.enabled ? 'Actif' : 'Suspendu'}
                  </Badge>
                </td>
                <td className="whitespace-nowrap text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={send.isPending}
                    onClick={() => send.mutate(s.id)}
                  >
                    Envoyer maintenant
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)}>
                    {s.enabled ? 'Suspendre' : 'Réactiver'}
                  </Button>
                  {confirmId === s.id ? (
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(s.id, { onSettled: () => setConfirmId(null) })}
                      >
                        Confirmer la suppression
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                        Annuler
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="danger" onClick={() => setConfirmId(s.id)}>
                      Supprimer
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ))}
      {creating && catalog.data && (
        <CreateScheduledModal defs={catalog.data} onClose={() => setCreating(false)} />
      )}
    </Card>
  );
}

function CreateScheduledModal({
  defs,
  onClose,
}: {
  defs: ReportDefinition[];
  onClose: () => void;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const [reportKey, setReportKey] = useState<ReportKey>(defs[0]?.key ?? 'attendance-by-group');
  const [cadence, setCadence] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [day, setDay] = useState(1);
  const [recipients, setRecipients] = useState(me.user.email ?? '');
  const [groupId, setGroupId] = useState('');
  const groupList = useQuery({ queryKey: ['groups', 'all'], queryFn: () => groups.list({}) });
  const create = useMutation({
    mutationFn: () =>
      reporting.createScheduled({
        reportKey,
        cadence,
        dayOfPeriod: day,
        recipients: recipients
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        filters: groupId ? { groupId } : {},
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['reports', 'scheduled'] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Modal open title="Planifier un rapport" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Rapport">
          <Select value={reportKey} onChange={(e) => setReportKey(e.target.value as ReportKey)}>
            {defs.map((d) => (
              <option key={d.key} value={d.key}>
                {FAMILY_LABELS[d.family]} · {d.title}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cadence">
            <Select
              value={cadence}
              onChange={(e) => {
                setCadence(e.target.value as 'WEEKLY' | 'MONTHLY');
                setDay(1);
              }}
            >
              <option value="WEEKLY">Chaque semaine</option>
              <option value="MONTHLY">Chaque mois</option>
            </Select>
          </Field>
          <Field label={cadence === 'WEEKLY' ? 'Jour de la semaine' : 'Jour du mois (1–28)'}>
            {cadence === 'WEEKLY' ? (
              <Select value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {WEEKDAY_LABELS.slice(1).map((l, i) => (
                  <option key={l} value={i + 1}>
                    {l}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type="number"
                min={1}
                max={28}
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              />
            )}
          </Field>
        </div>
        <Field label="Destinataires" hint="Adresses e-mail séparées par des virgules (10 max.).">
          <Input
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="direction@ecole.bj, censeur@ecole.bj"
            required
          />
        </Field>
        <Field label="Classe (optionnel)">
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Toutes les classes</option>
            {groupList.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <ErrorAlert error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={create.isPending}>
            Planifier
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------ export complet

const EXPORT_STATUS: Record<
  TenantExport['status'],
  { label: string; tone: 'slate' | 'blue' | 'green' | 'red' }
> = {
  QUEUED: { label: 'En file', tone: 'slate' },
  RUNNING: { label: 'En cours', tone: 'blue' },
  DONE: { label: 'Prêt', tone: 'green' },
  FAILED: { label: 'Échoué', tone: 'red' },
};

function ExportsTab() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['reports', 'exports'],
    queryFn: reporting.exports,
    refetchInterval: (q) =>
      q.state.data?.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING') ? 5_000 : false,
  });
  const request = useMutation({
    mutationFn: reporting.requestExport,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'exports'] }),
  });
  const download = useMutation({ mutationFn: (id: string) => reporting.downloadExport(id) });
  const fmtSize = (b: number | null) =>
    b === null
      ? '—'
      : b > 1_000_000
        ? `${(b / 1_000_000).toFixed(1)} Mo`
        : `${Math.ceil(b / 1000)} ko`;
  return (
    <Card
      title="Export complet de l'établissement"
      actions={
        <Button size="sm" disabled={request.isPending} onClick={() => request.mutate()}>
          Demander un export
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Archive ZIP de fichiers CSV (élèves, tuteurs, séances, appels, frais, paiements, reçus,
        notifications, journal d&apos;audit…), construite par le worker. Vos données vous
        appartiennent : cet export est disponible à tout moment, sans intervention du support.
      </p>
      <ErrorAlert error={request.error ?? download.error} />
      {list.isPending && <Loading />}
      <ErrorAlert error={list.error} />
      {list.data &&
        (list.data.length === 0 ? (
          <Empty>Aucun export demandé.</Empty>
        ) : (
          <Table
            head={
              <>
                <th>Demandé le</th>
                <th>Par</th>
                <th>État</th>
                <th>Contenu</th>
                <th>Taille</th>
                <th></th>
              </>
            }
          >
            {list.data.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-xs text-slate-500">
                  {fmtDateTime(e.createdAt)}
                </td>
                <td>{e.requestedByName ?? '—'}</td>
                <td>
                  <Badge tone={EXPORT_STATUS[e.status].tone}>{EXPORT_STATUS[e.status].label}</Badge>
                  {e.error && (
                    <span className="ml-1 text-xs text-red-700" title={e.error}>
                      {e.error}
                    </span>
                  )}
                </td>
                <td className="text-xs text-slate-600">
                  {e.entries.length > 0
                    ? `${e.entries.length} fichier(s) · ${e.entries
                        .reduce((t, x) => t + x.rows, 0)
                        .toLocaleString('fr-FR')} ligne(s)`
                    : '—'}
                </td>
                <td className="tabular-nums">{fmtSize(e.sizeBytes)}</td>
                <td className="text-right">
                  {e.status === 'DONE' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={download.isPending}
                      onClick={() => download.mutate(e.id)}
                    >
                      Télécharger
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ))}
    </Card>
  );
}
