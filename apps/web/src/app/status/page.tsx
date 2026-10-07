'use client';
import { useQuery } from '@tanstack/react-query';
import type { PublicStatus } from '@polaris/contracts';
import { apiPublic } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

const STATUS: Record<PublicStatus['status'], { label: string; tone: string; dot: string }> = {
  OPERATIONAL: {
    label: 'Tous les services fonctionnent',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    dot: 'bg-emerald-500',
  },
  DEGRADED: {
    label: 'Fonctionnement dégradé',
    tone: 'border-amber-200 bg-amber-50 text-amber-900',
    dot: 'bg-amber-500',
  },
  OUTAGE: {
    label: 'Incident en cours',
    tone: 'border-red-200 bg-red-50 text-red-900',
    dot: 'bg-red-500',
  },
  UNKNOWN: {
    label: 'État inconnu',
    tone: 'border-slate-200 bg-slate-50 text-slate-800',
    dot: 'bg-slate-400',
  },
};

/** Page publique d'état du service : disponibilité mesurée sur 30 jours, sans aucune donnée d'établissement. */
export default function StatusPage() {
  const q = useQuery({
    queryKey: ['public-status'],
    queryFn: () => apiPublic<PublicStatus>('/status'),
    refetchInterval: 60_000,
    retry: false,
  });
  const s = q.data;
  const st = STATUS[s?.status ?? 'UNKNOWN'];
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-10">
      <p className="mb-1 text-lg font-semibold" style={{ color: 'var(--color-brand)' }}>
        Polaris
      </p>
      <h1 className="mb-4 text-xl font-semibold">État du service</h1>
      <div className={`mb-6 flex items-center gap-3 rounded-lg border p-5 ${st.tone}`}>
        <span className={`inline-block h-3 w-3 rounded-full ${st.dot}`} aria-hidden />
        <div>
          <p className="font-medium">
            {q.isError ? 'Impossible de joindre le service de mesure' : st.label}
          </p>
          <p className="text-xs opacity-80">
            {s?.checkedAt ? `Dernière vérification : ${fmtDateTime(s.checkedAt)}` : '—'}
          </p>
        </div>
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-medium">Disponibilité sur 30 jours</h2>
          <span className="text-2xl font-semibold tabular-nums">
            {s?.availability30d === null || s?.availability30d === undefined
              ? '—'
              : `${s.availability30d} %`}
          </span>
        </div>
        {s && s.days.length > 0 ? (
          <div className="flex items-end gap-0.5" aria-label="Disponibilité par jour">
            {s.days.map((d) => {
              const a = d.availability;
              const color =
                a === null
                  ? 'bg-slate-200'
                  : a >= 99.5
                    ? 'bg-emerald-500'
                    : a >= 98
                      ? 'bg-amber-400'
                      : 'bg-red-500';
              return (
                <div
                  key={d.day}
                  className={`h-8 flex-1 rounded-sm ${color}`}
                  title={`${d.day} : ${a === null ? 'aucune mesure' : `${a} %`} (${d.checks} vérifications)`}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Pas encore de mesure.</p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Objectif : 99,5 % par mois. Mesure effectuée chaque minute depuis l&apos;intérieur de la
          plateforme ; un incident réseau entre votre établissement et Polaris peut ne pas y
          figurer. En cas de problème : support@polaris.app.
        </p>
      </section>
    </main>
  );
}
