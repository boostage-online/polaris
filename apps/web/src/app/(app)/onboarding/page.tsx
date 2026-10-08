'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCan } from '@/components/app-shell';
import { Bar } from '@/components/reporting';
import { Alert, Badge, Button, Card, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import { onboarding } from '@/lib/resources';

/**
 * Assistant de démarrage : l'état est calculé depuis les données (rien à cocher à la main) ; chaque étape
 * renvoie vers l'écran qui permet de la réaliser. Objectif G7 : un établissement onboardé en moins de 2 h.
 */
export default function OnboardingPage() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['onboarding'],
    queryFn: onboarding.status,
    refetchInterval: 30_000,
  });
  const dismiss = useMutation({
    mutationFn: onboarding.dismiss,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding'] }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const d = q.data;
  const required = d.steps.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.done).length;
  return (
    <>
      <PageHeader
        title="Assistant de démarrage"
        subtitle={`${d.completed} étape(s) sur ${d.total} réalisées · ${requiredDone}/${d.required} obligatoires`}
        actions={
          can('MANAGE_TENANT_SETTINGS') && (
            <Button
              variant="secondary"
              size="sm"
              disabled={dismiss.isPending}
              onClick={() => dismiss.mutate(!d.dismissedAt)}
            >
              {d.dismissedAt ? 'Réafficher sur le tableau de bord' : 'Masquer du tableau de bord'}
            </Button>
          )
        }
      />
      <div className="mb-4">
        <Bar
          value={d.completed}
          max={d.total}
          tone={d.ready ? 'green' : 'brand'}
          label={`${d.completed}/${d.total}`}
        />
      </div>
      {d.ready ? (
        <div className="mb-4">
          <Alert tone="success">
            Les étapes obligatoires sont faites : l&apos;établissement est prêt. Les étapes
            optionnelles améliorent l&apos;expérience (paiement en ligne, règles d&apos;assiduité,
            frais).
          </Alert>
        </div>
      ) : (
        <div className="mb-4">
          <Alert tone="info">
            Suivez les étapes dans l&apos;ordre : chaque bouton ouvre l&apos;écran correspondant. Le
            guide complet (import CSV, invitations, premier appel) est dans le manuel
            d&apos;onboarding remis par le support.
          </Alert>
        </div>
      )}
      <ErrorAlert error={dismiss.error} />
      <ol className="space-y-2">
        {d.steps.map((s, i) => (
          <li key={s.key}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      s.done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                    aria-hidden
                  >
                    {s.done ? '✓' : i + 1}
                  </span>
                  <div>
                    <p className="font-medium">
                      {s.title}{' '}
                      {s.optional ? (
                        <Badge>optionnel</Badge>
                      ) : (
                        !s.done && <Badge tone="amber">à faire</Badge>
                      )}
                    </p>
                    <p className="text-sm text-slate-600">{s.description}</p>
                    {s.detail && <p className="mt-0.5 text-xs text-slate-500">{s.detail}</p>}
                  </div>
                </div>
                {can(s.permission) ? (
                  <Link
                    href={s.href}
                    className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium ${
                      s.done
                        ? 'border border-slate-300 bg-white text-slate-700'
                        : 'bg-[var(--color-brand)] text-white'
                    }`}
                  >
                    {s.done ? 'Voir' : 'Faire'}
                  </Link>
                ) : (
                  <span className="text-xs text-slate-400">réservé à un autre rôle</span>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
