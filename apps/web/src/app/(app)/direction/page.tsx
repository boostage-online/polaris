'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCan } from '@/components/app-shell';
import { Bar, Delta, pct, rateTone, RefreshedAt, TrendBars } from '@/components/reporting';
import {
  Badge,
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
import { fmtDate, fmtXof } from '@/lib/format';
import { reporting } from '@/lib/resources';

/** Tableau de bord de direction : KPI synthétiques, tendances, classes à surveiller. */
export default function DirectionPage() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dashboards', 'direction'],
    queryFn: reporting.direction,
    refetchInterval: 300_000,
  });
  const refresh = useMutation({
    mutationFn: () => reporting.refresh(false),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const d = q.data;
  const kFcfa = (v: number) => `${Math.round(v / 1000)} k`;
  return (
    <>
      <PageHeader
        title="Direction"
        subtitle={
          <>
            Du {fmtDate(d.period.from)} au {fmtDate(d.period.to)} ·{' '}
            <RefreshedAt at={d.refreshedAt} />
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              {refresh.isPending ? 'Rafraîchissement…' : 'Rafraîchir les agrégats'}
            </Button>
            <LinkButton href="/reports">Rapports</LinkButton>
          </>
        }
      />
      <ErrorAlert error={refresh.error} />

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Élèves actifs" value={d.students.active} />
        <Stat
          label="Taux de présence (30 j)"
          value={pct(d.attendance.rate30d)}
          tone={rateTone(d.attendance.rate30d) === 'red' ? 'red' : undefined}
        />
        <Stat label="Taux de recouvrement" value={pct(d.finance.recoveryRate)} />
        <Stat
          label="Parents activés"
          value={pct(d.parents.activationRate)}
          tone={(d.parents.activationRate ?? 100) < 50 ? 'amber' : undefined}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Assiduité"
          actions={
            can('VIEW_ATTENDANCE_REPORTS') && <LinkButton href="/pedagogy">Détail</LinkButton>
          }
        >
          <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase text-slate-500">7 jours</p>
              <p className="text-xl font-semibold">{pct(d.attendance.rate7d)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">30 jours</p>
              <p className="text-xl font-semibold">{pct(d.attendance.rate30d)}</p>
              <Delta current={d.attendance.rate30d} previous={d.attendance.ratePrev30d} />
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">À risque</p>
              <p className={`text-xl font-semibold ${d.attendance.atRisk ? 'text-red-700' : ''}`}>
                {d.attendance.atRisk}
              </p>
              <p className="text-xs text-slate-500">élève(s)</p>
            </div>
          </div>
          <ul className="mb-3 space-y-1 text-sm">
            <li className="flex justify-between">
              <span>Appels non réalisés (7 j)</span>
              <span className={d.attendance.missingSheets7d ? 'font-medium text-amber-700' : ''}>
                {d.attendance.missingSheets7d}
              </span>
            </li>
            <li className="flex justify-between">
              <span>Absences non justifiées (30 j)</span>
              <span>{d.attendance.unjustified30d}</span>
            </li>
          </ul>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Taux de présence par semaine
          </p>
          <TrendBars points={d.trends.attendanceWeekly} format={(v) => `${v} %`} />
        </Card>

        <Card
          title="Finance"
          actions={can('VIEW_FINANCIAL_REPORTS') && <LinkButton href="/finance">Détail</LinkButton>}
        >
          <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase text-slate-500">Encaissé ce mois</p>
              <p className="text-xl font-semibold tabular-nums">
                {fmtXof(d.finance.paidThisMonth)}
              </p>
              <Delta
                current={d.finance.paidThisMonth}
                previous={d.finance.paidPrevMonth}
                unit="FCFA"
              />
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Reste à recouvrer</p>
              <p className="text-xl font-semibold tabular-nums">{fmtXof(d.finance.outstanding)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">En retard</p>
              <p
                className={`text-xl font-semibold tabular-nums ${d.finance.overdue ? 'text-red-700' : ''}`}
              >
                {fmtXof(d.finance.overdue)}
              </p>
            </div>
          </div>
          <ul className="mb-3 space-y-1 text-sm">
            <li className="flex justify-between">
              <span>Facturé / encaissé (année)</span>
              <span className="tabular-nums">
                {fmtXof(d.finance.invoiced)} / {fmtXof(d.finance.paid)}
              </span>
            </li>
            <li className="flex justify-between">
              <span>Part des paiements en ligne (30 j)</span>
              <span>{pct(d.finance.onlineShare30d)}</span>
            </li>
            <li className="flex justify-between">
              <span>Paiements à vérifier</span>
              <span className={d.finance.pendingReviews ? 'font-medium text-red-700' : ''}>
                {d.finance.pendingReviews}
              </span>
            </li>
          </ul>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Encaissements par semaine (k FCFA)
          </p>
          <TrendBars points={d.trends.collectionsWeekly} format={kFcfa} tone="green" />
        </Card>

        <Card title="Classes à surveiller (30 jours)">
          {d.groupsAtRisk.length === 0 ? (
            <Empty>Aucune classe sous le seuil d&apos;alerte.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Classe</th>
                  <th className="w-1/3">Taux de présence</th>
                  <th className="text-right">Non justifiées</th>
                </>
              }
            >
              {d.groupsAtRisk.map((g) => (
                <tr key={g.groupId}>
                  <td>
                    <Link href={`/pedagogy#g-${g.groupId}`} className="underline">
                      {g.groupName}
                    </Link>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Bar value={g.rate30d} tone={rateTone(g.rate30d)} />
                      <Badge tone={rateTone(g.rate30d)}>{pct(g.rate30d)}</Badge>
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{g.unjustified30d}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Parents et notifications">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span>Tuteurs enregistrés</span>
              <span>{d.parents.total}</span>
            </li>
            <li className="flex justify-between">
              <span>Comptes activés</span>
              <span>
                {d.parents.activated} ({pct(d.parents.activationRate)})
              </span>
            </li>
            <li>
              <Bar
                value={d.parents.activationRate}
                tone="blue"
                label={`Activation ${pct(d.parents.activationRate)}`}
              />
            </li>
            <li className="flex justify-between">
              <span>SMS envoyés ce mois</span>
              <span>
                {d.notifications.smsThisMonth}
                {d.notifications.smsCap > 0 && (
                  <span className="text-slate-400"> / {d.notifications.smsCap}</span>
                )}
              </span>
            </li>
            {d.notifications.smsCap > 0 && (
              <li>
                <Bar
                  value={d.notifications.smsThisMonth}
                  max={d.notifications.smsCap}
                  tone={
                    d.notifications.smsThisMonth >= d.notifications.smsCap * 0.9 ? 'red' : 'brand'
                  }
                />
              </li>
            )}
            <li className="flex justify-between">
              <span>Notifications in-app non lues</span>
              <span>{d.notifications.inAppUnread}</span>
            </li>
            <li className="flex justify-between">
              <span>Nouveaux élèves (30 j)</span>
              <span>{d.students.newLast30d}</span>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
