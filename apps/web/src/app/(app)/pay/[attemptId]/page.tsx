'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AttemptSummary } from '@/components/pay';
import { Alert, Button, Card, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import { PROVIDER_LABELS } from '@/lib/format';
import { payments } from '@/lib/resources';

export default function PayPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PayInner />
    </Suspense>
  );
}

declare global {
  interface Window {
    openKkiapayWidget?: (o: Record<string, unknown>) => void;
    addKkiapayListener?: (event: string, cb: (r: { transactionId: string }) => void) => void;
  }
}

/** Départ vers le provider : redirection (FedaPay, démo) ou widget (KKiaPay) ; puis page de retour. */
function PayInner() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const studentId = params.get('s') ?? '';
  const q = useQuery({
    queryKey: ['payments', 'attempt', studentId, attemptId],
    queryFn: () => payments.myAttempt(studentId, attemptId),
    enabled: Boolean(studentId),
  });
  const a = q.data;
  const redirected = useRef(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const confirm = useMutation({
    mutationFn: (externalId: string) => payments.confirm(studentId, attemptId, externalId),
    onSuccess: () => router.replace(`/pay/${attemptId}/return?s=${studentId}`),
  });

  // Redirection automatique (une seule fois) vers la page de paiement du provider.
  useEffect(() => {
    if (!a || a.status !== 'PENDING' || !a.checkout) return;
    if (a.checkout.kind === 'REDIRECT' && !redirected.current) {
      redirected.current = true;
      const t = setTimeout(() => window.location.assign((a.checkout as { url: string }).url), 800);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [a]);

  // Widget KKiaPay : script officiel, clé publique, notre identifiant de tentative en donnée externe.
  useEffect(() => {
    if (!a || a.status !== 'PENDING' || a.checkout?.kind !== 'WIDGET') return;
    const c = a.checkout;
    const open = () => {
      if (!window.openKkiapayWidget) {
        setWidgetError("Le module de paiement n'a pas pu être chargé. Vérifiez votre connexion.");
        return;
      }
      window.addKkiapayListener?.('success', (r) => confirm.mutate(r.transactionId));
      window.addKkiapayListener?.('failed', () =>
        router.replace(`/pay/${attemptId}/return?s=${studentId}`),
      );
      window.openKkiapayWidget({
        amount: c.amount,
        api_key: c.publicKey,
        sandbox: c.sandbox,
        data: c.data,
        reason: 'Frais de scolarité',
        callback: `${window.location.origin}/pay/${attemptId}/return?s=${studentId}`,
      });
    };
    if (window.openKkiapayWidget) open();
    else {
      const s = document.createElement('script');
      s.src = 'https://cdn.kkiapay.me/k.js';
      s.async = true;
      s.onload = open;
      s.onerror = () => setWidgetError("Le module de paiement KKiaPay n'a pas pu être chargé.");
      document.body.appendChild(s);
    }
  }, [a?.id, a?.status]);

  if (!studentId) return <Alert tone="error">Lien de paiement incomplet.</Alert>;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  if (!a) return null;
  if (a.status !== 'PENDING' || !a.checkout) {
    router.replace(`/pay/${attemptId}/return?s=${studentId}`);
    return <Loading />;
  }
  return (
    <>
      <PageHeader title="Paiement en ligne" subtitle={PROVIDER_LABELS[a.provider] ?? a.provider} />
      <Card>
        <AttemptSummary a={a} />
        <div className="mt-4 space-y-3">
          {a.checkout.kind === 'REDIRECT' ? (
            <>
              <Alert tone="info">
                Vous allez être redirigé·e vers la page de paiement sécurisée. Si rien ne se passe,
                utilisez le bouton ci-dessous.
              </Alert>
              <a
                href={a.checkout.url}
                className="inline-flex items-center rounded-md bg-[var(--color-brand)] px-3.5 py-2 text-sm font-medium text-white"
              >
                Continuer vers le paiement →
              </a>
            </>
          ) : (
            <>
              <Alert tone="info">
                La fenêtre de paiement {PROVIDER_LABELS[a.provider]} s&apos;ouvre dans cette page.
                Une fois le paiement effectué, nous vérifions la transaction et émettons le reçu.
              </Alert>
              {widgetError && <Alert tone="error">{widgetError}</Alert>}
              <ErrorAlert error={confirm.error} />
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Rouvrir la fenêtre de paiement
              </Button>
            </>
          )}
          <p className="text-xs text-slate-500">
            Cette tentative expire à {new Date(a.expiresAt).toLocaleTimeString('fr-FR')}. Vous
            pourrez relancer un paiement depuis la fiche de votre enfant.{' '}
            <Link href={`/children/${studentId}`} className="underline">
              Retour
            </Link>
          </p>
        </div>
      </Card>
    </>
  );
}
