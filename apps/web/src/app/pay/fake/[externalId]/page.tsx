'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { fmtXof } from '@/lib/format';
import { payments } from '@/lib/resources';

export default function FakeCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <FakeCheckout />
    </Suspense>
  );
}

/**
 * Caisse factice du provider de démonstration (sandbox uniquement) : simule l'écran Mobile Money.
 * Chaque bouton change l'état chez le « provider » qui poste alors son webhook signé à Polaris,
 * puis renvoie le parent sur la page de retour — comme FedaPay ou KKiaPay le feraient.
 */
function FakeCheckout() {
  const { externalId } = useParams<{ externalId: string }>();
  const params = useSearchParams();
  const back = params.get('return') ?? '/';
  const q = useQuery({
    queryKey: ['fake-checkout', externalId],
    queryFn: () => payments.fakeTransaction(externalId),
    retry: false,
  });
  const act = useMutation({
    mutationFn: (status: 'SUCCESS' | 'FAILED' | 'CANCELLED') =>
      payments.fakeComplete(externalId, status),
    onSuccess: () => {
      window.location.assign(back);
    },
  });
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Provider de démonstration · environnement de test
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Paiement Mobile Money</h1>
        {q.isPending && <p className="mt-4 text-sm text-slate-600">Chargement…</p>}
        {q.isError && (
          <p className="mt-4 text-sm text-red-700">Transaction introuvable ou expirée.</p>
        )}
        {q.data && (
          <>
            <p className="mt-4 text-sm text-slate-700">Référence {q.data.externalId}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{fmtXof(q.data.amount)}</p>
            {q.data.status !== 'PENDING' ? (
              <p className="mt-4 text-sm text-slate-700">
                Cette transaction est déjà <strong>{q.data.status}</strong>.{' '}
                <a href={back} className="underline">
                  Retourner à Polaris
                </a>
              </p>
            ) : (
              <div className="mt-5 space-y-2">
                <p className="text-sm text-slate-700">
                  Simulez la réponse du téléphone du parent :
                </p>
                <button
                  className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={act.isPending}
                  onClick={() => act.mutate('SUCCESS')}
                >
                  ✓ Confirmer le paiement (code PIN saisi)
                </button>
                <button
                  className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
                  disabled={act.isPending}
                  onClick={() => act.mutate('FAILED')}
                >
                  ✗ Solde insuffisant (échec)
                </button>
                <button
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
                  disabled={act.isPending}
                  onClick={() => act.mutate('CANCELLED')}
                >
                  Annuler
                </button>
                <a href={back} className="block pt-2 text-center text-xs text-slate-500 underline">
                  Fermer sans répondre (le paiement restera « en attente »)
                </a>
              </div>
            )}
            {act.isError && (
              <p className="mt-3 text-sm text-red-700">
                {act.error instanceof Error ? act.error.message : 'Erreur inattendue'}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
