'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useCan } from '@/components/app-shell';
import { Bar } from '@/components/reporting';
import { onboarding } from '@/lib/resources';

/** Encart du tableau de bord : progression de l'assistant tant que l'établissement n'est pas prêt (masquable). */
export function OnboardingBanner() {
  const can = useCan();
  const q = useQuery({
    queryKey: ['onboarding'],
    queryFn: onboarding.status,
    enabled: can(
      'MANAGE_TENANT_SETTINGS',
      'MANAGE_ACADEMIC_STRUCTURE',
      'MANAGE_USERS',
      'IMPORT_STUDENTS',
    ),
  });
  const d = q.data;
  if (!d || d.ready || d.dismissedAt) return null;
  const next = d.steps.find((s) => !s.done && !s.optional) ?? d.steps.find((s) => !s.done);
  return (
    <section className="rounded-lg border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            Démarrage de l&apos;établissement : {d.completed}/{d.total} étapes
          </p>
          {next && (
            <p className="text-sm text-slate-600">
              Prochaine étape : <strong>{next.title}</strong> — {next.description}
            </p>
          )}
        </div>
        <Link
          href="/onboarding"
          className="inline-flex items-center rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white"
        >
          Ouvrir l&apos;assistant
        </Link>
      </div>
      <div className="mt-3">
        <Bar value={d.completed} max={d.total} label={`${d.completed}/${d.total}`} />
      </div>
    </section>
  );
}
