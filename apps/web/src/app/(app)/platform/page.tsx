'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { PlatformOverview } from '@polaris/contracts';
import { useCan } from '@/components/app-shell';
import { Bar, pct, rateTone } from '@/components/reporting';
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
  Stat,
  Table,
  Tabs,
} from '@/components/ui';
import { fmtDateTime, fmtXof, PROVIDER_LABELS } from '@/lib/format';
import { startImpersonation } from '@/lib/api';
import { platform, platformOps, type PlatformTenant } from '@/lib/resources';

const TENANT_STATUS: Record<string, { label: string; tone: 'green' | 'blue' | 'red' | 'slate' }> = {
  ACTIVE: { label: 'Actif', tone: 'green' },
  TRIAL: { label: 'Essai', tone: 'blue' },
  SUSPENDED: { label: 'Suspendu', tone: 'red' },
};
const TENANT_TYPES: Record<string, string> = {
  SCHOOL: 'École',
  UNIVERSITY: 'Université',
  TRAINING_CENTER: 'Centre de formation',
};
const QUEUE_LABELS: Record<string, string> = {
  'domain-events': 'Événements métier',
  payments: 'Paiements',
  schedules: 'Planifications',
  reports: 'Rapports',
  maintenance: 'Maintenance',
};

type Tab = 'overview' | 'tenants' | 'health' | 'alerts' | 'support';

/** Super Admin : parc d'établissements, volumétrie, transactions, erreurs et santé technique. */
export default function PlatformPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('overview');
  const q = useQuery({
    queryKey: ['platform', 'overview'],
    queryFn: platform.overview,
    refetchInterval: 60_000,
    enabled: can('PLATFORM_VIEW_METRICS'),
  });
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: "Vue d'ensemble" },
    { id: 'tenants', label: 'Établissements' },
    { id: 'alerts', label: 'Alertes' },
    { id: 'health', label: 'Santé technique' },
    { id: 'support', label: 'Sessions de support' },
  ];
  return (
    <>
      <PageHeader
        title="Plateforme"
        subtitle={
          q.data
            ? `Instantané du ${fmtDateTime(q.data.generatedAt)} · rafraîchi chaque minute`
            : undefined
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {!can('PLATFORM_VIEW_METRICS') && tab !== 'tenants' && (
        <Alert tone="warning">
          Votre compte ne dispose pas de la permission de lecture des métriques.
        </Alert>
      )}
      {can('PLATFORM_VIEW_METRICS') && q.isPending && <Loading />}
      <ErrorAlert error={q.error} />
      {tab === 'overview' && q.data && <Overview d={q.data} />}
      {tab === 'tenants' && <TenantsTab overview={q.data ?? null} />}
      {tab === 'health' && q.data && <HealthTab d={q.data} />}
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'support' && <SupportTab />}
    </>
  );
}

function Overview({ d }: { d: PlatformOverview }) {
  const errors =
    d.errors24h.attemptsUnknown +
    d.errors24h.notificationsFailed +
    d.errors24h.importsFailed +
    d.errors24h.reviewOpen;
  return (
    <>
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="Établissements actifs" value={`${d.tenants.active} / ${d.tenants.total}`} />
        <Stat label="Élèves actifs" value={d.totals.studentsActive.toLocaleString('fr-FR')} />
        <Stat
          label="Tuteurs activés"
          value={`${d.totals.guardiansActivated.toLocaleString('fr-FR')} / ${d.totals.guardians.toLocaleString('fr-FR')}`}
        />
        <Stat label="Présence (7 j)" value={pct(d.totals.attendanceRate7d)} />
        <Stat label="Encaissé aujourd'hui" value={fmtXof(d.totals.paidToday)} />
        <Stat label="Encaissé ce mois" value={fmtXof(d.totals.paidMonth)} />
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Paiements en ligne (24 h)">
          <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs uppercase text-slate-500">Tentatives</p>
              <p className="text-xl font-semibold">{d.payments24h.attempts}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Réussies</p>
              <p className="text-xl font-semibold text-emerald-700">{d.payments24h.succeeded}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Échouées</p>
              <p className="text-xl font-semibold text-red-700">{d.payments24h.failed}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">En attente / à vérifier</p>
              <p className="text-xl font-semibold">
                {d.payments24h.pending}{' '}
                <span className={d.payments24h.unknown ? 'text-red-700' : 'text-slate-400'}>
                  / {d.payments24h.unknown}
                </span>
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-500">{d.payments24h.webhooks} webhook(s) reçu(s)</p>
          {d.payments24h.byProvider.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {d.payments24h.byProvider.map((p) => (
                <li key={p.provider} className="flex justify-between">
                  <span>{PROVIDER_LABELS[p.provider] ?? p.provider}</span>
                  <span className="tabular-nums">
                    {p.succeeded} / {p.attempts}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Erreurs (24 h)">
          {errors === 0 ? (
            <Empty>Rien à signaler.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              <ErrorRow label="Transactions à vérifier (UNKNOWN)" n={d.errors24h.attemptsUnknown} />
              <ErrorRow label="Notifications en échec" n={d.errors24h.notificationsFailed} />
              <ErrorRow label="Imports en échec" n={d.errors24h.importsFailed} />
              <ErrorRow label="Transactions en revue manuelle" n={d.errors24h.reviewOpen} />
            </ul>
          )}
        </Card>
        <Card title="Parc">
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between">
              <span>Actifs</span>
              <span>{d.tenants.active}</span>
            </li>
            <li className="flex justify-between">
              <span>En essai</span>
              <span>{d.tenants.trial}</span>
            </li>
            <li className="flex justify-between">
              <span>Suspendus</span>
              <span>{d.tenants.suspended}</span>
            </li>
            <li className="flex justify-between border-t border-slate-100 pt-1">
              <span>Agrégats de reporting périmés (&gt; 20 min)</span>
              <span className={d.health.staleReports ? 'font-medium text-amber-700' : ''}>
                {d.health.staleReports}
              </span>
            </li>
          </ul>
        </Card>
      </div>
      <div className="mt-4">
        <Card title="Par établissement">
          <PerTenantTable rows={d.perTenant} />
        </Card>
      </div>
    </>
  );
}

function ErrorRow({ label, n }: { label: string; n: number }) {
  return (
    <li className="flex justify-between">
      <span>{label}</span>
      <span className={n ? 'font-medium text-red-700' : 'text-slate-400'}>{n}</span>
    </li>
  );
}

function PerTenantTable({ rows }: { rows: PlatformOverview['perTenant'] }) {
  if (rows.length === 0) return <Empty>Aucun établissement.</Empty>;
  return (
    <Table
      head={
        <>
          <th>Établissement</th>
          <th>État</th>
          <th className="text-right">Élèves</th>
          <th>Parents activés</th>
          <th>Présence 7 j</th>
          <th className="text-right">Appels manquants</th>
          <th className="text-right">Encaissé (mois)</th>
          <th>En ligne</th>
          <th className="text-right">SMS (mois)</th>
          <th>Agrégats</th>
        </>
      }
    >
      {rows.map((t) => {
        const st = TENANT_STATUS[t.status] ?? { label: t.status, tone: 'slate' as const };
        return (
          <tr key={t.id}>
            <td>
              <span className="font-medium">{t.name}</span>
              <span className="ml-1 text-xs text-slate-400">{t.code}</span>
            </td>
            <td>
              <Badge tone={st.tone}>{st.label}</Badge>
            </td>
            <td className="text-right tabular-nums">{t.studentsActive}</td>
            <td>
              <div className="flex items-center gap-2">
                <div className="w-16">
                  <Bar value={t.guardiansActivationRate} tone="blue" />
                </div>
                <span className="text-xs tabular-nums">{pct(t.guardiansActivationRate)}</span>
              </div>
            </td>
            <td>
              <Badge tone={rateTone(t.attendanceRate7d)}>{pct(t.attendanceRate7d)}</Badge>
            </td>
            <td className={`text-right tabular-nums ${t.missingSheets7d ? 'text-amber-700' : ''}`}>
              {t.missingSheets7d}
            </td>
            <td className="text-right tabular-nums">{fmtXof(t.paidMonth)}</td>
            <td className="text-xs">
              {t.onlineProvider ? (PROVIDER_LABELS[t.onlineProvider] ?? t.onlineProvider) : '—'}
              {t.pendingAttempts > 0 && (
                <span className="ml-1 text-slate-500">({t.pendingAttempts} en attente)</span>
              )}
              {t.reviewOpen > 0 && (
                <span className="ml-1 font-medium text-red-700">{t.reviewOpen} à traiter</span>
              )}
            </td>
            <td className="text-right tabular-nums">{t.smsMonth}</td>
            <td className="text-xs text-slate-500">
              {t.lastRefreshAt ? fmtDateTime(t.lastRefreshAt) : 'jamais'}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

// -------------------------------------------------------------------------------------- établissements

function TenantsTab({ overview }: { overview: PlatformOverview | null }) {
  const can = useCan();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['platform', 'tenants'], queryFn: platform.tenants });
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState<PlatformTenant | null>(null);
  const [suspending, setSuspending] = useState<PlatformTenant | null>(null);
  const [supporting, setSupporting] = useState<PlatformTenant | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['platform'] });
  const activate = useMutation({
    mutationFn: (t: PlatformTenant) => platform.setStatus(t.id, 'ACTIVE'),
    onSuccess: invalidate,
  });
  const metrics = new Map(overview?.perTenant.map((t) => [t.id, t]) ?? []);
  if (!can('PLATFORM_MANAGE_TENANTS'))
    return (
      <Alert tone="warning">
        Gestion des établissements réservée aux administrateurs plateforme.
      </Alert>
    );
  return (
    <Card
      title="Établissements"
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          Créer un établissement
        </Button>
      }
    >
      <ErrorAlert error={activate.error} />
      {list.isPending && <Loading />}
      <ErrorAlert error={list.error} />
      {list.data &&
        (list.data.length === 0 ? (
          <Empty>Aucun établissement.</Empty>
        ) : (
          <Table
            head={
              <>
                <th>Établissement</th>
                <th>Type</th>
                <th>État</th>
                <th className="text-right">Membres actifs</th>
                <th className="text-right">Élèves</th>
                <th>Fuseau</th>
                <th></th>
              </>
            }
          >
            {list.data.map((t) => {
              const st = TENANT_STATUS[t.status] ?? { label: t.status, tone: 'slate' as const };
              const m = metrics.get(t.id);
              return (
                <tr key={t.id}>
                  <td>
                    <span className="font-medium">{t.name}</span>
                    <span className="ml-1 text-xs text-slate-400">{t.code}</span>
                  </td>
                  <td className="text-sm">{TENANT_TYPES[t.type] ?? t.type}</td>
                  <td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </td>
                  <td className="text-right tabular-nums">{t.activeMembers}</td>
                  <td className="text-right tabular-nums">{m?.studentsActive ?? '—'}</td>
                  <td className="text-xs text-slate-500">{t.timezone}</td>
                  <td className="whitespace-nowrap text-right">
                    {can('PLATFORM_IMPERSONATE') && t.status !== 'SUSPENDED' && (
                      <Button size="sm" variant="ghost" onClick={() => setSupporting(t)}>
                        Support
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setInviting(t)}>
                      Inviter un admin
                    </Button>
                    {t.status === 'SUSPENDED' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={activate.isPending}
                        onClick={() => activate.mutate(t)}
                      >
                        Réactiver
                      </Button>
                    ) : (
                      <Button size="sm" variant="danger" onClick={() => setSuspending(t)}>
                        Suspendre
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        ))}
      {creating && <CreateTenantModal onClose={() => setCreating(false)} />}
      {inviting && <InviteAdminModal tenant={inviting} onClose={() => setInviting(null)} />}
      {suspending && <SuspendModal tenant={suspending} onClose={() => setSuspending(null)} />}
      {supporting && <SupportModal tenant={supporting} onClose={() => setSupporting(null)} />}
    </Card>
  );
}

function CreateTenantModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: '',
    name: '',
    type: 'SCHOOL',
    timezone: 'Africa/Porto-Novo',
    country: 'BJ',
    adminEmail: '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = useMutation({
    mutationFn: () =>
      platform.createTenant({
        code: form.code.trim().toLowerCase(),
        name: form.name.trim(),
        type: form.type,
        timezone: form.timezone,
        country: form.country.toUpperCase(),
        ...(form.adminEmail.trim() ? { adminEmail: form.adminEmail.trim() } : {}),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['platform'] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Modal open title="Créer un établissement" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" hint="Identifiant court, minuscules et tirets (ex. lycee-beh)">
            <Input value={form.code} onChange={set('code')} required pattern="[a-z0-9-]{2,40}" />
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={set('type')}>
              {Object.entries(TENANT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Nom">
          <Input value={form.name} onChange={set('name')} required minLength={2} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fuseau horaire">
            <Input value={form.timezone} onChange={set('timezone')} required />
          </Field>
          <Field label="Pays (ISO-2)">
            <Input value={form.country} onChange={set('country')} required maxLength={2} />
          </Field>
        </div>
        <Field
          label="E-mail de l'administrateur (optionnel)"
          hint="Une invitation lui sera envoyée pour créer son compte."
        >
          <Input type="email" value={form.adminEmail} onChange={set('adminEmail')} />
        </Field>
        <ErrorAlert error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={create.isPending}>
            Créer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function InviteAdminModal({ tenant, onClose }: { tenant: PlatformTenant; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const invite = useMutation({ mutationFn: () => platform.inviteAdmin(tenant.id, email.trim()) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate();
  };
  return (
    <Modal open title={`Inviter un administrateur · ${tenant.name}`} onClose={onClose}>
      {invite.isSuccess ? (
        <>
          <Alert tone="success">Invitation envoyée à {email}.</Alert>
          <div className="mt-3 flex justify-end">
            <Button onClick={onClose}>Fermer</Button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="E-mail">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <ErrorAlert error={invite.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              Inviter
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function SuspendModal({ tenant, onClose }: { tenant: PlatformTenant; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const suspend = useMutation({
    mutationFn: () => platform.setStatus(tenant.id, 'SUSPENDED', reason.trim() || undefined),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['platform'] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    suspend.mutate();
  };
  return (
    <Modal open title={`Suspendre · ${tenant.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert tone="warning">
          Les utilisateurs de cet établissement ne pourront plus se connecter tant qu&apos;il sera
          suspendu. Les données sont conservées.
        </Alert>
        <Field label="Motif (optionnel, journalisé)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} />
        </Field>
        <ErrorAlert error={suspend.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="danger" disabled={suspend.isPending}>
            Suspendre
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------------------------------- santé

function HealthTab({ d }: { d: PlatformOverview }) {
  const h = d.health;
  const ok = h.database && h.redis && h.dlq.every((x) => x.count === 0);
  return (
    <div className="space-y-4">
      <Alert tone={ok ? 'success' : 'warning'}>
        {ok
          ? 'Tous les voyants sont au vert : base de données, Redis, files sans échec.'
          : 'Un ou plusieurs composants demandent une attention.'}
      </Alert>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Base de données"
          value={h.database ? 'OK' : 'KO'}
          tone={h.database ? undefined : 'red'}
        />
        <Stat label="Redis" value={h.redis ? 'OK' : 'KO'} tone={h.redis ? undefined : 'red'} />
        <Stat
          label="Outbox en attente"
          value={h.outboxBacklog}
          tone={h.outboxBacklog > 100 ? 'amber' : undefined}
        />
        <Stat
          label="Plus ancien événement"
          value={h.outboxOldestSeconds === null ? '—' : `${Math.round(h.outboxOldestSeconds)} s`}
          tone={(h.outboxOldestSeconds ?? 0) > 300 ? 'red' : undefined}
        />
      </section>
      <Card title="Files de traitement (BullMQ)">
        <Table
          head={
            <>
              <th>File</th>
              <th className="text-right">En attente</th>
              <th className="text-right">Actives</th>
              <th className="text-right">Différées</th>
              <th className="text-right">En échec</th>
              <th className="text-right">Attente max.</th>
            </>
          }
        >
          {h.queues.map((q) => (
            <tr key={q.name}>
              <td>
                {QUEUE_LABELS[q.name] ?? q.name}{' '}
                <span className="text-xs text-slate-400">{q.name}</span>
              </td>
              <td className="text-right tabular-nums">{q.waiting}</td>
              <td className="text-right tabular-nums">{q.active}</td>
              <td className="text-right tabular-nums">{q.delayed}</td>
              <td
                className={`text-right tabular-nums ${q.failed ? 'font-medium text-red-700' : ''}`}
              >
                {q.failed}
              </td>
              <td className="text-right tabular-nums">
                {q.oldestWaitingSeconds === null ? '—' : `${Math.round(q.oldestWaitingSeconds)} s`}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Files d'échec (DLQ)">
        {h.dlq.length === 0 ? (
          <Empty>Aucune file d&apos;échec configurée.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {h.dlq.map((x) => (
              <li key={x.name} className="flex justify-between">
                <span className="font-mono text-xs">{x.name}</span>
                <span className={x.count ? 'font-medium text-red-700' : 'text-slate-400'}>
                  {x.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------------- support

/** Ouvre une session de support (impersonation) : motif obligatoire, 30 min, bannière et journalisation. */
function SupportModal({ tenant, onClose }: { tenant: PlatformTenant; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const start = useMutation({
    mutationFn: () => platformOps.impersonate(tenant.id, reason.trim()),
    onSuccess: async (grant) => {
      startImpersonation(grant.accessToken);
      await qc.invalidateQueries();
      router.replace('/dashboard');
    },
  });
  return (
    <Modal open title={`Session de support · ${tenant.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start.mutate();
        }}
        className="space-y-3"
      >
        <Alert tone="info">
          Vous verrez l&apos;application comme un administrateur de l&apos;établissement, pendant 30
          minutes,
          <strong> sans aucune action financière</strong>. Chaque action est journalisée à votre nom
          et visible par l&apos;établissement dans son journal d&apos;audit.
        </Alert>
        <Field label="Motif (communiqué à l'établissement)">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={5}
            required
            placeholder="Ex. : ticket #123 — import des élèves bloqué"
          />
        </Field>
        <ErrorAlert error={start.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={start.isPending || reason.trim().length < 5}>
            Ouvrir la session
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SupportTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['platform', 'impersonations'],
    queryFn: platformOps.impersonations,
  });
  const end = useMutation({
    mutationFn: platformOps.endImpersonation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'impersonations'] }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  return (
    <Card title="Sessions de support (100 dernières)">
      <ErrorAlert error={end.error} />
      {q.data.length === 0 ? (
        <Empty>Aucune session de support.</Empty>
      ) : (
        <Table
          head={
            <>
              <th>Établissement</th>
              <th>Par</th>
              <th>Motif</th>
              <th>Début</th>
              <th>Fin</th>
              <th></th>
            </>
          }
        >
          {q.data.map((s) => (
            <tr key={s.id}>
              <td className="font-medium">{s.tenantName}</td>
              <td>{s.platformUserName ?? s.platformUserId.slice(0, 8)}</td>
              <td className="max-w-xs truncate text-sm" title={s.reason}>
                {s.reason}
              </td>
              <td className="whitespace-nowrap text-xs text-slate-500">
                {fmtDateTime(s.startedAt)}
              </td>
              <td className="whitespace-nowrap text-xs text-slate-500">
                {s.active ? (
                  <Badge tone="amber">active · expire {fmtDateTime(s.expiresAt)}</Badge>
                ) : (
                  fmtDateTime(s.endedAt ?? s.expiresAt)
                )}
              </td>
              <td className="text-right">
                {s.active && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={end.isPending}
                    onClick={() => end.mutate(s.id)}
                  >
                    Clôturer
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------------------------- alertes

const SEVERITY: Record<string, 'red' | 'amber'> = { CRITICAL: 'red', WARNING: 'amber' };

function AlertsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const q = useQuery({
    queryKey: ['platform', 'alerts', status],
    queryFn: () => platformOps.alerts(status),
    refetchInterval: 60_000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['platform', 'alerts'] });
  const evaluate = useMutation({ mutationFn: platformOps.evaluateAlerts, onSuccess: invalidate });
  const ack = useMutation({ mutationFn: platformOps.ackAlert, onSuccess: invalidate });
  return (
    <Card
      title="Alertes de supervision"
      actions={
        <>
          <div className="w-40">
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="open">Ouvertes</option>
              <option value="resolved">Résolues</option>
              <option value="all">Toutes</option>
            </Select>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={evaluate.isPending}
            onClick={() => evaluate.mutate()}
          >
            {evaluate.isPending ? 'Évaluation…' : 'Évaluer maintenant'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Le worker évalue toutes les 5 minutes : Redis, outbox, files et DLQ, agrégats périmés,
        transactions à vérifier, quotas SMS, rapports planifiés, intégrité du grand-livre,
        disjoncteurs provider. Une alerte se résout d&apos;elle-même quand la condition disparaît ;
        l&apos;acquittement suspend les rappels e-mail.
      </p>
      <ErrorAlert error={evaluate.error ?? ack.error} />
      {evaluate.data && (
        <div className="mb-3">
          <Alert tone="info">
            {evaluate.data.opened} ouverte(s), {evaluate.data.resolved} résolue(s),{' '}
            {evaluate.data.stillOpen} condition(s) active(s), {evaluate.data.notified}{' '}
            notification(s).
          </Alert>
        </div>
      )}
      {q.isPending && <Loading />}
      <ErrorAlert error={q.error} />
      {q.data &&
        (q.data.length === 0 ? (
          <Empty>Aucune alerte {status === 'open' ? 'ouverte' : ''}.</Empty>
        ) : (
          <Table
            head={
              <>
                <th>Sévérité</th>
                <th>Alerte</th>
                <th>Établissement</th>
                <th>Depuis</th>
                <th>Vue</th>
                <th>État</th>
                <th></th>
              </>
            }
          >
            {q.data.map((a) => (
              <tr key={a.id}>
                <td>
                  <Badge tone={SEVERITY[a.severity] ?? 'slate'}>{a.severity}</Badge>
                </td>
                <td>
                  <span className="font-medium">{a.title}</span>
                  <span className="ml-1 font-mono text-xs text-slate-400">{a.key}</span>
                </td>
                <td className="text-sm">{a.tenantName ?? '—'}</td>
                <td className="whitespace-nowrap text-xs text-slate-500">
                  {fmtDateTime(a.openedAt)}
                </td>
                <td className="whitespace-nowrap text-xs text-slate-500">
                  {fmtDateTime(a.lastSeenAt)}
                </td>
                <td className="text-xs">
                  {a.resolvedAt ? (
                    <Badge tone="green">résolue {fmtDateTime(a.resolvedAt)}</Badge>
                  ) : a.acknowledgedAt ? (
                    <Badge>
                      acquittée{a.acknowledgedByName ? ` · ${a.acknowledgedByName}` : ''}
                    </Badge>
                  ) : (
                    <Badge tone="amber">ouverte</Badge>
                  )}
                </td>
                <td className="text-right">
                  {!a.resolvedAt && !a.acknowledgedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ack.isPending}
                      onClick={() => ack.mutate(a.id)}
                    >
                      Acquitter
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
