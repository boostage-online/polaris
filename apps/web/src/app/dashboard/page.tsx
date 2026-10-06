'use client';
import { useRouter } from 'next/navigation';
import { SessionGate } from '@/components/session-gate';
import { auth } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  return (
    <SessionGate>
      {(me) => (
        <main className="mx-auto max-w-3xl px-4 py-8">
          <header className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {me.membership?.tenant?.name ?? 'Plateforme'}
              </p>
              <h1 className="text-2xl font-semibold">
                Bonjour {me.user.displayName ?? me.user.email}
              </h1>
              <p className="text-sm text-slate-600">
                {me.membership?.roles.map((r) => r.name).join(' · ')}
              </p>
            </div>
            <div className="flex gap-2">
              {me.memberships.length > 1 && (
                <button
                  onClick={() => router.push('/select-membership')}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  Changer d&apos;établissement
                </button>
              )}
              <button
                onClick={async () => {
                  await auth.logout();
                  router.replace('/login');
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                Se déconnecter
              </button>
            </div>
          </header>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 font-medium">Vos permissions</h2>
            <ul className="flex flex-wrap gap-1.5">
              {me.permissions.map((p) => (
                <li key={p} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-slate-500">
              Les écrans métier (structure académique, élèves, appel, finances) arrivent avec les
              phases 2 à 5. Ce socle valide connexion, bascule d&apos;établissement,
              rafraîchissement silencieux et déconnexion.
            </p>
          </section>
        </main>
      )}
    </SessionGate>
  );
}
