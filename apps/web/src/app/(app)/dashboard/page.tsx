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
import { fmtDateTime, todayIso, addDaysIso } from '@/lib/format';
import { dashboards, sessions } from '@/lib/resources';

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
        {can('VIEW_STUDENTS') && <RegistrarBlock />}
        {can('MANAGE_TENANT_SETTINGS') && <AdminBlock />}
        {me.membership?.kind === 'STAFF' && <UpcomingBlock />}
      </div>
    </>
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
