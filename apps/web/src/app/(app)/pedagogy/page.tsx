'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, pct, PeriodFilter, PRESETS, rateTone, RefreshedAt } from '@/components/reporting';
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
import { reporting } from '@/lib/resources';

/** Tableau de bord pédagogique : taux par classe, élèves à risque, appels non réalisés, retards. */
export default function PedagogyPage() {
  const [period, setPeriod] = useState(() => {
    const p = PRESETS()[1]!;
    return { from: p.from, to: p.to };
  });
  const q = useQuery({
    queryKey: ['dashboards', 'pedagogy', period],
    queryFn: () => reporting.pedagogy(period),
    placeholderData: (prev) => prev,
  });
  const d = q.data;
  const totals = d
    ? d.byGroup.reduce(
        (t, g) => ({
          held: t.held + g.sessionsHeld,
          missing: t.missing + g.sheetsMissing,
          unjustified: t.unjustified + g.unjustified,
          records: t.records + g.records,
          present: t.present + (g.presenceRate === null ? 0 : (g.records * g.presenceRate) / 100),
        }),
        { held: 0, missing: 0, unjustified: 0, records: 0, present: 0 },
      )
    : null;
  const globalRate =
    totals && totals.records > 0 ? Math.round((totals.present / totals.records) * 100) : null;
  return (
    <>
      <PageHeader
        title="Pédagogie"
        subtitle={d ? <RefreshedAt at={d.refreshedAt} /> : undefined}
        actions={
          <>
            <LinkButton href="/attendance/watchlist">Élèves à surveiller</LinkButton>
            <LinkButton href="/reports">Rapports</LinkButton>
          </>
        }
      />
      <PeriodFilter value={period} onChange={setPeriod} />
      {q.isPending && <Loading />}
      <ErrorAlert error={q.error} />
      {d && totals && (
        <>
          <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Taux de présence" value={pct(globalRate)} />
            <Stat label="Séances tenues" value={totals.held} />
            <Stat
              label="Appels non réalisés"
              value={totals.missing}
              tone={totals.missing ? 'amber' : undefined}
            />
            <Stat
              label="Élèves à risque"
              value={d.studentsAtRisk.length}
              tone={d.studentsAtRisk.length ? 'red' : undefined}
            />
          </section>

          <div className="space-y-4">
            <Card title="Taux de présence par classe">
              {d.byGroup.length === 0 ? (
                <Empty>Aucune séance tenue sur la période.</Empty>
              ) : (
                <Table
                  head={
                    <>
                      <th>Classe</th>
                      <th>Niveau</th>
                      <th className="w-1/4">Présence</th>
                      <th className="text-right">Séances</th>
                      <th className="text-right">Absents</th>
                      <th className="text-right">Retards</th>
                      <th className="text-right">Non justifiées</th>
                      <th className="text-right">Appels manquants</th>
                    </>
                  }
                >
                  {d.byGroup.map((g) => (
                    <tr key={g.groupId} id={`g-${g.groupId}`} className="target:bg-amber-50">
                      <td className="font-medium">{g.groupName}</td>
                      <td className="text-slate-500">{g.levelName ?? '—'}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Bar value={g.presenceRate} tone={rateTone(g.presenceRate)} />
                          <Badge tone={rateTone(g.presenceRate)}>{pct(g.presenceRate)}</Badge>
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{g.sessionsHeld}</td>
                      <td className="text-right tabular-nums">{g.absent}</td>
                      <td className="text-right tabular-nums">{g.late}</td>
                      <td className="text-right tabular-nums">{g.unjustified}</td>
                      <td
                        className={`text-right tabular-nums ${g.sheetsMissing ? 'font-medium text-amber-700' : ''}`}
                      >
                        {g.sheetsMissing}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>

            <Card
              title="Élèves à risque"
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void reporting.downloadCsv('students-at-risk', period)}
                >
                  CSV
                </Button>
              }
            >
              {d.studentsAtRisk.length === 0 ? (
                <Empty>Aucun élève sous le seuil sur la période.</Empty>
              ) : (
                <Table
                  head={
                    <>
                      <th>Élève</th>
                      <th>Classe</th>
                      <th className="text-right">Séances</th>
                      <th className="text-right">Absences</th>
                      <th className="text-right">Non justifiées</th>
                      <th className="text-right">Retards</th>
                      <th>Présence</th>
                      <th>Alerte</th>
                    </>
                  }
                >
                  {d.studentsAtRisk.map((s) => (
                    <tr key={s.studentId}>
                      <td>
                        <Link href={`/students/${s.studentId}`} className="underline">
                          {s.lastName} {s.firstName}
                        </Link>
                        <span className="ml-1 text-xs text-slate-400">{s.matricule}</span>
                      </td>
                      <td>{s.groupName ?? '—'}</td>
                      <td className="text-right tabular-nums">{s.sessions}</td>
                      <td className="text-right tabular-nums">{s.absent}</td>
                      <td className="text-right tabular-nums">{s.unjustified}</td>
                      <td className="text-right tabular-nums">{s.late}</td>
                      <td>
                        <Badge tone={rateTone(s.presenceRate)}>{pct(s.presenceRate)}</Badge>
                      </td>
                      <td>{s.openAlert ? <Badge tone="red">Ouverte</Badge> : '—'}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card
                title="Appels non réalisés par enseignant"
                actions={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void reporting.downloadCsv('missing-sheets', period)}
                  >
                    CSV
                  </Button>
                }
              >
                {d.missingSheetsByTeacher.length === 0 ? (
                  <Empty>Tous les appels de la période ont été réalisés.</Empty>
                ) : (
                  <Table
                    head={
                      <>
                        <th>Enseignant</th>
                        <th className="text-right">Manquants</th>
                        <th className="text-right">Séances</th>
                        <th className="w-1/3">Part</th>
                      </>
                    }
                  >
                    {d.missingSheetsByTeacher.map((t, i) => (
                      <tr key={t.staffProfileId ?? `none-${i}`}>
                        <td>{t.teacherName}</td>
                        <td className="text-right font-medium tabular-nums text-amber-700">
                          {t.missing}
                        </td>
                        <td className="text-right tabular-nums">{t.sessions}</td>
                        <td>
                          <Bar
                            value={t.sessions ? Math.round((t.missing / t.sessions) * 100) : 0}
                            tone="amber"
                          />
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>

              <Card title="Répartition des retards">
                {d.lateDistribution.every((b) => b.count === 0) ? (
                  <Empty>Aucun retard enregistré sur la période.</Empty>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {d.lateDistribution.map((b) => {
                      const max = Math.max(1, ...d.lateDistribution.map((x) => x.count));
                      return (
                        <li key={b.bucket}>
                          <div className="mb-0.5 flex justify-between">
                            <span>{b.bucket}</span>
                            <span className="tabular-nums">{b.count}</span>
                          </div>
                          <Bar value={b.count} max={max} tone="blue" />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
