'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Installment, PaymentAttempt, StudentAccount } from '@polaris/contracts';
import { Alert, Badge, Button, ErrorAlert, Input, Modal, Table } from '@/components/ui';
import { ATTEMPT_STATUS, fmtDate, fmtDateTime, fmtXof, PROVIDER_LABELS } from '@/lib/format';
import { payments } from '@/lib/resources';

/** Composants du parcours de paiement en ligne côté parent (Phase 5). */

export function AttemptBadge({ status }: { status: string }) {
  const s = ATTEMPT_STATUS[status] ?? { label: status, tone: 'slate' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Choix du montant (prochaine échéance, tout le solde, montant libre) puis création de la tentative et
 * départ vers le provider. La clé d'idempotence est fixée à l'ouverture : un double clic ne crée pas deux tentatives.
 */
export function PayModal({
  open,
  studentId,
  account,
  onClose,
}: {
  open: boolean;
  studentId: string;
  account: StudentAccount;
  onClose: () => void;
}) {
  const router = useRouter();
  const [key] = useState(newKey);
  const options = useQuery({
    queryKey: ['payments', 'options', studentId],
    queryFn: () => payments.options(studentId),
    enabled: open,
  });
  const openInstallments: (Installment & { feeName: string })[] = account.fees
    .flatMap((f) => (f.installments ?? []).map((i) => ({ ...i, feeName: f.feeName })))
    .filter((i) => i.balance > 0 && i.status !== 'CANCELLED')
    .sort((a, b) => (a.dueDate === b.dueDate ? a.seq - b.seq : a.dueDate < b.dueDate ? -1 : 1));
  const next = openInstallments[0] ?? null;
  const balance = Math.max(0, account.totals.balance);
  const [mode, setMode] = useState<'next' | 'all' | 'custom'>(next ? 'next' : 'all');
  const [custom, setCustom] = useState('');
  const amount =
    mode === 'next'
      ? Math.max(0, next?.balance ?? 0)
      : mode === 'all'
        ? balance
        : Number(custom) || 0;
  const m = useMutation({
    mutationFn: () =>
      payments.start(studentId, key, {
        amount,
        installmentIds: mode === 'next' && next ? [next.id] : [],
      }),
    onSuccess: (a) => router.push(`/pay/${a.id}?s=${studentId}`),
  });
  const o = options.data;
  const valid = o?.enabled && amount >= (o.minAmount ?? 1) && amount <= (o.maxAmount ?? balance);
  return (
    <Modal open={open} title="Payer en ligne" onClose={onClose}>
      {options.isPending && <p className="text-sm text-slate-500">Chargement…</p>}
      <ErrorAlert error={options.error} />
      {o && !o.enabled && <Alert tone="warning">{o.reason}</Alert>}
      {o?.enabled && (
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (valid) m.mutate();
          }}
        >
          <p className="text-sm text-slate-600">
            Paiement sécurisé via <strong>{PROVIDER_LABELS[o.provider ?? ''] ?? o.provider}</strong>
            {o.environment === 'SANDBOX' && (
              <>
                {' '}
                <Badge tone="amber">environnement de test</Badge>
              </>
            )}
            . L&apos;argent arrive directement sur le compte de l&apos;établissement ; le reçu vous
            est envoyé dès confirmation.
          </p>
          <fieldset className="space-y-2 text-sm">
            {next && (
              <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3">
                <input type="radio" checked={mode === 'next'} onChange={() => setMode('next')} />
                <span>
                  <span className="font-medium">Prochaine échéance</span> — {next.feeName} ·{' '}
                  {next.label} ({fmtDate(next.dueDate)})
                  <span className="block text-lg font-semibold tabular-nums">
                    {fmtXof(Math.max(0, next.balance))}
                  </span>
                </span>
              </label>
            )}
            <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3">
              <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
              <span>
                <span className="font-medium">Tout le solde</span>
                <span className="block text-lg font-semibold tabular-nums">{fmtXof(balance)}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3">
              <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} />
              <span className="flex-1">
                <span className="font-medium">Autre montant</span>
                <Input
                  type="number"
                  min={o.minAmount}
                  max={o.maxAmount}
                  step={1}
                  inputMode="numeric"
                  className="mt-1"
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setMode('custom');
                  }}
                  placeholder={`Entre ${o.minAmount.toLocaleString('fr-FR')} et ${o.maxAmount.toLocaleString('fr-FR')} FCFA`}
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Imputé sur les échéances les plus anciennes.
                </span>
              </span>
            </label>
          </fieldset>
          <ErrorAlert error={m.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={!valid || m.isPending}>
              {m.isPending ? 'Préparation…' : `Payer ${amount ? fmtXof(amount) : ''}`}
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

/** Historique des tentatives d'un enfant (parent) : reprendre un paiement en attente, voir l'issue. */
export function AttemptsHistory({ studentId }: { studentId: string }) {
  const q = useQuery({
    queryKey: ['payments', 'my-attempts', studentId],
    queryFn: () => payments.myAttempts(studentId),
  });
  const list = (q.data ?? []).filter((a) => a.status !== 'CREATED');
  if (list.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Paiements en ligne
      </p>
      <Table
        head={
          <>
            <th>Date</th>
            <th className="text-right">Montant</th>
            <th>Statut</th>
            <th></th>
          </>
        }
      >
        {list.map((a) => (
          <tr key={a.id}>
            <td className="whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
            <td className="text-right tabular-nums">{fmtXof(a.amount)}</td>
            <td>
              <AttemptBadge status={a.status} />
              {a.failureMessage && (
                <p className="mt-0.5 text-xs text-slate-500">{a.failureMessage}</p>
              )}
            </td>
            <td className="text-right">
              {(a.status === 'PENDING' || a.status === 'PROCESSING') && (
                <Link
                  href={`/pay/${a.id}/return?s=${studentId}`}
                  className="text-sm text-[var(--color-brand)] underline"
                >
                  Vérifier
                </Link>
              )}
              {a.status === 'SUCCEEDED' && a.receiptNumber && (
                <span className="font-mono text-xs">{a.receiptNumber}</span>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export function AttemptSummary({ a }: { a: PaymentAttempt }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-slate-500">Montant</dt>
      <dd className="font-semibold tabular-nums">{fmtXof(a.amount)}</dd>
      <dt className="text-slate-500">Provider</dt>
      <dd>{PROVIDER_LABELS[a.provider] ?? a.provider}</dd>
      <dt className="text-slate-500">Statut</dt>
      <dd>
        <AttemptBadge status={a.status} />
      </dd>
      {a.receiptNumber && (
        <>
          <dt className="text-slate-500">Reçu</dt>
          <dd className="font-mono">{a.receiptNumber}</dd>
        </>
      )}
    </dl>
  );
}
