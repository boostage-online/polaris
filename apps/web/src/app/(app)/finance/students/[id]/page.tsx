'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { Installment, Payment, StudentFee } from '@polaris/contracts';
import { useCan } from '@/components/app-shell';
import {
  AccountCards,
  AdjustmentModal,
  AdjustmentsTable,
  FeesTable,
  ManualPaymentModal,
  PaymentsTable,
  ReceiptModal,
  ReverseModal,
} from '@/components/billing';
import {
  Alert,
  Button,
  Card,
  ErrorAlert,
  Field,
  Loading,
  PageHeader,
  Select,
} from '@/components/ui';
import { fmtXof } from '@/lib/format';
import { billing } from '@/lib/resources';

/** Compte financier d'un élève : créances, encaissement manuel, ajustements, paiements, reçus. */
export default function StudentFinancePage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['billing', 'account', id], queryFn: () => billing.account(id) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [adjust, setAdjust] = useState<{ fee: StudentFee; installment: Installment | null } | null>(
    null,
  );
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [receipt, setReceipt] = useState<{
    paymentId: string;
    kind: 'PAYMENT' | 'CANCELLATION';
  } | null>(null);
  const [lastPayment, setLastPayment] = useState<Payment | null>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['billing'] }),
      qc.invalidateQueries({ queryKey: ['dashboards'] }),
    ]);

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const a = q.data;
  const toggle = (iid: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(iid)) n.delete(iid);
      else n.add(iid);
      return n;
    });

  return (
    <>
      <PageHeader
        title={`${a.student.lastName} ${a.student.firstName}`}
        subtitle={
          <>
            <span className="font-mono">{a.student.matricule}</span>
            {a.student.groupName && <> · {a.student.groupName}</>} ·{' '}
            <Link
              href={`/students/${a.student.id}`}
              className="text-[var(--color-brand)] underline"
            >
              Fiche élève
            </Link>
          </>
        }
        actions={
          <>
            {can('ASSIGN_FEES') && <AssignOne studentId={a.student.id} onDone={refresh} />}
            {can('RECORD_MANUAL_PAYMENT') && (
              <Button onClick={() => setPaying(true)} disabled={a.fees.length === 0}>
                Encaisser
                {selected.size > 0
                  ? ` (${selected.size} échéance${selected.size > 1 ? 's' : ''} ciblée${selected.size > 1 ? 's' : ''})`
                  : ''}
              </Button>
            )}
          </>
        }
      />

      {lastPayment && (
        <div className="mb-4">
          <Alert tone="success">
            Paiement de {fmtXof(lastPayment.amount)} enregistré — reçu{' '}
            <span className="font-mono">{lastPayment.receiptNumber}</span>.{' '}
            <button
              className="underline"
              onClick={() => setReceipt({ paymentId: lastPayment.id, kind: 'PAYMENT' })}
            >
              Afficher / imprimer le reçu
            </button>
          </Alert>
        </div>
      )}

      <AccountCards account={a}>
        <Card
          title="Créances et échéances"
          actions={
            can('RECORD_MANUAL_PAYMENT') &&
            selected.size > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Désélectionner
              </Button>
            )
          }
        >
          {can('RECORD_MANUAL_PAYMENT') && a.fees.length > 0 && (
            <p className="mb-2 text-xs text-slate-500">
              Cochez des échéances pour y imputer en priorité le prochain encaissement ; sinon les
              plus anciennes sont réglées d&apos;abord.
            </p>
          )}
          <FeesTable
            fees={a.fees}
            selected={can('RECORD_MANUAL_PAYMENT') ? selected : undefined}
            onToggle={can('RECORD_MANUAL_PAYMENT') ? toggle : undefined}
            actions={
              can('ADJUST_FEES')
                ? (fee, inst) =>
                    fee.status !== 'CANCELLED' &&
                    (!inst || inst.status !== 'CANCELLED') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAdjust({ fee, installment: inst })}
                      >
                        Ajuster
                      </Button>
                    )
                : undefined
            }
          />
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={`Paiements (${a.payments.length})`} className="lg:col-span-2">
            <PaymentsTable
              payments={a.payments}
              onReceipt={
                can('VIEW_PAYMENTS')
                  ? (p) =>
                      setReceipt({
                        paymentId: p.id,
                        kind: p.status === 'REVERSED' ? 'CANCELLATION' : 'PAYMENT',
                      })
                  : undefined
              }
              onReverse={can('CANCEL_PAYMENT') ? setReversing : undefined}
            />
          </Card>
          <Card title={`Ajustements (${a.adjustments.length})`}>
            <AdjustmentsTable adjustments={a.adjustments} />
            {a.credits.length > 0 && (
              <>
                <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Crédits
                </p>
                <ul className="space-y-1 text-sm">
                  {a.credits.map((c) => (
                    <li key={c.id} className="flex justify-between">
                      <span>
                        {fmtXof(c.amount)}{' '}
                        <span className="text-slate-500">
                          (
                          {c.status === 'OPEN'
                            ? `reste ${fmtXof(c.remaining)}`
                            : c.status === 'APPLIED'
                              ? 'imputé'
                              : 'remboursé'}
                          )
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
      </AccountCards>

      {paying && (
        <ManualPaymentModal
          open
          account={a}
          targeted={[...selected]}
          onClose={() => setPaying(false)}
          onDone={async (p) => {
            setLastPayment(p);
            setSelected(new Set());
            await refresh();
          }}
        />
      )}
      <AdjustmentModal
        open={Boolean(adjust)}
        fee={adjust?.fee ?? null}
        installment={adjust?.installment ?? null}
        onClose={() => setAdjust(null)}
        onDone={refresh}
      />
      <ReverseModal
        payment={reversing}
        onClose={() => setReversing(null)}
        onDone={async () => {
          setLastPayment(null);
          await refresh();
        }}
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

/** Affecter une grille à ce seul élève (arrivée tardive, option particulière). */
function AssignOne({ studentId, onDone }: { studentId: string; onDone: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [structureId, setStructureId] = useState('');
  const structures = useQuery({
    queryKey: ['billing', 'structures', 'active'],
    queryFn: () => billing.structures({ status: 'ACTIVE' }),
    enabled: open,
  });
  const m = useMutation({
    mutationFn: () => billing.assignToStudent(studentId, [structureId]),
    onSuccess: async () => {
      await onDone();
      setOpen(false);
      setStructureId('');
    },
  });
  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Affecter une grille
      </Button>
    );
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (structureId) m.mutate();
      }}
    >
      <Field label="Grille" className="w-72">
        <Select value={structureId} onChange={(e) => setStructureId(e.target.value)} required>
          <option value="">Choisir…</option>
          {structures.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {fmtXof(s.totalAmount)}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={!structureId || m.isPending}>
        OK
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Annuler
      </Button>
      <ErrorAlert error={m.error} />
    </form>
  );
}
