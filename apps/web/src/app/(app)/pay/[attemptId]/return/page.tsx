'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AttemptBadge, AttemptSummary } from '@/components/pay';
import { Alert, Button, Card, ErrorAlert, LinkButton, Loading, PageHeader } from '@/components/ui';
import { fmtXof } from '@/lib/format';
import { parentFinance, payments } from '@/lib/resources';

export default function ReturnPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ReturnInner />
    </Suspense>
  );
}

const POLL_MS = 3000;
const MAX_WAIT_MS = 2 * 60_000;

/**
 * Retour du provider : « en cours de vérification », une confirmation déclenchée tout de suite
 * (identifiant de transaction s'il est dans l'URL), puis polling 3 s pendant 2 min au plus.
 * Le parent ne voit « payé » que lorsque le serveur a vérifié et créé le paiement.
 */
function ReturnInner() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const params = useSearchParams();
  const qc = useQueryClient();
  const studentId = params.get('s') ?? '';
  const externalId =
    params.get('transactionId') ?? params.get('transaction_id') ?? params.get('id') ?? undefined;
  const [startedAt] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);
  const q = useQuery({
    queryKey: ['payments', 'attempt', studentId, attemptId],
    queryFn: () => payments.myAttempt(studentId, attemptId),
    enabled: Boolean(studentId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (!s || s === 'PENDING' || s === 'PROCESSING' || s === 'CREATED') {
        if (Date.now() - startedAt > MAX_WAIT_MS) {
          setTimedOut(true);
          return false;
        }
        return POLL_MS;
      }
      return false;
    },
  });
  const confirmed = useRef(false);
  const confirm = useMutation({
    mutationFn: () => payments.confirm(studentId, attemptId, externalId),
    onSuccess: async (a) => {
      qc.setQueryData(['payments', 'attempt', studentId, attemptId], a);
      await qc.invalidateQueries({ queryKey: ['parent'] });
      await qc.invalidateQueries({ queryKey: ['payments', 'my-attempts'] });
    },
  });
  useEffect(() => {
    if (confirmed.current || !studentId) return;
    confirmed.current = true;
    confirm.mutate();
  }, [studentId]);
  const dl = useMutation({
    mutationFn: () =>
      parentFinance.downloadReceipt(studentId, a!.paymentId!, a!.receiptNumber ?? 'recu'),
  });

  if (!studentId) return <Alert tone="error">Lien de retour incomplet.</Alert>;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const a = q.data!;
  const waiting = a.status === 'PENDING' || a.status === 'PROCESSING' || a.status === 'CREATED';
  return (
    <>
      <PageHeader title="Confirmation du paiement" />
      <Card>
        <div className="mb-4 flex items-center gap-3">
          <AttemptBadge status={a.status} />
          {waiting && !timedOut && (
            <span className="text-sm text-slate-500">
              {confirm.isPending
                ? 'Vérification auprès du provider…'
                : 'En attente de confirmation…'}
            </span>
          )}
        </div>
        <AttemptSummary a={a} />
        <div className="mt-4 space-y-3">
          {a.status === 'SUCCEEDED' && (
            <>
              <Alert tone="success">
                Paiement de <strong>{fmtXof(a.amount)}</strong> confirmé. Votre reçu{' '}
                <span className="font-mono">{a.receiptNumber}</span> est disponible et vous a été
                envoyé.
              </Alert>
              <div className="flex flex-wrap gap-2">
                {a.paymentId && (
                  <Button onClick={() => dl.mutate()} disabled={dl.isPending}>
                    Télécharger le reçu (PDF)
                  </Button>
                )}
                <LinkButton href={`/children/${studentId}`}>Retour à la fiche</LinkButton>
              </div>
              <ErrorAlert error={dl.error} />
            </>
          )}
          {(a.status === 'FAILED' || a.status === 'CANCELLED' || a.status === 'EXPIRED') && (
            <>
              <Alert tone={a.status === 'FAILED' ? 'error' : 'warning'}>
                {a.failureMessage ?? "Le paiement n'a pas abouti."} Aucun montant n&apos;a été
                enregistré par l&apos;établissement.
              </Alert>
              <LinkButton href={`/children/${studentId}`} variant="primary">
                Réessayer depuis la fiche
              </LinkButton>
            </>
          )}
          {a.status === 'UNKNOWN' && (
            <Alert tone="warning">
              Nous n&apos;avons pas pu confirmer automatiquement ce paiement : le service financier
              de l&apos;établissement le vérifie. Si vous avez été débité·e, aucune action
              n&apos;est nécessaire ; vous serez prévenu·e.
            </Alert>
          )}
          {waiting && (
            <>
              <Alert tone="info">
                {timedOut
                  ? 'La confirmation prend plus de temps que prévu. Vous pouvez quitter cette page : nous vérifions automatiquement et vous serez notifié·e dès que le paiement est confirmé.'
                  : 'Ne fermez pas cette page : la confirmation arrive généralement en moins d’une minute.'}
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => confirm.mutate()}
                  disabled={confirm.isPending}
                >
                  Vérifier maintenant
                </Button>
                {a.checkout?.kind === 'REDIRECT' && a.status === 'PENDING' && (
                  <a
                    href={a.checkout.url}
                    className="text-sm text-[var(--color-brand)] underline self-center"
                  >
                    Reprendre le paiement
                  </a>
                )}
              </div>
              <ErrorAlert error={confirm.error} />
            </>
          )}
          <p className="text-xs text-slate-500">
            <Link href={`/children/${studentId}`} className="underline">
              Fiche de l&apos;enfant
            </Link>
          </p>
        </div>
      </Card>
    </>
  );
}
