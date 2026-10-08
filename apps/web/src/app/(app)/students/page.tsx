'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useCan } from '@/components/app-shell';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorAlert,
  Field,
  Input,
  LinkButton,
  Loading,
  PageHeader,
  Select,
  Table,
} from '@/components/ui';
import { fmtDate, STUDENT_STATUS } from '@/lib/format';
import { groups, students, type StudentsQuery } from '@/lib/resources';

/** Liste des élèves : recherche nom/matricule, classe, statut, fiches incomplètes ; pagination par curseur. */
export default function StudentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StudentsList />
    </Suspense>
  );
}

function StudentsList() {
  const can = useCan();
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [groupId, setGroupId] = useState(sp.get('groupId') ?? '');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [incomplete, setIncomplete] = useState(sp.get('incomplete') === 'true');
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);

  const query: StudentsQuery = {
    q: q || undefined,
    groupId: groupId || undefined,
    status: (status || undefined) as StudentsQuery['status'],
    incomplete: incomplete || undefined,
    limit: 50,
    cursor,
  };
  const list = useQuery({ queryKey: ['students', query], queryFn: () => students.list(query) });
  const classes = useQuery({ queryKey: ['groups', 'CLASS'], queryFn: () => groups.list({}) });

  const reset = () => setCursors([]);

  return (
    <>
      <PageHeader
        title="Élèves"
        subtitle="Recherchez par nom ou matricule, filtrez par classe ou statut."
        actions={
          can('CREATE_STUDENT') && (
            <LinkButton href="/students/new" variant="primary">
              Nouvel élève
            </LinkButton>
          )
        }
      />
      <Card className="mb-4">
        <form
          className="grid gap-3 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            reset();
            router.replace(
              `/students?${new URLSearchParams({ q, groupId, status, incomplete: String(incomplete) })}`,
            );
          }}
        >
          <Field label="Recherche" className="md:col-span-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom, prénom ou matricule"
            />
          </Field>
          <Field label="Classe">
            <Select
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                reset();
              }}
            >
              <option value="">Toutes</option>
              {classes.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statut">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                reset();
              }}
            >
              <option value="">Tous</option>
              {Object.entries(STUDENT_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={incomplete}
                onChange={(e) => {
                  setIncomplete(e.target.checked);
                  reset();
                }}
              />
              Fiches incomplètes
            </label>
            <Button type="submit" variant="secondary">
              Rechercher
            </Button>
          </div>
        </form>
      </Card>

      {list.isPending && <Loading />}
      {list.isError && <ErrorAlert error={list.error} />}
      {list.data && (
        <Card>
          {list.data.data.length === 0 ? (
            <Empty>Aucun élève ne correspond.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Matricule</th>
                  <th>Nom</th>
                  <th>Prénom</th>
                  <th>Naissance</th>
                  <th>Classe</th>
                  <th>Tuteurs</th>
                  <th>Statut</th>
                </>
              }
            >
              {list.data.data.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="font-mono text-xs">{s.matricule}</td>
                  <td>
                    <Link
                      href={`/students/${s.id}`}
                      className="font-medium text-[var(--color-brand)] hover:underline"
                    >
                      {s.lastName}
                    </Link>
                  </td>
                  <td>{s.firstName}</td>
                  <td>{fmtDate(s.birthDate)}</td>
                  <td>{s.currentGroup?.name ?? <Badge tone="amber">Sans classe</Badge>}</td>
                  <td>
                    {s.guardianCount === 0 ? <Badge tone="amber">Aucun</Badge> : s.guardianCount}
                  </td>
                  <td>
                    <Badge tone={s.status === 'ACTIVE' ? 'green' : 'slate'}>
                      {STUDENT_STATUS[s.status] ?? s.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <div className="mt-3 flex justify-between text-sm">
            <Button
              variant="ghost"
              size="sm"
              disabled={cursors.length === 0}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              ← Précédent
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!list.data.meta.nextCursor}
              onClick={() => {
                const next = list.data.meta.nextCursor;
                if (next) setCursors((c) => [...c, next]);
              }}
            >
              Suivant →
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
