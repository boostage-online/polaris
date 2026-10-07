'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { PaymentAttempt } from '@polaris/contracts';
import { useCan } from '@/components/app-shell';
import { AttemptBadge } from '@/components/pay';
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
  Textarea,
} from '@/components/ui';
import {
  ATTEMPT_STATUS,
  fmtDate,
  fmtDateTime,
  fmtXof,
  PROVIDER_LABELS,
  todayIso,
} from '@/lib/format';
import { payments } from '@/lib/resources';

/** Paiements en ligne côté finance : transactions en attente (revue humaine), toutes les tentatives, réconciliations. */
export default function OnlinePaymentsPage() {
  const [tab, setTab] = useState<'pending' | 'attempts' | 'reconciliation'>('pending');
  return (
    <>
      <PageHeader
        title="Paiements en ligne"
        subtitle="Un webhook n'est qu'un signal : chaque paiement est vérifié auprès du provider avant d'être enregistré."
      />
      <Tabs
        tabs={[
          { id: 'pending', label: 'Transactions en attente' },
          { id: 'attempts', label: 'Toutes les tentatives' },
          { id: 'reconciliation', label: 'Réconciliations' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'pending' && <Pending />}
      {tab === 'attempts' && <Attempts />}
      {tab === 'reconciliation' && <Reconciliations />}
    </>
  );
}

function AttemptRow({
  a,
  canAct,
  onReverify,
  onResolve,
}: {
  a: PaymentAttempt;
  canAct: boolean;
  onReverify: (a: PaymentAttempt) => void;
  onResolve: (a: PaymentAttempt) => void;
}) {
  return (
    <tr>
      <td className="whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
      <td>
        {a.student ? `${a.student.lastName} ${a.student.firstName}` : '—'}
        {a.payerName && (
          <span className="block text-xs text-slate-500">payé par {a.payerName}</span>
        )}
      </td>
      <td className="text-right tabular-nums font-semibold">{fmtXof(a.amount)}</td>
      <td>
        <AttemptBadge status={a.status} />
        {a.failureCode && <span className="block text-xs text-slate-500">{a.failureCode}</span>}
        {a.verifiedAmount !== null && a.verifiedAmount !== a.amount && (
          <span className="block text-xs text-red-700">vérifié : {fmtXof(a.verifiedAmount)}</span>
        )}
      </td>
      <td className="font-mono text-xs">{a.externalId ?? '—'}</td>
      <td className="whitespace-nowrap text-right">
        <Link
          href={`/finance/payments/attempts/${a.id}`}
          className="text-sm text-[var(--color-brand)] underline"
        >
          Détail
        </Link>
        {canAct && !['SUCCEEDED', 'CANCELLED', 'EXPIRED'].includes(a.status) && (
          <Button size="sm" variant="ghost" onClick={() => onReverify(a)}>
            Re-vérifier
          </Button>
        )}
        {canAct && a.reviewStatus === 'OPEN' && (
          <Button size="sm" variant="ghost" onClick={() => onResolve(a)}>
            Résoudre
          </Button>
        )}
      </td>
    </tr>
  );
}

const HEAD = (
  <>
    <th>Date</th>
    <th>Élève</th>
    <th className="text-right">Montant</th>
    <th>Statut</th>
    <th>Réf. provider</th>
    <th></th>
  </>
);

function useAttemptActions() {
  const qc = useQueryClient();
  const [resolving, setResolving] = useState<PaymentAttempt | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['payments'] });
  const reverify = useMutation({
    mutationFn: (a: PaymentAttempt) => payments.reverify(a.id),
    onSuccess: refresh,
  });
  return { resolving, setResolving, reverify, refresh };
}

function ResolveModal({
  attempt,
  onClose,
  onDone,
}: {
  attempt: PaymentAttempt | null;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => payments.resolve(attempt!.id, note.trim()),
    onSuccess: async () => {
      await onDone();
      setNote('');
      onClose();
    },
  });
  if (!attempt) return null;
  return (
    <Modal open title="Marquer comme résolue" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Alert tone="warning">
          Clôture la revue sans toucher au grand-livre : si le parent a réellement payé, enregistrez
          l&apos;encaissement manuellement sur sa fiche (avec la référence provider) ou laissez la
          tentative ouverte et re-vérifiez plus tard.
        </Alert>
        <Field label="Motif (audité)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            minLength={3}
            required
          />
        </Field>
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={m.isPending || note.trim().length < 3}>
            Résoudre
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Pending() {
  const can = useCan();
  const canAct = can('CANCEL_PAYMENT', 'MANAGE_PAYMENT_PROVIDER');
  const q = useQuery({
    queryKey: ['payments', 'pending'],
    queryFn: payments.pending,
    refetchInterval: 60_000,
  });
  const { resolving, setResolving, reverify, refresh } = useAttemptActions();
  const [orphan, setOrphan] = useState<{ runId: string; externalId: string } | null>(null);
  const [orphanNote, setOrphanNote] = useState('');
  const resolveOrphan = useMutation({
    mutationFn: () => payments.resolveOrphan(orphan!.runId, orphan!.externalId, orphanNote.trim()),
    onSuccess: async () => {
      await refresh();
      setOrphan(null);
      setOrphanNote('');
    },
  });
  const run = useMutation({ mutationFn: () => payments.runReconciliation(), onSuccess: refresh });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="À vérifier (revue)"
          value={d.counts.unknown}
          tone={d.counts.unknown ? 'red' : undefined}
        />
        <Stat
          label="En attente > 30 min"
          value={d.counts.stalePending}
          tone={d.counts.stalePending ? 'amber' : undefined}
        />
        <Stat
          label="Orphelines"
          value={d.counts.orphans}
          tone={d.counts.orphans ? 'red' : undefined}
        />
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Provider</p>
          {d.providerHealth ? (
            <>
              <p className="mt-1 font-semibold">
                {PROVIDER_LABELS[d.providerHealth.provider] ?? d.providerHealth.provider}
              </p>
              {d.providerHealth.circuitOpen ? (
                <Badge tone="red">Indisponible (disjoncteur ouvert)</Badge>
              ) : (
                <Badge tone="green">Disponible</Badge>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-500">Aucun provider actif</p>
          )}
        </div>
      </div>
      <ErrorAlert error={reverify.error ?? run.error} />

      <Card title={`À vérifier (${d.unknown.length})`}>
        {d.unknown.length === 0 ? (
          <Empty>Aucune tentative en revue : montants vérifiés, statuts connus.</Empty>
        ) : (
          <Table head={HEAD}>
            {d.unknown.map((a) => (
              <AttemptRow
                key={a.id}
                a={a}
                canAct={canAct}
                onReverify={(x) => reverify.mutate(x)}
                onResolve={setResolving}
              />
            ))}
          </Table>
        )}
      </Card>
      <Card title={`En attente depuis plus de 30 min (${d.stalePending.length})`}>
        <p className="mb-2 text-xs text-slate-500">
          Le parent a peut-être fermé la fenêtre : la réconciliation interroge le provider toutes
          les 5 min ; au-delà de 24 h après expiration, la tentative expire ou passe en revue.
        </p>
        {d.stalePending.length === 0 ? (
          <Empty>Rien en attente.</Empty>
        ) : (
          <Table head={HEAD}>
            {d.stalePending.map((a) => (
              <AttemptRow
                key={a.id}
                a={a}
                canAct={canAct}
                onReverify={(x) => reverify.mutate(x)}
                onResolve={setResolving}
              />
            ))}
          </Table>
        )}
      </Card>
      <Card
        title={`Transactions orphelines (${d.orphans.length})`}
        actions={
          canAct && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => run.mutate()}
              disabled={run.isPending}
            >
              {run.isPending ? 'Rapprochement…' : 'Rapprocher hier'}
            </Button>
          )
        }
      >
        <p className="mb-2 text-xs text-slate-500">
          Paiements réussis chez le provider sans tentative connue chez nous (le parent a payé, nous
          avons tout perdu) : à enregistrer manuellement sur la fiche de l&apos;élève, puis à
          marquer traitée.
          {d.lastReconciliation && (
            <>
              {' '}
              Dernier rapprochement : {fmtDate(d.lastReconciliation.day)} (
              {d.lastReconciliation.status}).
            </>
          )}
        </p>
        {d.orphans.length === 0 ? (
          <Empty>Aucune transaction orpheline.</Empty>
        ) : (
          <Table
            head={
              <>
                <th>Jour</th>
                <th>Réf. provider</th>
                <th className="text-right">Montant</th>
                <th>Horodatage</th>
                <th></th>
              </>
            }
          >
            {d.orphans.map((o) => (
              <tr key={`${o.runId}-${o.externalId}`}>
                <td>{fmtDate(o.day)}</td>
                <td className="font-mono text-xs">{o.externalId}</td>
                <td className="text-right tabular-nums font-semibold">{fmtXof(o.amount)}</td>
                <td className="text-xs">{o.occurredAt ? fmtDateTime(o.occurredAt) : '—'}</td>
                <td className="text-right">
                  {canAct && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOrphan({ runId: o.runId, externalId: o.externalId })}
                    >
                      Marquer traitée
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <ResolveModal attempt={resolving} onClose={() => setResolving(null)} onDone={refresh} />
      {orphan && (
        <Modal open title={`Transaction ${orphan.externalId}`} onClose={() => setOrphan(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              resolveOrphan.mutate();
            }}
          >
            <Field label="Comment a-t-elle été traitée ? (audité)">
              <Textarea
                value={orphanNote}
                onChange={(e) => setOrphanNote(e.target.value)}
                rows={3}
                required
                minLength={3}
              />
            </Field>
            <ErrorAlert error={resolveOrphan.error} />
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={resolveOrphan.isPending || orphanNote.trim().length < 3}
              >
                Marquer traitée
              </Button>
              <Button type="button" variant="secondary" onClick={() => setOrphan(null)}>
                Annuler
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Attempts() {
  const can = useCan();
  const canAct = can('CANCEL_PAYMENT', 'MANAGE_PAYMENT_PROVIDER');
  const [filters, setFilters] = useState({ status: '', from: '', to: todayIso() });
  const [cursor, setCursor] = useState<string | undefined>();
  const [stack, setStack] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ['payments', 'attempts', filters, cursor],
    queryFn: () =>
      payments.attempts({
        status: filters.status || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        limit: 50,
        cursor,
      }),
  });
  const { resolving, setResolving, reverify, refresh } = useAttemptActions();
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setCursor(undefined);
    setStack([]);
  };
  const rows = q.data?.data ?? [];
  return (
    <>
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Statut">
            <Select value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">Tous</option>
              {Object.entries(ATTEMPT_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Du">
            <Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
          </Field>
          <Field label="Au">
            <Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
          </Field>
        </div>
      </Card>
      <ErrorAlert error={q.error ?? reverify.error} />
      <Card title={`${rows.length} tentative(s)`}>
        {q.isPending ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>Aucune tentative pour ces critères.</Empty>
        ) : (
          <Table head={HEAD}>
            {rows.map((a) => (
              <AttemptRow
                key={a.id}
                a={a}
                canAct={canAct}
                onReverify={(x) => reverify.mutate(x)}
                onResolve={setResolving}
              />
            ))}
          </Table>
        )}
        <div className="mt-3 flex justify-between">
          <Button
            size="sm"
            variant="secondary"
            disabled={stack.length === 0}
            onClick={() => {
              const prev = [...stack];
              const c = prev.pop();
              setStack(prev);
              setCursor(c);
            }}
          >
            ← Précédent
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!q.data?.meta.nextCursor}
            onClick={() => {
              setStack((s) => [...s, cursor ?? '']);
              setCursor(q.data!.meta.nextCursor!);
            }}
          >
            Suivant →
          </Button>
        </div>
      </Card>
      <ResolveModal attempt={resolving} onClose={() => setResolving(null)} onDone={refresh} />
    </>
  );
}

function Reconciliations() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['payments', 'reconciliations'],
    queryFn: payments.reconciliations,
  });
  const [day, setDay] = useState('');
  const run = useMutation({
    mutationFn: () => payments.runReconciliation(day || undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payments'] }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  return (
    <Card
      title="Rapprochement quotidien provider ↔ Polaris"
      actions={
        can('CANCEL_PAYMENT', 'MANAGE_PAYMENT_PROVIDER') && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate();
            }}
          >
            <Field label="Journée (défaut : hier)">
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Button type="submit" size="sm" disabled={run.isPending}>
              Lancer
            </Button>
          </form>
        )
      }
    >
      <ErrorAlert error={run.error} />
      {q.data.length === 0 ? (
        <Empty>Aucun rapprochement encore exécuté (quotidien à 5 h 30).</Empty>
      ) : (
        <Table
          head={
            <>
              <th>Jour</th>
              <th>Provider</th>
              <th>Résultat</th>
              <th className="text-right">Vérifiées</th>
              <th className="text-right">Rapprochées</th>
              <th className="text-right">Orphelines</th>
              <th className="text-right">Écarts</th>
              <th>Exécuté</th>
            </>
          }
        >
          {q.data.map((r) => (
            <tr key={r.id}>
              <td>{fmtDate(r.day)}</td>
              <td>{PROVIDER_LABELS[r.provider] ?? r.provider}</td>
              <td>
                <Badge
                  tone={
                    r.status === 'OK' ? 'green' : r.status === 'DISCREPANCIES' ? 'red' : 'slate'
                  }
                >
                  {r.status === 'OK'
                    ? '0 écart'
                    : r.status === 'DISCREPANCIES'
                      ? 'Écarts'
                      : r.status === 'UNSUPPORTED'
                        ? 'Non supporté'
                        : 'Erreur'}
                </Badge>
                {r.error && <span className="block text-xs text-slate-500">{r.error}</span>}
              </td>
              <td className="text-right">{r.checked}</td>
              <td className="text-right">{r.matched}</td>
              <td className="text-right">
                {r.orphans.filter((o) => !o.resolved).length}
                {r.orphans.some((o) => o.resolved) && (
                  <span className="text-xs text-slate-400">
                    {' '}
                    (+{r.orphans.filter((o) => o.resolved).length} traitées)
                  </span>
                )}
              </td>
              <td className="text-right">{r.mismatches.length}</td>
              <td className="text-xs text-slate-500">{fmtDateTime(r.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
