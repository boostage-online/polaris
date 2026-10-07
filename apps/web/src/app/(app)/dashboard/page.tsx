'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useCan, useMe } from '@/components/app-shell';
import {
  Alert,
  Badge,
  Card,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
  Stat,
  Table,
} from '@/components/ui';
import { fmtDateTime, fmtXof, todayIso, addDaysIso } from '@/lib/format';
import { SheetState } from '@/components/attendance';
import { attendance, billing, dashboards, sessions } from '@/lib/resources';

/** Tableau de bord selon le profil : scolarité, administrateur, enseignant, parent. */
export default function DashboardPage() {
  const me = useMe();
  const can = useCan();
  const isGuardian = me.membership?.kind === 'GUARDIAN';
  return (
    <>
      <PageHeader
        title={`Bonjour ${me.user.displayName ?? ''}`.trim()}
        subtitle={
          me.membership?.roles.map((r) => r.name).join(' · ') || (isGuardian ? 'Espace parent' : '')
        }
      />
      {isGuardian && (
        <Card title="Espace parent">
          <p className="text-sm text-slate-600">
            Retrouvez vos enfants, leurs classes et bientôt leur assiduité et leurs frais dans{' '}
            <Link className="text-[var(--color-brand)] underline" href="/children">
              Mes enfants
            </Link>
            .
          </p>
        </Card>
      )}
      <div className="space-y-6">
        {can('TAKE_ATTENDANCE', 'TAKE_ATTENDANCE_ANY') && <TeacherBlock />}
        {can('VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS') && <StudentLifeBlock />}
        {can('VIEW_FINANCIAL_REPORTS') && <FinanceBlock />}
        {can('VIEW_STUDENTS') && <RegistrarBlock />}
        {can('MANAGE_TENANT_SETTINGS') && <AdminBlock />}
        {me.membership?.kind === 'STAFF' && !can('TAKE_ATTENDANCE', 'TAKE_ATTENDANCE_ANY') && (
          <UpcomingBlock />
        )}
      </div>
    </>
  );
}

function TeacherBlock() {
  const me = useMe();
  const q = useQuery({
    queryKey: ['dashboards', 'teacher'],
    queryFn: attendance.teacherDashboard,
    refetchInterval: 60_000,
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const d = q.data;
  const next = d.today.find((s) => s.isNext);
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Mes appels
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Séances aujourd'hui" value={d.today.length} />
        <Stat
          label="Appels à faire"
          value={d.pendingSheets}
          tone={d.pendingSheets ? 'amber' : undefined}
        />
        <Stat
          label="Absences signalées"
          value={d.absencesToday}
          tone={d.absencesToday ? 'red' : undefined}
        />
        <Stat label="Retards signalés" value={d.lateToday} />
      </div>
      {next && (
        <Link
          href={`/attendance/sessions/${next.id}`}
          className="mt-3 block rounded-lg border-2 border-[var(--color-brand)] bg-white p-4 hover:bg-slate-50"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
            Prochain cours
          </p>
          <p className="text-lg font-semibold">
            {next.subjectName} — {next.groupName}
          </p>
          <p className="text-sm text-slate-600">{fmtDateTime(next.startsAt, me.tenantTimezone)}</p>
          <p className="mt-1 text-sm font-medium text-[var(--color-brand)]">
            {next.sheet?.status === 'DRAFT' ? "Reprendre l'appel →" : "Faire l'appel →"}
          </p>
        </Link>
      )}
      {d.today.length > 0 && (
        <Card className="mt-3">
          <Table
            head={
              <>
                <th>Heure</th>
                <th>Cours</th>
                <th>Groupe</th>
                <th>Appel</th>
                <th></th>
              </>
            }
          >
            {d.today.map((s) => (
              <tr key={s.id}>
                <td className="whitespace-nowrap">{fmtDateTime(s.startsAt, me.tenantTimezone)}</td>
                <td>{s.subjectName}</td>
                <td>{s.groupName}</td>
                <td>
                  <SheetState sheet={s.sheet} />
                </td>
                <td className="text-right">
                  <Link
                    href={`/attendance/sessions/${s.id}`}
                    className="text-[var(--color-brand)] underline"
                  >
                    {s.sheet && s.sheet.status !== 'DRAFT' ? 'Voir' : 'Appel'}
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </section>
  );
}

function StudentLifeBlock() {
  const q = useQuery({
    queryKey: ['dashboards', 'student-life'],
    queryFn: attendance.studentLifeDashboard,
    refetchInterval: 120_000,
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const d = q.data;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Vie scolaire — aujourd&apos;hui
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Séances" value={d.today.sessions} />
        <Stat
          label="Appels soumis"
          value={d.today.sheetsSubmitted}
          tone={d.today.sheetsSubmitted < d.today.sessions ? 'amber' : undefined}
        />
        <Stat label="Absents" value={d.today.absent} tone={d.today.absent ? 'red' : undefined} />
        <Stat label="Retards" value={d.today.late} />
        <Stat
          label="Non justifiées"
          value={d.today.unjustified}
          tone={d.today.unjustified ? 'amber' : undefined}
        />
        <Link href="/justifications">
          <Stat
            label="Justificatifs à traiter"
            value={d.justificationsPending}
            tone={d.justificationsPending ? 'amber' : undefined}
          />
        </Link>
        <Link href="/attendance/watchlist">
          <Stat
            label="Élèves à surveiller"
            value={d.watchlist}
            tone={d.watchlist ? 'red' : undefined}
          />
        </Link>
      </div>
      <p className="mt-2 text-sm">
        <Link href="/attendance/sheets" className="text-[var(--color-brand)] underline">
          {d.missingSheets} appel(s) manquant(s) sur 7 jours →
        </Link>
      </p>
    </section>
  );
}

function RegistrarBlock() {
  const q = useQuery({ queryKey: ['dashboards', 'registrar'], queryFn: dashboards.registrar });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const d = q.data;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Scolarité
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Élèves actifs" value={d.students.active} />
        <Stat label="Inscriptions cette année" value={d.enrollmentsThisYear} />
        <Stat
          label="Sans classe"
          value={d.students.withoutClass}
          tone={d.students.withoutClass ? 'amber' : undefined}
        />
        <Stat
          label="Sans tuteur"
          value={d.students.withoutGuardian}
          tone={d.students.withoutGuardian ? 'amber' : undefined}
        />
        <Stat
          label="Fiches incomplètes"
          value={d.students.incomplete}
          tone={d.students.incomplete ? 'amber' : undefined}
        />
        <Stat label="Tuteurs" value={d.guardians.total} />
        <Stat label="Parents activés" value={d.guardians.activated} />
        <Stat label="Élèves partis" value={d.students.left} />
      </div>
      {d.students.incomplete > 0 && (
        <p className="mt-3 text-sm">
          <Link href="/students?incomplete=true" className="text-[var(--color-brand)] underline">
            Voir les fiches incomplètes →
          </Link>
        </p>
      )}
      {d.recentImports.length > 0 && (
        <Card title="Imports récents" className="mt-4">
          <Table
            head={
              <>
                <th>Date</th>
                <th>Type</th>
                <th>Mode</th>
                <th>Lignes</th>
                <th>OK</th>
                <th>Erreurs</th>
              </>
            }
          >
            {d.recentImports.map((j) => (
              <tr key={j.id}>
                <td>{fmtDateTime(j.createdAt)}</td>
                <td>{j.kind === 'STUDENTS' ? 'Élèves' : 'Tuteurs'}</td>
                <td>
                  {j.dryRun ? <Badge>Simulation</Badge> : <Badge tone="green">Appliqué</Badge>}
                </td>
                <td>{j.rowsTotal}</td>
                <td>{j.rowsOk}</td>
                <td>{j.rowsError ? <Badge tone="red">{j.rowsError}</Badge> : 0}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </section>
  );
}

/** Bloc finance (direction, comptabilité) : recouvrement, caisse du jour, retards, échéances à 7 jours. */
function FinanceBlock() {
  const q = useQuery({ queryKey: ['dashboards', 'finance'], queryFn: billing.dashboard });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const d = q.data;
  return (
    <section>
      <h2 className="mb-3 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-500">
        Finance
        <Link
          href="/finance"
          className="text-xs font-normal normal-case text-[var(--color-brand)] underline"
        >
          Tableau de bord complet →
        </Link>
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat
          label="Recouvrement"
          value={d.year.recoveryRate === null ? '—' : `${d.year.recoveryRate} %`}
        />
        <Stat label="Caisse du jour" value={fmtXof(d.today.amount)} />
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
        <Stat label="Échéances à 7 jours" value={fmtXof(d.upcoming7d.amount)} />
      </div>
      {(d.integrity.mismatches > 0 || d.studentsWithoutFees > 0) && (
        <div className="mt-3 space-y-2">
          {d.integrity.mismatches > 0 && (
            <Alert tone="error">
              Contrôle d&apos;intégrité : {d.integrity.mismatches} écart(s) détecté(s).
            </Alert>
          )}
          {d.studentsWithoutFees > 0 && (
            <Alert tone="warning">
              {d.studentsWithoutFees} élève(s) actif(s) sans créance.{' '}
              <Link href="/finance/assign" className="underline">
                Affecter des frais →
              </Link>
            </Alert>
          )}
        </div>
      )}
    </section>
  );
}

function AdminBlock() {
  const q = useQuery({ queryKey: ['dashboards', 'admin'], queryFn: dashboards.admin });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const d = q.data;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Établissement
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Élèves" value={d.counts.students} />
        <Stat label="Enseignants" value={d.counts.teachers} />
        <Stat label="Personnel" value={d.counts.staff} />
        <Stat label="Groupes" value={d.counts.groups} />
        <Stat label="Cours" value={d.counts.courses} />
        <Stat label="Séances à 7 jours" value={d.counts.upcomingSessions7d} />
      </div>
      <Card title="Alertes de configuration" className="mt-4">
        {d.configurationIssues.length === 0 ? (
          <Alert tone="success">Aucune alerte : la configuration est cohérente.</Alert>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {d.configurationIssues.map((i) => (
              <li key={i.code} className="flex items-center justify-between">
                <span>{i.message}</span>
                <Badge tone="amber">{i.count}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function UpcomingBlock() {
  const me = useMe();
  const from = `${todayIso()}T00:00:00.000Z`;
  const to = `${addDaysIso(todayIso(), 7)}T00:00:00.000Z`;
  const q = useQuery({
    queryKey: ['me', 'schedule', from, to],
    queryFn: () => sessions.mine({ from, to, limit: 20 }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  return (
    <Card title="Mes prochaines séances (7 jours)">
      {q.data.data.length === 0 ? (
        <Empty>Aucune séance planifiée dans les 7 prochains jours.</Empty>
      ) : (
        <Table
          head={
            <>
              <th>Quand</th>
              <th>Cours</th>
              <th>Groupe</th>
              <th>Salle</th>
              <th>Statut</th>
            </>
          }
        >
          {q.data.data.map((s) => (
            <tr key={s.id}>
              <td>{fmtDateTime(s.startsAt, me.tenantTimezone)}</td>
              <td>{s.subjectName}</td>
              <td>{s.groupName}</td>
              <td>{s.room ?? '—'}</td>
              <td>
                {s.status === 'CANCELLED' ? (
                  <Badge tone="red">Annulée</Badge>
                ) : (
                  <Badge tone="blue">Prévue</Badge>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-3 text-sm">
        <Link href="/schedule" className="text-[var(--color-brand)] underline">
          Tout mon emploi du temps →
        </Link>
      </p>
    </Card>
  );
}
