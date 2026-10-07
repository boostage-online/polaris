'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FeesTable, PaymentsTable, ReceiptModal } from '@/components/billing';
import { Alert, Badge, Card, ErrorAlert, Loading, Stat } from '@/components/ui';
import { fmtDate, fmtXof } from '@/lib/format';
import { parentFinance } from '@/lib/resources';
import { ApiError } from '@/lib/api';

/** Espace parent : frais d'un enfant (solde, prochaine échéance, échéancier, paiements et reçus). */
export function ChildFinanceSection({ studentId }: { studentId: string }) {
  const q = useQuery({
    queryKey: ['parent', 'finance', studentId],
    queryFn: () => parentFinance.account(studentId),
    retry: false,
  });
  const summary = useQuery({ queryKey: ['parent', 'finance'], queryFn: parentFinance.children });
  const [receipt, setReceipt] = useState<string | null>(null);
  if (q.isPending) return <Loading />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 403) return null;
    return <ErrorAlert error={q.error} />;
  }
  const a = q.data;
  const s = summary.data?.find((c) => c.student.id === studentId);
  const next = s?.nextInstallment ?? null;
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Frais de scolarité</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total de l'année" value={fmtXof(a.totals.due)} />
        <Stat label="Déjà payé" value={fmtXof(a.totals.paid)} />
        <Stat
          label="Reste à payer"
          value={fmtXof(a.totals.balance)}
          tone={a.totals.balance > 0 ? 'amber' : undefined}
        />
        <Stat
          label="En retard"
          value={fmtXof(a.totals.overdue)}
          tone={a.totals.overdue > 0 ? 'red' : undefined}
        />
      </div>
      {next && (
        <Alert
          tone={next.status === 'OVERDUE' ? 'error' : next.status === 'DUE' ? 'warning' : 'info'}
        >
          {next.status === 'OVERDUE' ? 'Échéance en retard' : 'Prochaine échéance'} : {next.feeName}{' '}
          · {next.label} — <strong>{fmtXof(Math.max(0, next.balance))}</strong> pour le{' '}
          {fmtDate(next.dueDate)}.
          {s?.canPay && (
            <span className="block text-xs">
              Le paiement en ligne (Mobile Money, carte) arrive dans la prochaine version ; réglez à
              la caisse de l&apos;établissement en attendant.
            </span>
          )}
        </Alert>
      )}
      {a.totals.credit > 0 && (
        <Alert tone="info">
          Vous disposez d&apos;un crédit de {fmtXof(a.totals.credit)} qui sera déduit des prochaines
          échéances.
        </Alert>
      )}
      <Card title="Échéancier">
        <FeesTable fees={a.fees} />
      </Card>
      <Card title="Paiements et reçus">
        <PaymentsTable payments={a.payments} onReceipt={(p) => setReceipt(p.id)} />
      </Card>
      <ReceiptModal
        paymentId={receipt}
        onClose={() => setReceipt(null)}
        fetchReceipt={(pid) => parentFinance.receipt(studentId, pid)}
        download={(pid, number) => parentFinance.downloadReceipt(studentId, pid, number)}
      />
    </section>
  );
}

/** Pastilles « frais » sur la carte d'un enfant (liste des enfants). */
export function ChildFinanceBadges({ studentId }: { studentId: string }) {
  const summary = useQuery({ queryKey: ['parent', 'finance'], queryFn: parentFinance.children });
  const s = summary.data?.find((c) => c.student.id === studentId);
  if (!s) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-sm">
      {s.totals.balance <= 0 ? (
        <Badge tone="green">Frais à jour</Badge>
      ) : (
        <Badge tone={s.totals.overdue > 0 ? 'red' : 'amber'}>
          {s.totals.overdue > 0 ? 'Retard de paiement' : 'Reste à payer'} :{' '}
          {fmtXof(s.totals.balance)}
        </Badge>
      )}
      {s.nextInstallment && s.totals.balance > 0 && (
        <Badge>Prochaine échéance {fmtDate(s.nextInstallment.dueDate)}</Badge>
      )}
    </div>
  );
}
