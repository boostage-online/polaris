'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useCan } from '@/components/app-shell';
import { InstallmentBadge, Money } from '@/components/billing';
import {
  Alert,
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
import { fmtDate, fmtXof } from '@/lib/format';
import { billing, groups } from '@/lib/resources';

export default function UnpaidPage() {
  return (
    <Suspense fallback={<Loading />}>
      <UnpaidInner />
    </Suspense>
  );
}

/** Impayés : échéances ouvertes (filtres, sélection, rappel manuel), synthèse par classe, exports. */
function UnpaidInner() {
  const can = useCan();
  const params = useSearchParams();
  const [tab, setTab] = useState<'installments' | 'groups'>('installments');
  const exp = useMutation({
    mutationFn: (kind: 'aged-balance' | 'unpaid') => billing.exportCsv(kind),
  });
  return (
    <>
      <PageHeader
        title="Impayés"
        subtitle="Échéances dues ou en retard, par élève et par classe. Les rappels automatiques partent à J−7, J−1, J+1 puis périodiquement."
        actions={
          can('EXPORT_FINANCIAL_DATA') && (
            <>
              <Button
                variant="secondary"
                onClick={() => exp.mutate('unpaid')}
                disabled={exp.isPending}
              >
                Export impayés
              </Button>
              <Button
                variant="secondary"
                onClick={() => exp.mutate('aged-balance')}
                disabled={exp.isPending}
              >
                Balance âgée
              </Button>
            </>
          )
        }
      />
      <ErrorAlert error={exp.error} />
      <Tabs
        tabs={[
          { id: 'installments', label: 'Par échéance' },
          { id: 'groups', label: 'Par classe' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'installments' ? (
        <Installments initialGroupId={params.get('groupId') ?? ''} />
      ) : (
        <ByGroup />
      )}
    </>
  );
}

function Installments({ initialGroupId }: { initialGroupId: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const grps = useQuery({
    queryKey: ['groups', 'CLASS'],
    queryFn: () => groups.list({ kind: 'CLASS' }),
  });
  const structures = useQuery({
    queryKey: ['billing', 'structures', 'all'],
    queryFn: () => billing.structures(),
  });
  const [filters, setFilters] = useState({
    groupId: initialGroupId,
    feeStructureId: '',
    status: 'ALL_OPEN' as 'DUE' | 'OVERDUE' | 'ALL_OPEN',
    q: '',
  });
  const [cursor, setCursor] = useState<string | undefined>();
  const [stack, setStack] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ['billing', 'unpaid', filters, cursor],
    queryFn: () =>
      billing.unpaid({
        groupId: filters.groupId || undefined,
        feeStructureId: filters.feeStructureId || undefined,
        status: filters.status,
        q: filters.q || undefined,
        limit: 50,
        cursor,
      }),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reminding, setReminding] = useState(false);
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setCursor(undefined);
    setStack([]);
    setSelected(new Set());
  };
  const rows = q.data?.data ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const totalBalance = rows.reduce((t, r) => t + Math.max(0, r.balance), 0);
  return (
    <>
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Classe">
            <Select value={filters.groupId} onChange={(e) => set('groupId', e.target.value)}>
              <option value="">Toutes</option>
              {grps.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Grille">
            <Select
              value={filters.feeStructureId}
              onChange={(e) => set('feeStructureId', e.target.value)}
            >
              <option value="">Toutes</option>
              {structures.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statut">
            <Select value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="ALL_OPEN">Toutes les échéances ouvertes</option>
              <option value="DUE">Dues (échues, non en retard)</option>
              <option value="OVERDUE">En retard</option>
            </Select>
          </Field>
          <Field label="Élève">
            <Input
              placeholder="Nom ou matricule"
              value={filters.q}
              onChange={(e) => set('q', e.target.value)}
            />
          </Field>
        </div>
      </Card>
      <ErrorAlert error={q.error} />
      <Card
        title={
          <>
            {rows.length} échéance(s) · reste{' '}
            <span className="tabular-nums">{fmtXof(totalBalance)}</span>
          </>
        }
        actions={
          can('SEND_PAYMENT_REMINDER') && (
            <Button size="sm" disabled={selected.size === 0} onClick={() => setReminding(true)}>
              Envoyer un rappel ({selected.size})
            </Button>
          )
        }
      >
        {q.isPending ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>Aucune échéance ouverte pour ces critères.</Empty>
        ) : (
          <Table
            head={
              <>
                {can('SEND_PAYMENT_REMINDER') && (
                  <th>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                      }
                      aria-label="Tout sélectionner"
                    />
                  </th>
                )}
                <th>Élève</th>
                <th>Classe</th>
                <th>Frais · échéance</th>
                <th>Date</th>
                <th className="text-right">Reste</th>
                <th>Statut</th>
                <th className="text-right">Rappels</th>
              </>
            }
          >
            {rows.map((i) => (
              <tr key={i.id}>
                {can('SEND_PAYMENT_REMINDER') && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(i.id)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(i.id)) n.delete(i.id);
                          else n.add(i.id);
                          return n;
                        })
                      }
                    />
                  </td>
                )}
                <td>
                  <Link
                    href={`/finance/students/${i.student?.id}`}
                    className="font-medium text-[var(--color-brand)] hover:underline"
                  >
                    {i.student?.lastName} {i.student?.firstName}
                  </Link>
                  <span className="ml-1 font-mono text-xs text-slate-500">
                    {i.student?.matricule}
                  </span>
                </td>
                <td>{i.student?.groupName ?? '—'}</td>
                <td>
                  {i.feeName} · {i.label}
                </td>
                <td>{fmtDate(i.dueDate)}</td>
                <td className="text-right">
                  <Money value={Math.max(0, i.balance)} tone="strong" />
                </td>
                <td>
                  <InstallmentBadge status={i.status} />
                </td>
                <td className="text-right text-slate-500">{i.remindersCount ?? 0}</td>
              </tr>
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
      {reminding && (
        <ReminderModal
          installmentIds={[...selected]}
          onClose={() => setReminding(false)}
          onDone={async () => {
            setSelected(new Set());
            await qc.invalidateQueries({ queryKey: ['billing', 'unpaid'] });
          }}
        />
      )}
    </>
  );
}

function ReminderModal({
  installmentIds,
  onClose,
  onDone,
}: {
  installmentIds: string[];
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [message, setMessage] = useState('');
  const m = useMutation({
    mutationFn: () => billing.remind(installmentIds, message.trim() || undefined),
  });
  return (
    <Modal
      open
      title={`Rappel de paiement — ${installmentIds.length} échéance(s)`}
      onClose={onClose}
    >
      {m.data ? (
        <div className="space-y-3">
          <Alert tone="success">
            Rappel envoyé à {m.data.guardians} tuteur(s) pour {m.data.installments} échéance(s)
            {m.data.skipped > 0 &&
              ` ; ${m.data.skipped} ignorée(s) (déjà rappelée(s) aujourd'hui ou sans tuteur joignable)`}
            .
          </Alert>
          <Button
            onClick={async () => {
              await onDone();
              onClose();
            }}
          >
            Fermer
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <p className="text-sm text-slate-600">
            Un message par tuteur (droit « frais »), regroupant les échéances de ses enfants, via
            ses canaux préférés (SMS, e-mail, application). Un rappel manuel par échéance et par
            jour au maximum.
          </p>
          <Field label="Complément (facultatif, 240 caractères max.)">
            <Input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={240} />
          </Field>
          <ErrorAlert error={m.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={m.isPending}>
              Envoyer
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Annuler
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ByGroup() {
  const q = useQuery({
    queryKey: ['billing', 'unpaid', 'by-group'],
    queryFn: billing.unpaidByGroup,
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  if (q.data.length === 0) return <Empty>Aucune créance cette année.</Empty>;
  const tot = q.data.reduce(
    (t, g) => ({
      due: t.due + g.due,
      paid: t.paid + g.paid,
      balance: t.balance + g.balance,
      overdue: t.overdue + g.overdue,
    }),
    { due: 0, paid: 0, balance: 0, overdue: 0 },
  );
  return (
    <Card>
      <Table
        head={
          <>
            <th>Classe</th>
            <th className="text-right">Élèves</th>
            <th className="text-right">Dû</th>
            <th className="text-right">Payé</th>
            <th className="text-right">Solde</th>
            <th className="text-right">En retard</th>
            <th className="text-right">Recouvrement</th>
          </>
        }
      >
        {q.data.map((g) => (
          <tr key={g.groupId}>
            <td className="font-medium">{g.groupName}</td>
            <td className="text-right">{g.students}</td>
            <td className="text-right">
              <Money value={g.due} />
            </td>
            <td className="text-right">
              <Money value={g.paid} />
            </td>
            <td className="text-right">
              <Money value={g.balance} tone="strong" />
            </td>
            <td className={`text-right ${g.overdue > 0 ? 'text-red-700' : ''}`}>
              <Money value={g.overdue} />
            </td>
            <td className="text-right">
              <div className="flex items-center justify-end gap-2">
                <div className="h-2 w-24 overflow-hidden rounded bg-slate-100">
                  <div
                    className="h-full bg-[var(--color-brand)]"
                    style={{ width: `${g.recoveryRate ?? 0}%` }}
                  />
                </div>
                <span className="w-12 tabular-nums">
                  {g.recoveryRate === null ? '—' : `${g.recoveryRate} %`}
                </span>
              </div>
            </td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td>Total</td>
          <td></td>
          <td className="text-right">
            <Money value={tot.due} />
          </td>
          <td className="text-right">
            <Money value={tot.paid} />
          </td>
          <td className="text-right">
            <Money value={tot.balance} />
          </td>
          <td className="text-right">
            <Money value={tot.overdue} />
          </td>
          <td className="text-right">
            {tot.due ? `${Math.round((tot.paid / tot.due) * 100)} %` : '—'}
          </td>
        </tr>
      </Table>
    </Card>
  );
}
