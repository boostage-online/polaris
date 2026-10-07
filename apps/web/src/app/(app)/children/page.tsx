'use client';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Empty, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import { RELATIONSHIPS, STUDENT_STATUS } from '@/lib/format';
import { guardians } from '@/lib/resources';

/** Vue parent : ses enfants dans l'établissement courant, avec les droits attachés à chaque lien. */
export default function ChildrenPage() {
  const q = useQuery({ queryKey: ['me', 'children'], queryFn: guardians.myChildren });
  return (
    <>
      <PageHeader
        title="Mes enfants"
        subtitle="Les enfants rattachés à votre compte dans cet établissement."
      />
      {q.isPending && <Loading />}
      {q.isError && <ErrorAlert error={q.error} />}
      {q.data && q.data.length === 0 && (
        <Empty>
          Aucun enfant n&apos;est encore rattaché à votre compte. Rapprochez-vous de la scolarité.
        </Empty>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {q.data?.map((c) => (
          <Card key={c.linkId} title={`${c.student.firstName} ${c.student.lastName}`}>
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Matricule</dt>
              <dd className="font-mono">{c.student.matricule}</dd>
              <dt className="text-slate-500">Classe</dt>
              <dd>
                {c.currentGroup?.name ?? (
                  <span className="text-slate-400">Non inscrit cette année</span>
                )}
              </dd>
              <dt className="text-slate-500">Statut</dt>
              <dd>{STUDENT_STATUS[c.student.status] ?? c.student.status}</dd>
              <dt className="text-slate-500">Vous êtes</dt>
              <dd>{RELATIONSHIPS[c.relationship] ?? c.relationship}</dd>
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {c.rights.attendance && <Badge tone="blue">Assiduité</Badge>}
              {c.rights.justify && <Badge tone="blue">Justifier les absences</Badge>}
              {c.rights.finance && <Badge tone="green">Frais</Badge>}
              {c.rights.pay && <Badge tone="green">Payer</Badge>}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Assiduité et frais arrivent dans les prochaines versions de l&apos;espace parent.
            </p>
          </Card>
        ))}
      </div>
    </>
  );
}
