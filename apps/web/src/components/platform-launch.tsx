'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { DailyReview, LaunchChecklist, LaunchReadiness, TenantPlan } from '@polaris/contracts';
import { Bar, TrendBars, pct, rateTone } from '@/components/reporting';
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
  Select,
  Stat,
  Table,
  Textarea,
} from '@/components/ui';
import { fmtDate, fmtDateTime, fmtXof } from '@/lib/format';
import { launch, support, type PlatformTenant } from '@/lib/resources';

export const PLAN_LABELS: Record<TenantPlan, string> = {
  PILOT: 'Pilote',
  STANDARD: 'Standard',
  PREMIUM: 'Premium',
};
const CHECKLIST_LABELS: Record<keyof LaunchChecklist, string> = {
  contractSigned: 'Contrat et tarification signés',
  smsBudgetValidated: 'Budget SMS validé avec l’établissement',
  onCallInformed: 'Astreinte prévenue de la date de bascule',
  dataValidatedByTenant: 'Données (élèves, tuteurs, classes) validées par l’établissement',
};

/** Badge d'état de lancement d'un établissement (liste des établissements). */
export function LaunchBadge({ t }: { t: PlatformTenant }) {
  if (!t.liveAt) return <Badge tone="slate">En préparation</Badge>;
  const hyper = t.hypercareUntil && new Date(t.hypercareUntil).getTime() > Date.now();
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone="green">Production depuis le {fmtDate(t.liveAt)}</Badge>
      {hyper && <Badge tone="amber">Hypercare jusqu’au {fmtDate(t.hypercareUntil)}</Badge>}
    </span>
  );
}

// ----------------------------------------------------------------------------- Mise en production

export function LaunchModal({ tenant, onClose }: { tenant: PlatformTenant; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['platform', 'launch', tenant.id],
    queryFn: () => launch.readiness(tenant.id),
  });
  const [plan, setPlan] = useState<TenantPlan>('STANDARD');
  const [days, setDays] = useState(28);
  const [notes, setNotes] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['platform'] });
  const checklist = useMutation({
    mutationFn: (c: LaunchChecklist) => launch.checklist(tenant.id, c),
    onSuccess: (data) => {
      qc.setQueryData(['platform', 'launch', tenant.id], data);
    },
  });
  const go = useMutation({
    mutationFn: () =>
      launch.goLive(tenant.id, {
        plan,
        checklist: q.data!.checklist,
        hypercareDays: days,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['platform', 'launch', tenant.id], data);
      return invalidate();
    },
  });
  return (
    <Modal open title={`Mise en production · ${tenant.name}`} onClose={onClose}>
      {q.isPending && <Loading />}
      <ErrorAlert error={q.error} />
      {q.data && (
        <div className="space-y-4">
          {q.data.live ? (
            <Alert tone="success">
              En production depuis le {fmtDateTime(q.data.tenant.liveAt!)} (offre{' '}
              {PLAN_LABELS[q.data.tenant.plan]})
              {q.data.inHypercare && q.data.tenant.hypercareUntil
                ? ` — hypercare jusqu'au ${fmtDate(q.data.tenant.hypercareUntil)}.`
                : '.'}
            </Alert>
          ) : q.data.ready ? (
            <Alert tone="success">
              Tous les points bloquants sont levés : la bascule est possible.
            </Alert>
          ) : (
            <Alert tone="warning">
              Des points bloquants restent ouverts. La bascule sera refusée tant qu’ils le sont.
            </Alert>
          )}
          <Checks readiness={q.data} />
          <Card title="Points humains à confirmer">
            <ErrorAlert error={checklist.error} />
            <div className="space-y-2">
              {(Object.keys(CHECKLIST_LABELS) as (keyof LaunchChecklist)[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={q.data!.checklist[k]}
                    disabled={checklist.isPending || q.data!.live}
                    onChange={(e) =>
                      checklist.mutate({ ...q.data!.checklist, [k]: e.target.checked })
                    }
                  />
                  {CHECKLIST_LABELS[k]}
                </label>
              ))}
            </div>
          </Card>
          {!q.data.live && (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                go.mutate();
              }}
              className="space-y-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Offre">
                  <Select value={plan} onChange={(e) => setPlan(e.target.value as TenantPlan)}>
                    {(Object.keys(PLAN_LABELS) as TenantPlan[]).map((p) => (
                      <option key={p} value={p}>
                        {PLAN_LABELS[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Hypercare (jours de revue quotidienne renforcée)">
                  <Input
                    type="number"
                    min={7}
                    max={60}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                </Field>
              </div>
              <Field label="Notes (journalisées)">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Ex. : bascule convenue avec la direction le …"
                />
              </Field>
              <ErrorAlert error={go.error} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Fermer
                </Button>
                <Button type="submit" disabled={!q.data.ready || go.isPending}>
                  {go.isPending ? 'Bascule…' : 'Passer en production'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

function Checks({ readiness }: { readiness: LaunchReadiness }) {
  return (
    <Card
      title={`Préparation · assistant ${readiness.onboarding.completed}/${readiness.onboarding.total}`}
    >
      <ul className="space-y-1.5 text-sm">
        {readiness.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2">
            <span
              className={
                c.ok
                  ? 'text-emerald-600'
                  : c.blocking
                    ? 'font-semibold text-red-600'
                    : 'text-amber-600'
              }
              aria-label={c.ok ? 'fait' : c.blocking ? 'bloquant' : 'avertissement'}
            >
              {c.ok ? '✔' : c.blocking ? '✖' : '▲'}
            </span>
            <span>
              {c.title}
              {c.detail && <span className="ml-1 text-xs text-slate-500">— {c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ----------------------------------------------------------------------------- Adoption

export function AdoptionTab() {
  const q = useQuery({ queryKey: ['platform', 'adoption'], queryFn: launch.adoption });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const d = q.data;
  return (
    <>
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="En production" value={`${d.fleet.live} / ${d.fleet.tenants}`} />
        <Stat label="En hypercare" value={d.fleet.inHypercare} />
        <Stat
          label="Parents activés"
          value={pct(d.fleet.activationRate)}
          tone={(d.fleet.activationRate ?? 0) >= 70 ? undefined : 'amber'}
        />
        <Stat
          label="Appels soumis (7 j)"
          value={pct(d.fleet.sheetRate7d)}
          tone={(d.fleet.sheetRate7d ?? 0) >= 80 ? undefined : 'amber'}
        />
        <Stat label="Élèves actifs" value={d.fleet.students.toLocaleString('fr-FR')} />
        <Stat
          label="Établissements ≥ 70 % (G8)"
          value={`${d.fleet.tenantsMeetingG8} / ${d.fleet.tenants}`}
        />
      </section>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Parents activés (cumul, 8 semaines)">
          <TrendBars
            points={d.weekly.map((w) => ({ label: w.weekStart, value: w.guardiansActivated }))}
            format={(v) => v.toLocaleString('fr-FR')}
          />
        </Card>
        <Card title="Appels soumis / séances tenues (8 semaines)">
          <TrendBars
            points={d.weekly.map((w) => ({ label: w.weekStart, value: w.sheetRate }))}
            format={(v) => `${v} %`}
            tone="green"
          />
        </Card>
        <Card title="Paiements en ligne (8 semaines)">
          <TrendBars
            points={d.weekly.map((w) => ({ label: w.weekStart, value: w.onlinePayments }))}
            format={(v) => v.toLocaleString('fr-FR')}
            tone="blue"
          />
        </Card>
      </div>
      <Card title="Par établissement">
        <Table
          head={
            <>
              <th>Établissement</th>
              <th>Lancement</th>
              <th>Parents activés</th>
              <th>Enseignants actifs (7 j)</th>
              <th>Appels soumis (7 j)</th>
              <th className="text-right">Paiement en ligne (30 j)</th>
              <th>SMS du mois</th>
              <th className="text-right">Alertes</th>
            </>
          }
        >
          {d.tenants.map((t) => (
            <tr key={t.id}>
              <td>
                <span className="font-medium">{t.name}</span>
                <span className="ml-1 text-xs text-slate-400">{PLAN_LABELS[t.plan]}</span>
              </td>
              <td className="text-xs">
                {t.liveAt ? (
                  <>
                    J+{t.daysLive}
                    {t.inHypercare && (
                      <Badge tone="amber">
                        <span className="ml-0">hypercare</span>
                      </Badge>
                    )}
                  </>
                ) : (
                  <Badge tone="slate">préparation</Badge>
                )}
              </td>
              <td className="min-w-[160px]">
                <Bar
                  value={t.activationRate}
                  tone={t.meetsG8 ? 'green' : 'amber'}
                  label={`${t.guardiansActivated} / ${t.guardians} · ${pct(t.activationRate)}`}
                />
              </td>
              <td className="tabular-nums text-sm">
                {t.teachersActive7d} / {t.teachers}
              </td>
              <td className="min-w-[160px]">
                <Bar
                  value={t.sheetRate7d}
                  tone={rateTone(t.sheetRate7d)}
                  label={`${t.sheetsSubmitted7d} / ${t.sheetsExpected7d} · ${pct(t.sheetRate7d)}`}
                />
              </td>
              <td className="text-right tabular-nums">{pct(t.onlineShare30d)}</td>
              <td className="min-w-[120px]">
                <Bar
                  value={t.smsMonth}
                  max={t.smsCap}
                  tone={t.smsMonth >= t.smsCap * 0.9 ? 'red' : 'brand'}
                  label={`${t.smsMonth} / ${t.smsCap}`}
                />
              </td>
              <td className="text-right">
                {t.openAlerts > 0 ? <Badge tone="red">{t.openAlerts}</Badge> : '0'}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

// ----------------------------------------------------------------------------- Hypercare (revue quotidienne)

export function HypercareTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'reviews'], queryFn: () => launch.reviews(30) });
  const avail = useQuery({
    queryKey: ['platform', 'availability'],
    queryFn: () => launch.availability(30),
  });
  const [open, setOpen] = useState<string | null>(null);
  const gen = useMutation({
    mutationFn: launch.generateReview,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'reviews'] }),
  });
  return (
    <>
      {avail.data && (
        <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Disponibilité (30 j)"
            value={avail.data.availability === null ? '—' : `${avail.data.availability} %`}
            tone={avail.data.meetsTarget === false ? 'red' : undefined}
          />
          <Stat label="Objectif G8" value={`≥ ${avail.data.target} %`} />
          <Stat label="Sondes (30 j)" value={avail.data.checks.toLocaleString('fr-FR')} />
          <Stat
            label="Dernière sonde"
            value={
              avail.data.lastCheckAt ? (
                <span className="text-base">
                  {avail.data.lastCheckOk ? '✔' : '✖'} {fmtDateTime(avail.data.lastCheckAt)}
                </span>
              ) : (
                '—'
              )
            }
            tone={avail.data.lastCheckOk === false ? 'red' : undefined}
          />
        </section>
      )}
      <Card
        title="Revues quotidiennes (30 dernières)"
        actions={
          <Button
            size="sm"
            variant="secondary"
            disabled={gen.isPending}
            onClick={() => gen.mutate()}
          >
            {gen.isPending ? 'Génération…' : 'Générer la revue du jour'}
          </Button>
        }
      >
        <ErrorAlert error={gen.error} />
        {q.isPending && <Loading />}
        <ErrorAlert error={q.error} />
        {q.data &&
          (q.data.length === 0 ? (
            <Empty>Aucune revue : le worker en produit une chaque matin à 7 h.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Jour</th>
                  <th>État</th>
                  <th className="text-right">Dispo 24 h</th>
                  <th className="text-right">Alertes</th>
                  <th className="text-right">UNKNOWN</th>
                  <th className="text-right">Écarts</th>
                  <th className="text-right">À regarder</th>
                  <th>Acquittée</th>
                  <th></th>
                </>
              }
            >
              {q.data.map((r) => (
                <tr key={r.day}>
                  <td className="font-medium">{r.day}</td>
                  <td>
                    {r.summary.healthy ? (
                      <Badge tone="green">journée saine</Badge>
                    ) : (
                      <Badge tone="amber">points d’attention</Badge>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{pct(r.summary.availability24h)}</td>
                  <td className="text-right tabular-nums">
                    {r.summary.openAlerts}
                    {r.summary.criticalAlerts > 0 && (
                      <span className="ml-1 text-xs text-red-600">
                        ({r.summary.criticalAlerts} crit.)
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{r.summary.unknownAttempts}</td>
                  <td className="text-right tabular-nums">
                    {r.summary.reconciliationGaps + r.summary.ledgerMismatches}
                  </td>
                  <td className="text-right tabular-nums">
                    {r.summary.tenantsFlagged} / {r.tenants.length}
                  </td>
                  <td className="text-xs text-slate-500">
                    {r.reviewedAt ? fmtDateTime(r.reviewedAt) : <Badge tone="amber">à lire</Badge>}
                  </td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(r.day)}>
                      Détail
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
      {open && q.data && (
        <ReviewModal review={q.data.find((r) => r.day === open)!} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function ReviewModal({ review, onClose }: { review: DailyReview; onClose: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(review.notes ?? '');
  const ack = useMutation({
    mutationFn: () => launch.ackReview(review.day, notes.trim() || undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'reviews'] }),
  });
  const s = review.summary;
  const flagged = review.tenants.filter((t) => t.flags.length > 0 || t.inHypercare);
  return (
    <Modal open title={`Revue du ${review.day}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <KV k="Disponibilité 24 h" v={pct(s.availability24h)} />
          <KV k="Alertes ouvertes" v={`${s.openAlerts} (${s.criticalAlerts} crit.)`} />
          <KV k="Tentatives UNKNOWN" v={String(s.unknownAttempts)} />
          <KV k="Réconciliations avec écarts" v={String(s.reconciliationGaps)} />
          <KV k="Écarts grand-livre" v={String(s.ledgerMismatches)} />
          <KV k="Imports en échec" v={String(s.importsFailed)} />
          <KV k="Notifications en échec" v={String(s.notificationsFailed)} />
          <KV k="≥ 80 % du quota SMS" v={String(s.tenantsOverSmsBudget)} />
        </div>
        <Card title={`Établissements (${flagged.length} à regarder ou en hypercare)`}>
          {flagged.length === 0 ? (
            <Empty>Rien à signaler.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {flagged.map((t) => (
                <li key={t.tenantId}>
                  <span className="font-medium">{t.name}</span>{' '}
                  {t.inHypercare && <Badge tone="amber">hypercare</Badge>}{' '}
                  {t.flags.length === 0 ? (
                    <span className="text-slate-500">rien à signaler</span>
                  ) : (
                    <span className="text-amber-800">{t.flags.join(' · ')}</span>
                  )}
                  {t.guardiansActivatedDelta > 0 && (
                    <span className="ml-1 text-xs text-emerald-700">
                      +{t.guardiansActivatedDelta} parent(s) activé(s)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Field label="Notes d'acquittement (actions décidées)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
        <ErrorAlert error={ack.error} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {review.reviewedAt
              ? `Acquittée le ${fmtDateTime(review.reviewedAt)}`
              : 'Pas encore acquittée'}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Fermer
            </Button>
            <Button type="button" disabled={ack.isPending} onClick={() => ack.mutate()}>
              {review.reviewedAt ? 'Mettre à jour la note' : 'Acquitter'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border border-slate-100 px-2 py-1">
      <p className="text-[11px] uppercase text-slate-500">{k}</p>
      <p className="font-semibold">{v}</p>
    </div>
  );
}

// ----------------------------------------------------------------------------- Consommation

export function UsageTab() {
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
  );
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['platform', 'usage', month],
    queryFn: () => launch.usage(month),
  });
  const snap = useMutation({
    mutationFn: launch.snapshotUsage,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'usage'] }),
  });
  const total = (f: (r: NonNullable<typeof q.data>[number]) => number) =>
    (q.data ?? []).reduce((a, r) => a + f(r), 0);
  return (
    <Card
      title="Consommation mensuelle par établissement"
      actions={
        <div className="flex items-center gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <Button
            size="sm"
            variant="secondary"
            disabled={snap.isPending}
            onClick={() => snap.mutate()}
          >
            Recalculer le mois courant
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void launch.usageCsv(month)}>
            CSV
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Mesure (pas de facturation automatique) : instantané recalculé chaque nuit à 4 h 15, figé le
        2 du mois suivant. Base de la tarification et du budget SMS de chaque établissement.
      </p>
      <ErrorAlert error={snap.error} />
      {q.isPending && <Loading />}
      <ErrorAlert error={q.error} />
      {q.data &&
        (q.data.length === 0 ? (
          <Empty>Aucun instantané pour ce mois.</Empty>
        ) : (
          <Table
            head={
              <>
                <th>Établissement</th>
                <th>Offre</th>
                <th className="text-right">Élèves actifs</th>
                <th className="text-right">Tuteurs (activés)</th>
                <th className="text-right">Personnel</th>
                <th className="text-right">Appels</th>
                <th className="text-right">SMS</th>
                <th className="text-right">E-mails</th>
                <th className="text-right">En ligne</th>
                <th className="text-right">Caisse</th>
              </>
            }
          >
            {q.data.map((r) => (
              <tr key={r.tenantId}>
                <td className="font-medium">{r.name}</td>
                <td className="text-xs">{PLAN_LABELS[r.plan]}</td>
                <td className="text-right tabular-nums">{r.activeStudents}</td>
                <td className="text-right tabular-nums">
                  {r.guardians} ({r.guardiansActivated})
                </td>
                <td className="text-right tabular-nums">{r.staffActive}</td>
                <td className="text-right tabular-nums">{r.sheetsSubmitted}</td>
                <td className="text-right tabular-nums">{r.smsSent}</td>
                <td className="text-right tabular-nums">{r.emailsSent}</td>
                <td className="text-right tabular-nums" title={`${r.onlinePayments} paiement(s)`}>
                  {fmtXof(r.onlineAmount)}
                </td>
                <td className="text-right tabular-nums" title={`${r.manualPayments} paiement(s)`}>
                  {fmtXof(r.manualAmount)}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td colSpan={2}>Total</td>
              <td className="text-right tabular-nums">{total((r) => r.activeStudents)}</td>
              <td className="text-right tabular-nums">
                {total((r) => r.guardians)} ({total((r) => r.guardiansActivated)})
              </td>
              <td className="text-right tabular-nums">{total((r) => r.staffActive)}</td>
              <td className="text-right tabular-nums">{total((r) => r.sheetsSubmitted)}</td>
              <td className="text-right tabular-nums">{total((r) => r.smsSent)}</td>
              <td className="text-right tabular-nums">{total((r) => r.emailsSent)}</td>
              <td className="text-right tabular-nums">{fmtXof(total((r) => r.onlineAmount))}</td>
              <td className="text-right tabular-nums">{fmtXof(total((r) => r.manualAmount))}</td>
            </tr>
          </Table>
        ))}
    </Card>
  );
}

// ----------------------------------------------------------------------------- Support niveau 1

export function SupportLookup() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const qc = useQueryClient();
  const res = useQuery({
    queryKey: ['platform', 'support', submitted],
    queryFn: () => support.lookup(submitted),
    enabled: submitted.length >= 3,
  });
  const unlock = useMutation({
    mutationFn: support.unlock,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'support'] }),
  });
  const reset = useMutation({
    mutationFn: ({ id }: { id: string }) => support.resetMfa(id, reason.trim()),
    onSuccess: () => {
      setResetting(null);
      setReason('');
      return qc.invalidateQueries({ queryKey: ['platform', 'support'] });
    },
  });
  return (
    <Card title="Retrouver une personne (support niveau 1)">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q.trim());
        }}
        className="mb-3 flex gap-2"
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="E-mail, téléphone (+229…) ou nom"
          minLength={3}
          className="max-w-md"
        />
        <Button type="submit" disabled={q.trim().length < 3}>
          Rechercher
        </Button>
      </form>
      <p className="mb-3 text-xs text-slate-500">
        Le support voit qui et quel état (compte, verrouillage, MFA, invitations), jamais les
        données d’assiduité ni financières. Chaque recherche est journalisée.
      </p>
      <ErrorAlert error={res.error ?? unlock.error ?? reset.error} />
      {res.isFetching && <Loading />}
      {res.data && (
        <>
          {res.data.users.length === 0 && res.data.guardiansWithoutAccount.length === 0 && (
            <Empty>Aucune personne trouvée pour « {res.data.query} ».</Empty>
          )}
          <ul className="space-y-3">
            {res.data.users.map((u) => (
              <li key={u.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{u.displayName ?? '—'}</span>{' '}
                    <span className="text-slate-500">
                      {u.email ?? ''} {u.phone ?? ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={u.status === 'ACTIVE' ? 'green' : 'red'}>
                      {u.status === 'ACTIVE' ? 'actif' : 'désactivé'}
                    </Badge>
                    <Badge tone={u.mfaEnabled ? 'blue' : 'slate'}>
                      {u.mfaEnabled ? 'MFA activée' : 'sans MFA'}
                    </Badge>
                    {u.lockedFor !== null && (
                      <Badge tone="red">verrouillé {Math.ceil(u.lockedFor / 60)} min</Badge>
                    )}
                    {u.pendingInvitations > 0 && (
                      <Badge tone="amber">{u.pendingInvitations} invitation(s) en attente</Badge>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Dernière connexion : {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'jamais'} ·{' '}
                  {u.activeSessions} session(s) active(s) · {u.guardianLinks} enfant(s) rattaché(s)
                </p>
                <ul className="mt-1 text-xs">
                  {u.memberships.map((m) => (
                    <li key={m.id}>
                      {m.kind === 'PLATFORM' ? 'Plateforme' : (m.tenantName ?? m.tenantCode)} ·{' '}
                      {m.kind === 'GUARDIAN' ? 'parent' : m.roles.join(', ') || m.kind} ·{' '}
                      <span className={m.status === 'ACTIVE' ? 'text-emerald-700' : 'text-red-700'}>
                        {m.status}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  {u.lockedFor !== null && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={unlock.isPending}
                      onClick={() => unlock.mutate(u.email ?? u.phone ?? '')}
                    >
                      Déverrouiller
                    </Button>
                  )}
                  {u.mfaEnabled && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        setResetting({ id: u.id, name: u.displayName ?? u.email ?? u.id })
                      }
                    >
                      Réinitialiser la MFA
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {res.data.guardiansWithoutAccount.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium uppercase text-slate-500">
                Tuteurs sans compte (l’établissement doit (ré)inviter)
              </p>
              <ul className="text-sm">
                {res.data.guardiansWithoutAccount.map((g, i) => (
                  <li key={i}>
                    {g.displayName} · {g.phone ?? '—'} · {g.tenantName} ·{' '}
                    <span className="text-xs text-slate-500">
                      {g.invitedAt ? `invité le ${fmtDate(g.invitedAt)}` : 'jamais invité'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {resetting && (
        <Modal
          open
          title={`Réinitialiser la MFA · ${resetting.name}`}
          onClose={() => setResetting(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              reset.mutate({ id: resetting.id });
            }}
            className="space-y-3"
          >
            <Alert tone="warning">
              À faire uniquement après vérification d’identité (rappel au numéro connu, confirmation
              du chef d’établissement). Toutes les sessions de la personne sont fermées ; elle se
              reconnecte sans MFA et doit la réactiver.
            </Alert>
            <Field label="Motif (journalisé)">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={5}
                required
              />
            </Field>
            <ErrorAlert error={reset.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setResetting(null)}>
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
    </Card>
  );
}
