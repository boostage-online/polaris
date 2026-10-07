'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMe } from '@/components/app-shell';
import { StatusBadge } from '@/components/attendance';
import { Badge, Button, Card, Empty, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import { fmtTime } from '@/lib/format';
import { guardians, parent } from '@/lib/resources';

/** Vue parent : ses enfants, l'assiduité du jour, les 30 derniers jours et les alertes, en un appel. */
export default function ChildrenPage() {
  const me = useMe();
  const kids = useQuery({ queryKey: ['me', 'children'], queryFn: guardians.myChildren });
  const summary = useQuery({
    queryKey: ['parent', 'summary'],
    queryFn: parent.summary,
    refetchInterval: 120_000,
  });
  return (
    <>
      <PageHeader
        title="Mes enfants"
        subtitle="Assiduité du jour, tendance sur 30 jours, alertes et justificatifs."
      />
      {kids.isPending && <Loading />}
      {kids.isError && <ErrorAlert error={kids.error} />}
      {kids.data && kids.data.length === 0 && (
        <Empty>
          Aucun enfant n&apos;est encore rattaché à votre compte. Rapprochez-vous de la scolarité.
        </Empty>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {kids.data?.map((c) => {
          const s = summary.data?.find((x) => x.student.id === c.student.id);
          return (
            <Card
              key={c.linkId}
              title={`${c.student.firstName} ${c.student.lastName}`}
              actions={
                c.rights.attendance && (
                  <Link href={`/children/${c.student.id}`}>
                    <Button size="sm" variant="secondary">
                      Historique
                    </Button>
                  </Link>
                )
              }
            >
              <p className="text-sm text-slate-600">
                {c.currentGroup?.name ?? 'Non inscrit cette année'} ·{' '}
                <span className="font-mono text-xs">{c.student.matricule}</span>
              </p>
              {!c.rights.attendance && (
                <p className="mt-2 text-sm text-slate-500">
                  Vous n&apos;avez pas la vue assiduité sur cet enfant.
                </p>
              )}
              {s && (
                <>
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Aujourd&apos;hui
                    </p>
                    {s.today.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        Aucun appel enregistré pour l&apos;instant.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-1 text-sm">
                        {s.today.map((t) => (
                          <li key={t.recordId} className="flex items-center justify-between">
                            <span>
                              {fmtTime(t.startsAt, me.tenantTimezone)} {t.subjectName}
                            </span>
                            <StatusBadge
                              status={t.status}
                              excuse={t.excuseStatus}
                              lateMinutes={t.lateMinutes}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
                    <Badge tone="green">
                      Présence 30 j :{' '}
                      {s.last30Days.presenceRate === null ? '—' : `${s.last30Days.presenceRate} %`}
                    </Badge>
                    {s.last30Days.absent > 0 && (
                      <Badge tone="red">{s.last30Days.absent} absence(s)</Badge>
                    )}
                    {s.last30Days.late > 0 && (
                      <Badge tone="amber">{s.last30Days.late} retard(s)</Badge>
                    )}
                    {s.alerts > 0 && <Badge tone="red">Alerte absences répétées</Badge>}
                    {s.pendingJustifications > 0 && (
                      <Badge tone="blue">
                        {s.pendingJustifications} justificatif(s) en attente
                      </Badge>
                    )}
                  </div>
                  {s.last30Days.unjustified > 0 && s.canJustify && (
                    <p className="mt-2 text-sm">
                      <Link
                        href={`/children/${c.student.id}`}
                        className="text-[var(--color-brand)] underline"
                      >
                        Déposer un justificatif →
                      </Link>
                    </p>
                  )}
                </>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
