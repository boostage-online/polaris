'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCan } from '@/components/app-shell';
import { Money } from '@/components/billing';
import {
  Alert,
  Button,
  Card,
  Empty,
  ErrorAlert,
  LinkButton,
  Loading,
  PageHeader,
  Stat,
  Table,
} from '@/components/ui';
import { fmtDateTime, fmtXof, PAYMENT_METHODS } from '@/lib/format';
import { billing } from '@/lib/resources';

/** Tableau de bord finance : année, caisse du jour, mois, 7 prochains jours, par classe, intégrité. */
export default function FinanceDashboardPage() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dashboards', 'finance'],
    queryFn: billing.dashboard,
    refetchInterval: 120_000,
  });
  const check = useMutation({
    mutationFn: billing.integrityCheck,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards', 'finance'] }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const d = q.data;
  return (
    <>
      <PageHeader
        title="Finance"
        subtitle="Recouvrement de l'année, caisse du jour et échéances à venir."
        actions={
          <>
            {can('VIEW_PAYMENTS') && (
              <LinkButton href="/finance/cash">Journal de caisse</LinkButton>
            )}
            {can('VIEW_FEES') && <LinkButton href="/finance/unpaid">Impayés</LinkButton>}
            {can('ASSIGN_FEES') && (
              <LinkButton href="/finance/assign" variant="primary">
                Affecter des frais
              </LinkButton>
            )}
          </>
        }
      />

      {d.integrity.mismatches > 0 && (
        <div className="mb-4">
          <Alert tone="error">
            Le contrôle d&apos;intégrité du {fmtDateTime(d.integrity.checkedAt!)} a relevé{' '}
            {d.integrity.mismatches} écart(s) entre les montants stockés et les écritures. Contactez
            le support avant toute clôture.
          </Alert>
        </div>
      )}
      {d.studentsWithoutFees > 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            {d.studentsWithoutFees} élève(s) actif(s) sans aucune créance cette année.{' '}
            {can('ASSIGN_FEES') && (
              <Link href="/finance/assign" className="underline">
                Affecter une grille →
              </Link>
            )}
          </Alert>
        </div>
      )}

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Facturé (année)" value={fmtXof(d.year.invoiced)} />
        <Stat label="Encaissé" value={fmtXof(d.year.paid)} />
        <Stat
          label="Reste à recouvrer"
          value={fmtXof(d.year.outstanding)}
          tone={d.year.outstanding > 0 ? 'amber' : undefined}
        />
        <Stat
          label="En retard"
          value={fmtXof(d.year.overdue)}
          tone={d.year.overdue > 0 ? 'red' : undefined}
        />
        <Stat
          label="Taux de recouvrement"
          value={d.year.recoveryRate === null ? '—' : `${d.year.recoveryRate} %`}
        />
        <Stat label="Crédits ouverts" value={fmtXof(d.year.credits)} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Caisse du jour">
          <p className="text-2xl font-semibold tabular-nums">{fmtXof(d.today.amount)}</p>
          <p className="text-sm text-slate-500">{d.today.count} encaissement(s)</p>
          {d.today.byMethod.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {d.today.byMethod.map((m) => (
                <li key={m.method} className="flex justify-between">
                  <span>{PAYMENT_METHODS[m.method] ?? m.method}</span>
                  <span className="tabular-nums">
                    {fmtXof(m.amount)} <span className="text-slate-400">({m.count})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d.today.byCashier.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Par caissier
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {d.today.byCashier.map((c) => (
                  <li key={c.userId ?? 'x'} className="flex justify-between">
                    <span>{c.name ?? '—'}</span>
                    <span className="tabular-nums">{fmtXof(c.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title="Ce mois">
          <p className="text-2xl font-semibold tabular-nums">{fmtXof(d.month.amount)}</p>
          <p className="text-sm text-slate-500">{d.month.count} encaissement(s)</p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            7 prochains jours
          </p>
          <p className="text-lg font-semibold tabular-nums">{fmtXof(d.upcoming7d.amount)}</p>
          <p className="text-sm text-slate-500">{d.upcoming7d.installments} échéance(s) à venir</p>
        </Card>
        <Card
          title="Intégrité du grand-livre"
          actions={
            can('VIEW_FINANCIAL_REPORTS') && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => check.mutate()}
                disabled={check.isPending}
              >
                Vérifier maintenant
              </Button>
            )
          }
        >
          {d.integrity.checkedAt ? (
            <>
              <p
                className={`text-2xl font-semibold ${d.integrity.mismatches ? 'text-red-700' : 'text-emerald-700'}`}
              >
                {d.integrity.mismatches === 0 ? 'Cohérent' : `${d.integrity.mismatches} écart(s)`}
              </p>
              <p className="text-sm text-slate-500">
                Dernier contrôle : {fmtDateTime(d.integrity.checkedAt)}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Aucun contrôle encore exécuté (quotidien à 6 h).
            </p>
          )}
          <ErrorAlert error={check.error} />
          <p className="mt-3 text-xs text-slate-500">
            Compare les soldes stockés aux écritures (paiements, imputations, ajustements, crédits).
          </p>
        </Card>
      </div>

      <Card title="Recouvrement par classe" className="mt-4">
        {d.byGroup.length === 0 ? (
          <Empty>Aucune créance cette année.</Empty>
        ) : (
          <Table
            head={
              <>
                <th>Classe</th>
                <th className="text-right">Élèves</th>
                <th className="text-right">Dû</th>
                <th className="text-right">Payé</th>
                <th className="text-right">Solde</th>
                <th className="text-right">En retard</th>
                <th className="text-right">Taux</th>
              </>
            }
          >
            {d.byGroup.map((g) => (
              <tr key={g.groupId}>
                <td>
                  <Link
                    href={`/finance/unpaid?groupId=${g.groupId}`}
                    className="font-medium text-[var(--color-brand)] hover:underline"
                  >
                    {g.groupName}
                  </Link>
                </td>
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
                  {g.recoveryRate === null ? '—' : `${g.recoveryRate} %`}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
