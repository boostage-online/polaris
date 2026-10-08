'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { Payment } from '@polaris/contracts';
import { useCan } from '@/components/app-shell';
import { PaymentsTable, ReceiptModal, ReverseModal } from '@/components/billing';
import {
  Button,
  Card,
  ErrorAlert,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
} from '@/components/ui';
import { fmtXof, PAYMENT_METHODS, todayIso } from '@/lib/format';
import { billing, students } from '@/lib/resources';

/** Journal de caisse : encaissements filtrés (période, mode, caissier), reçus, annulation, export CSV. */
export default function CashJournalPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({
    from: todayIso(),
    to: todayIso(),
    method: '' as '' | Payment['method'],
    status: '' as '' | 'COMPLETED' | 'REVERSED',
    mine: false,
  });
  const [cursor, setCursor] = useState<string | undefined>();
  const [stack, setStack] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ['billing', 'payments', filters, cursor],
    queryFn: () =>
      billing.payments({
        from: filters.from || undefined,
        to: filters.to || undefined,
        method: filters.method || undefined,
        status: filters.status || undefined,
        mine: filters.mine || undefined,
        limit: 50,
        cursor,
      }),
  });
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [receipt, setReceipt] = useState<{
    paymentId: string;
    kind: 'PAYMENT' | 'CANCELLATION';
  } | null>(null);
  const exp = useMutation({
    mutationFn: () =>
      billing.exportCsv('payments', {
        from: filters.from || undefined,
        to: filters.to || undefined,
      }),
  });
  const set = (k: keyof typeof filters, v: string | boolean) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setCursor(undefined);
    setStack([]);
  };
  const rows = q.data?.data ?? [];
  const total = rows.filter((p) => p.status === 'COMPLETED').reduce((t, p) => t + p.amount, 0);

  return (
    <>
      <PageHeader
        title="Journal de caisse"
        subtitle="Chaque encaissement est immuable ; une erreur se corrige par annulation compensatoire."
        actions={
          <>
            {can('RECORD_MANUAL_PAYMENT') && <QuickCashier />}
            {can('EXPORT_FINANCIAL_DATA') && (
              <Button variant="secondary" onClick={() => exp.mutate()} disabled={exp.isPending}>
                Exporter CSV
              </Button>
            )}
          </>
        }
      />
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Du">
            <Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
          </Field>
          <Field label="Au">
            <Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
          </Field>
          <Field label="Mode">
            <Select value={filters.method} onChange={(e) => set('method', e.target.value)}>
              <option value="">Tous</option>
              {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statut">
            <Select value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">Tous</option>
              <option value="COMPLETED">Encaissés</option>
              <option value="REVERSED">Annulés</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              checked={filters.mine}
              onChange={(e) => set('mine', e.target.checked)}
            />
            Mes encaissements seulement
          </label>
        </div>
      </Card>
      <ErrorAlert error={q.error ?? exp.error} />
      <Card
        title={
          <>
            {rows.length} paiement(s) sur la page ·{' '}
            <span className="tabular-nums">{fmtXof(total)}</span> encaissés
          </>
        }
      >
        {q.isPending ? (
          <Loading />
        ) : (
          <PaymentsTable
            payments={rows}
            showStudent
            showCashier
            onReceipt={(p) =>
              setReceipt({
                paymentId: p.id,
                kind: p.status === 'REVERSED' ? 'CANCELLATION' : 'PAYMENT',
              })
            }
            onReverse={can('CANCEL_PAYMENT') ? setReversing : undefined}
          />
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
      <ReverseModal
        payment={reversing}
        onClose={() => setReversing(null)}
        onDone={() => qc.invalidateQueries({ queryKey: ['billing'] })}
      />
      <ReceiptModal
        paymentId={receipt?.paymentId ?? null}
        kind={receipt?.kind}
        onClose={() => setReceipt(null)}
        fetchReceipt={(pid) => billing.receipt(pid, receipt?.kind ?? 'PAYMENT')}
        download={billing.downloadReceipt}
      />
    </>
  );
}

/** Recherche rapide d'un élève pour ouvrir son compte et encaisser. */
function QuickCashier() {
  const [qtext, setQ] = useState('');
  const found = useQuery({
    queryKey: ['students', { q: qtext, limit: 6 }],
    queryFn: () => students.list({ q: qtext, limit: 6 }),
    enabled: qtext.trim().length >= 2,
  });
  return (
    <div className="relative">
      <Input
        placeholder="Encaisser : nom ou matricule…"
        value={qtext}
        onChange={(e) => setQ(e.target.value)}
        className="w-64"
      />
      {found.data && qtext.trim().length >= 2 && (
        <ul className="absolute right-0 z-20 mt-1 w-80 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white text-sm shadow-lg">
          {found.data.data.length === 0 && (
            <li className="px-3 py-2 text-slate-500">Aucun élève.</li>
          )}
          {found.data.data.map((s) => (
            <li key={s.id}>
              <Link
                href={`/finance/students/${s.id}`}
                className="flex items-center justify-between px-3 py-2 hover:bg-slate-50"
                onClick={() => setQ('')}
              >
                <span>
                  {s.lastName} {s.firstName}
                  {s.currentGroup && (
                    <span className="text-slate-500"> · {s.currentGroup.name}</span>
                  )}
                </span>
                <span className="font-mono text-xs text-slate-500">{s.matricule}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
