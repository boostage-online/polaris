'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type {
  Adjustment,
  Installment,
  Payment,
  Receipt,
  StudentAccount,
  StudentFee,
} from '@polaris/contracts';
import {
  Alert,
  Badge,
  Button,
  Empty,
  ErrorAlert,
  Field,
  Input,
  Modal,
  Select,
  Stat,
  Table,
  Textarea,
} from '@/components/ui';
import {
  ADJUSTMENT_KINDS,
  FEE_STATUS,
  fmtDate,
  fmtDateTime,
  fmtXof,
  INSTALLMENT_STATUS,
  PAYMENT_METHODS,
  todayIso,
} from '@/lib/format';
import { billing } from '@/lib/resources';

/** Composants partagés des écrans finance (caisse, fiche élève, espace parent). */

export function Money({ value, tone }: { value: number; tone?: 'muted' | 'strong' }) {
  return (
    <span
      className={
        tone === 'muted'
          ? 'tabular-nums text-slate-500'
          : tone === 'strong'
            ? 'tabular-nums font-semibold'
            : 'tabular-nums'
      }
    >
      {fmtXof(value)}
    </span>
  );
}

export function InstallmentBadge({ status }: { status: string }) {
  const s = INSTALLMENT_STATUS[status] ?? { label: status, tone: 'slate' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
export function FeeBadge({ status }: { status: string }) {
  const s = FEE_STATUS[status] ?? { label: status, tone: 'slate' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
export function PaymentBadge({ p }: { p: Pick<Payment, 'status' | 'source'> }) {
  if (p.status === 'REVERSED') return <Badge tone="red">Annulé</Badge>;
  return <Badge tone="green">{p.source === 'MANUAL' ? 'Encaissé' : 'Payé en ligne'}</Badge>;
}

/** Totaux d'un compte élève (dû, payé, solde, échu, retard, crédit). */
export function AccountTotals({ totals }: { totals: StudentAccount['totals'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Stat label="Total dû" value={fmtXof(totals.due)} />
      <Stat label="Payé" value={fmtXof(totals.paid)} />
      <Stat
        label="Solde"
        value={fmtXof(totals.balance)}
        tone={totals.balance > 0 ? 'amber' : undefined}
      />
      <Stat
        label="Exigible"
        value={fmtXof(totals.dueNow)}
        tone={totals.dueNow > 0 ? 'amber' : undefined}
      />
      <Stat
        label="En retard"
        value={fmtXof(totals.overdue)}
        tone={totals.overdue > 0 ? 'red' : undefined}
      />
      <Stat label="Crédit" value={fmtXof(totals.credit)} />
    </div>
  );
}

/** Créances et échéances d'un élève, avec sélection facultative d'échéances (pour cibler un encaissement). */
export function FeesTable({
  fees,
  selected,
  onToggle,
  actions,
}: {
  fees: StudentFee[];
  selected?: Set<string>;
  onToggle?: (installmentId: string) => void;
  actions?: (fee: StudentFee, installment: Installment | null) => ReactNode;
}) {
  if (fees.length === 0) return <Empty>Aucune créance : affectez une grille de frais.</Empty>;
  return (
    <div className="space-y-4">
      {fees.map((f) => (
        <div key={f.id} className="rounded-md border border-slate-200">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{f.feeName}</span>
              {f.categoryName && <span className="text-slate-500">· {f.categoryName}</span>}
              <FeeBadge status={f.status} />
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <span>
                Dû <Money value={f.totalAmount + f.adjustmentsTotal} />
                {f.adjustmentsTotal !== 0 && (
                  <span className="text-slate-400">
                    {' '}
                    (dont ajust. {f.adjustmentsTotal > 0 ? '+' : ''}
                    {f.adjustmentsTotal.toLocaleString('fr-FR')})
                  </span>
                )}
              </span>
              <span>
                Payé <Money value={f.amountAllocated} />
              </span>
              <span>
                Solde <Money value={f.balance} tone="strong" />
              </span>
              {actions?.(f, null)}
            </div>
          </header>
          <Table
            head={
              <>
                {onToggle && <th></th>}
                <th>#</th>
                <th>Échéance</th>
                <th>Date</th>
                <th className="text-right">Montant</th>
                <th className="text-right">Payé</th>
                <th className="text-right">Reste</th>
                <th>Statut</th>
                {actions && <th></th>}
              </>
            }
          >
            {(f.installments ?? []).map((i) => {
              const open = i.balance > 0 && i.status !== 'CANCELLED';
              return (
                <tr key={i.id} className={i.status === 'PAID' ? 'text-slate-500' : ''}>
                  {onToggle && (
                    <td>
                      {open && (
                        <input
                          type="checkbox"
                          checked={selected?.has(i.id) ?? false}
                          onChange={() => onToggle(i.id)}
                          aria-label={`Cibler ${i.label}`}
                        />
                      )}
                    </td>
                  )}
                  <td className="text-slate-500">{i.seq}</td>
                  <td className="font-medium">{i.label}</td>
                  <td>{fmtDate(i.dueDate)}</td>
                  <td className="text-right">
                    <Money value={i.amountDue + i.adjustmentsTotal} />
                  </td>
                  <td className="text-right">
                    <Money value={i.amountAllocated} tone="muted" />
                  </td>
                  <td className="text-right">
                    <Money value={Math.max(0, i.balance)} tone={open ? 'strong' : 'muted'} />
                  </td>
                  <td>
                    <InstallmentBadge status={i.status} />
                  </td>
                  {actions && <td className="text-right">{actions(f, i)}</td>}
                </tr>
              );
            })}
          </Table>
        </div>
      ))}
    </div>
  );
}

export function PaymentsTable({
  payments,
  onReceipt,
  onReverse,
  showStudent,
  showCashier,
}: {
  payments: Payment[];
  onReceipt?: (p: Payment) => void;
  onReverse?: (p: Payment) => void;
  showStudent?: boolean;
  showCashier?: boolean;
}) {
  if (payments.length === 0) return <Empty>Aucun paiement.</Empty>;
  return (
    <Table
      head={
        <>
          <th>Date</th>
          {showStudent && <th>Élève</th>}
          <th>Reçu</th>
          <th>Mode</th>
          <th className="text-right">Montant</th>
          <th>Imputation</th>
          {showCashier && <th>Caissier</th>}
          <th>Statut</th>
          <th></th>
        </>
      }
    >
      {payments.map((p) => (
        <tr key={p.id} className={p.status === 'REVERSED' ? 'text-slate-500 line-through' : ''}>
          <td className="whitespace-nowrap">{fmtDate(p.valueDate)}</td>
          {showStudent && (
            <td>
              {p.student ? `${p.student.lastName} ${p.student.firstName}` : '—'}
              {p.student && (
                <span className="ml-1 font-mono text-xs text-slate-500">{p.student.matricule}</span>
              )}
            </td>
          )}
          <td className="font-mono text-xs">{p.receiptNumber ?? '—'}</td>
          <td>
            {PAYMENT_METHODS[p.method] ?? p.method}
            {p.reference && <span className="ml-1 text-xs text-slate-500">({p.reference})</span>}
          </td>
          <td className="text-right">
            <Money value={p.amount} tone="strong" />
          </td>
          <td className="text-xs text-slate-600">
            {(p.allocations ?? []).map((a) => (
              <div key={`${a.installmentId}-${a.amount}`}>
                {a.feeName} · {a.label} : {a.amount.toLocaleString('fr-FR')}
              </div>
            ))}
            {(p.creditAmount ?? 0) > 0 && (
              <div>Crédit : {p.creditAmount?.toLocaleString('fr-FR')}</div>
            )}
          </td>
          {showCashier && <td className="text-xs">{p.recordedByName ?? '—'}</td>}
          <td>
            <PaymentBadge p={p} />
            {p.reversalReason && (
              <p className="mt-0.5 text-xs text-slate-500 no-underline">{p.reversalReason}</p>
            )}
          </td>
          <td className="whitespace-nowrap text-right">
            {onReceipt && (
              <Button size="sm" variant="ghost" onClick={() => onReceipt(p)}>
                Reçu
              </Button>
            )}
            {onReverse && p.status === 'COMPLETED' && (
              <Button size="sm" variant="ghost" onClick={() => onReverse(p)}>
                Annuler
              </Button>
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function AdjustmentsTable({ adjustments }: { adjustments: Adjustment[] }) {
  if (adjustments.length === 0) return <Empty>Aucun ajustement.</Empty>;
  return (
    <Table
      head={
        <>
          <th>Date</th>
          <th>Nature</th>
          <th className="text-right">Montant</th>
          <th>Motif</th>
          <th>Par</th>
        </>
      }
    >
      {adjustments.map((a) => (
        <tr key={a.id}>
          <td className="whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
          <td>{ADJUSTMENT_KINDS[a.kind] ?? a.kind}</td>
          <td
            className={`text-right tabular-nums ${a.amount < 0 ? 'text-emerald-700' : 'text-red-700'}`}
          >
            {a.amount > 0 ? '+' : ''}
            {a.amount.toLocaleString('fr-FR')}
          </td>
          <td>{a.reason}</td>
          <td className="text-xs">{a.createdByName ?? '—'}</td>
        </tr>
      ))}
    </Table>
  );
}

// ----------------------------------------------------------------------------- encaissement manuel

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Encaissement manuel : la clé d'idempotence est générée à l'ouverture et conservée tant que le formulaire
 * n'a pas abouti — un double clic ou une relance réseau ne crée jamais deux paiements.
 */
export function ManualPaymentModal({
  open,
  account,
  targeted,
  onClose,
  onDone,
}: {
  open: boolean;
  account: StudentAccount;
  targeted?: string[];
  onClose: () => void;
  onDone: (p: Payment) => Promise<unknown>;
}) {
  const [key, setKey] = useState(newKey);
  const [form, setForm] = useState({
    amount: '',
    method: 'CASH' as 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'MOBILE_MONEY_OFFLINE',
    valueDate: todayIso(),
    payerName: '',
    reference: '',
    comment: '',
  });
  const m = useMutation({
    mutationFn: () =>
      billing.recordManual(account.student.id, key, {
        amount: Number(form.amount),
        method: form.method,
        valueDate: form.valueDate,
        payerName: form.payerName.trim() || null,
        reference: form.reference.trim() || null,
        comment: form.comment.trim() || null,
        installmentIds: targeted ?? [],
      }),
    onSuccess: async (p) => {
      await onDone(p);
      setKey(newKey());
      setForm((f) => ({ ...f, amount: '', reference: '', comment: '' }));
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const amount = Number(form.amount) || 0;
  const targetedLabels = useMemo(() => {
    if (!targeted?.length) return [];
    const all = account.fees.flatMap((f) =>
      (f.installments ?? []).map((i) => ({ ...i, feeName: f.feeName })),
    );
    return targeted.map((id) => all.find((i) => i.id === id)).filter(Boolean) as Installment[];
  }, [targeted, account.fees]);
  const over = amount > account.totals.balance && account.totals.balance >= 0;
  return (
    <Modal
      open={open}
      title={`Encaisser — ${account.student.firstName} ${account.student.lastName}`}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (amount >= 1) m.mutate();
        }}
      >
        <p className="text-sm text-slate-600">
          Solde actuel : <Money value={account.totals.balance} tone="strong" />
          {account.totals.dueNow > 0 && (
            <>
              {' '}
              · exigible <Money value={account.totals.dueNow} />
            </>
          )}
        </p>
        {targetedLabels.length > 0 ? (
          <Alert tone="info">
            Imputation ciblée : {targetedLabels.map((i) => `${i.feeName} · ${i.label}`).join(', ')},
            puis les plus anciennes.
          </Alert>
        ) : (
          <p className="text-xs text-slate-500">
            Imputation automatique sur les échéances les plus anciennes ; le surplus devient un
            crédit.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Montant (FCFA)">
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={form.amount}
              onChange={set('amount')}
              required
              autoFocus
            />
          </Field>
          <Field label="Mode">
            <Select value={form.method} onChange={set('method')}>
              <option value="CASH">Espèces</option>
              <option value="BANK_TRANSFER">Virement</option>
              <option value="CHEQUE">Chèque</option>
              <option value="MOBILE_MONEY_OFFLINE">Mobile money (reçu hors ligne)</option>
            </Select>
          </Field>
          <Field label="Date de valeur">
            <Input type="date" value={form.valueDate} onChange={set('valueDate')} required />
          </Field>
          <Field label="Payeur (nom figurant sur le reçu)">
            <Input value={form.payerName} onChange={set('payerName')} />
          </Field>
          <Field
            label="Référence"
            hint={
              form.method === 'CHEQUE'
                ? 'Numéro de chèque'
                : form.method === 'BANK_TRANSFER'
                  ? 'Référence du virement'
                  : form.method === 'MOBILE_MONEY_OFFLINE'
                    ? 'ID de transaction'
                    : undefined
            }
          >
            <Input value={form.reference} onChange={set('reference')} />
          </Field>
          <Field label="Commentaire">
            <Input value={form.comment} onChange={set('comment')} />
          </Field>
        </div>
        {over && amount > 0 && (
          <Alert tone="warning">
            Le montant dépasse le solde : {fmtXof(amount - account.totals.balance)} seront portés en
            crédit et imputés automatiquement sur les prochaines créances.
          </Alert>
        )}
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={m.isPending || amount < 1}>
            {m.isPending ? 'Enregistrement…' : `Encaisser ${amount ? fmtXof(amount) : ''}`}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AdjustmentModal({
  open,
  fee,
  installment,
  onClose,
  onDone,
}: {
  open: boolean;
  fee: StudentFee | null;
  installment: Installment | null;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [kind, setKind] = useState<Adjustment['kind']>('DISCOUNT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const sign = kind === 'PENALTY' ? 1 : kind === 'CORRECTION' ? 0 : -1;
  const m = useMutation({
    mutationFn: () =>
      billing.adjust({
        studentFeeId: fee!.id,
        installmentId: installment?.id,
        amount: sign === 0 ? Number(amount) : sign * Math.abs(Number(amount)),
        kind,
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      await onDone();
      setAmount('');
      setReason('');
      onClose();
    },
  });
  if (!fee) return null;
  return (
    <Modal
      open={open}
      title={`Ajuster — ${fee.feeName}${installment ? ` · ${installment.label}` : ''}`}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <p className="text-sm text-slate-600">
          Un ajustement ne modifie jamais la grille : il est historisé sur la créance
          {installment
            ? ' et imputé sur cette échéance'
            : ' et imputé sur la dernière échéance ouverte'}
          .
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nature">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Adjustment['kind'])}>
              {Object.entries(ADJUSTMENT_KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Montant (FCFA)"
            hint={
              sign < 0
                ? 'Réduit le dû'
                : sign > 0
                  ? 'Augmente le dû'
                  : 'Signé : négatif pour réduire, positif pour augmenter'
            }
          >
            <Input
              type="number"
              step={1}
              min={sign === 0 ? undefined : 1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="Motif (obligatoire, visible dans l'historique)">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            minLength={3}
            required
          />
        </Field>
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={m.isPending || !Number(amount) || reason.trim().length < 3}
          >
            Enregistrer l&apos;ajustement
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReverseModal({
  payment,
  onClose,
  onDone,
}: {
  payment: Payment | null;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => billing.reverse(payment!.id, reason.trim()),
    onSuccess: async () => {
      await onDone();
      setReason('');
      onClose();
    },
  });
  if (!payment) return null;
  return (
    <Modal open title={`Annuler le paiement ${payment.receiptNumber ?? ''}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Alert tone="warning">
          Le paiement de <strong>{fmtXof(payment.amount)}</strong> n&apos;est pas supprimé : une
          écriture compensatoire annule ses imputations, les échéances redeviennent dues et un reçu
          d&apos;annulation est émis. L&apos;opération est tracée et irréversible.
        </Alert>
        <Field label="Motif (obligatoire)">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            minLength={3}
            required
            autoFocus
          />
        </Field>
        <ErrorAlert error={m.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="danger" disabled={m.isPending || reason.trim().length < 3}>
            Confirmer l&apos;annulation
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Retour
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Instantané figé d'un reçu tel que l'API le sérialise (miroir de `ReceiptSnapshot` côté API). */
interface ReceiptSnapshot {
  tenant: { name: string; code: string };
  student: { firstName: string; lastName: string; matricule: string };
  payment: {
    amount: number;
    method: string;
    valueDate: string;
    reference: string | null;
    payerName: string | null;
  };
  lines: { feeName: string; label: string; amount: number }[];
  credit: number;
  cancels?: string;
  reason?: string;
}

/** Détail d'un reçu (numéro, montant, lien de vérification, PDF). */
export function ReceiptModal({
  paymentId,
  kind,
  onClose,
  fetchReceipt,
  download,
}: {
  paymentId: string | null;
  kind?: 'PAYMENT' | 'CANCELLATION';
  onClose: () => void;
  fetchReceipt: (paymentId: string) => Promise<Receipt>;
  download: (paymentId: string, number: string) => Promise<void>;
}) {
  const q = useQuery({
    queryKey: ['receipt', paymentId, kind ?? 'PAYMENT'],
    queryFn: () => fetchReceipt(paymentId!),
    enabled: Boolean(paymentId),
  });
  const dl = useMutation({ mutationFn: () => download(paymentId!, q.data!.number) });
  if (!paymentId) return null;
  const r = q.data;
  const snap = (r?.snapshot ?? {}) as Partial<ReceiptSnapshot>;
  return (
    <Modal open title="Reçu" onClose={onClose}>
      {q.isPending && <p className="text-sm text-slate-500">Chargement…</p>}
      <ErrorAlert error={q.error} />
      {r && (
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="font-mono text-lg font-semibold">{r.number}</p>
            <p className="text-slate-600">
              {r.kind === 'CANCELLATION' ? "Reçu d'annulation" : 'Reçu de paiement'} ·{' '}
              {fmtDateTime(r.issuedAt)}
              {snap.tenant && <> · {snap.tenant.name}</>}
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtXof(r.amount)}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-600">
              {snap.student && (
                <>
                  <dt>Élève</dt>
                  <dd>
                    {snap.student.lastName} {snap.student.firstName} ({snap.student.matricule})
                  </dd>
                </>
              )}
              {snap.payment?.payerName && (
                <>
                  <dt>Payeur</dt>
                  <dd>{snap.payment.payerName}</dd>
                </>
              )}
              {snap.payment && (
                <>
                  <dt>Mode</dt>
                  <dd>
                    {PAYMENT_METHODS[snap.payment.method] ?? snap.payment.method}
                    {snap.payment.reference ? ` · ${snap.payment.reference}` : ''} ·{' '}
                    {fmtDate(snap.payment.valueDate)}
                  </dd>
                </>
              )}
              {snap.lines && snap.lines.length > 0 && (
                <>
                  <dt>Imputation</dt>
                  <dd>
                    {snap.lines.map((l, i) => (
                      <div key={i}>
                        {l.feeName} · {l.label} : {fmtXof(l.amount)}
                      </div>
                    ))}
                    {(snap.credit ?? 0) > 0 && <div>Crédit : {fmtXof(snap.credit ?? 0)}</div>}
                  </dd>
                </>
              )}
              {snap.cancels && (
                <>
                  <dt>Annule</dt>
                  <dd>
                    {snap.cancels}
                    {snap.reason ? ` — ${snap.reason}` : ''}
                  </dd>
                </>
              )}
            </dl>
          </div>
          <p className="break-all text-xs text-slate-500">
            Vérification :{' '}
            <a
              href={r.verifyUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-brand)] underline"
            >
              {r.verifyUrl}
            </a>
          </p>
          <ErrorAlert error={dl.error} />
          <div className="flex gap-2">
            <Button onClick={() => dl.mutate()} disabled={dl.isPending}>
              {dl.isPending ? 'Préparation…' : 'Télécharger le PDF'}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Carte « compte élève » complète, réutilisée par la fiche finance staff et l'espace parent. */
export function AccountCards({
  account,
  children,
}: {
  account: StudentAccount;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <AccountTotals totals={account.totals} />
      {account.totals.credit > 0 && (
        <Alert tone="info">
          Crédit disponible de {fmtXof(account.totals.credit)} : il sera imputé automatiquement sur
          les prochaines créances.
        </Alert>
      )}
      {children}
    </div>
  );
}
