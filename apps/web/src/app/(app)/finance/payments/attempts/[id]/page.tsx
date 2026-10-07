'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCan } from '@/components/app-shell';
import { PaymentsTable } from '@/components/billing';
import { AttemptBadge } from '@/components/pay';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
  Table,
} from '@/components/ui';
import { fmtDateTime, fmtXof, PROVIDER_LABELS } from '@/lib/format';
import { payments } from '@/lib/resources';

/** Chronologie d'une tentative : création → initiate → webhooks → verify → paiement → reçu, et l'audit. Sans clé ni corps brut. */
export default function AttemptTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['payments', 'timeline', id],
    queryFn: () => payments.timeline(id),
  });
  const reverify = useMutation({
    mutationFn: () => payments.reverify(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payments'] }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const { attempt: a, providerTransaction: t, webhooks, payment, audit } = q.data;
  return (
    <>
      <PageHeader
        title={`Tentative ${fmtXof(a.amount)}`}
        subtitle={
          <>
            {a.student && (
              <>
                <Link
                  href={`/finance/students/${a.studentId}`}
                  className="text-[var(--color-brand)] underline"
                >
                  {a.student.lastName} {a.student.firstName}
                </Link>{' '}
                ·{' '}
              </>
            )}
            {PROVIDER_LABELS[a.provider] ?? a.provider} · <AttemptBadge status={a.status} />
            {a.reviewStatus === 'OPEN' && (
              <>
                {' '}
                <Badge tone="red">en revue</Badge>
              </>
            )}
          </>
        }
        actions={
          can('CANCEL_PAYMENT', 'MANAGE_PAYMENT_PROVIDER') &&
          !['SUCCEEDED', 'CANCELLED', 'EXPIRED'].includes(a.status) && (
            <Button
              variant="secondary"
              onClick={() => reverify.mutate()}
              disabled={reverify.isPending}
            >
              Re-vérifier auprès du provider
            </Button>
          )
        }
      />
      <ErrorAlert error={reverify.error} />
      {a.failureMessage && (
        <div className="mb-4">
          <Alert tone={a.status === 'UNKNOWN' ? 'warning' : 'info'}>{a.failureMessage}</Alert>
        </div>
      )}
      {a.reviewNote && (
        <div className="mb-4">
          <Alert tone="success">Résolu : {a.reviewNote}</Alert>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Tentative">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Créée</dt>
            <dd>{fmtDateTime(a.createdAt)}</dd>
            <dt className="text-slate-500">Expire</dt>
            <dd>{fmtDateTime(a.expiresAt)}</dd>
            <dt className="text-slate-500">Terminée</dt>
            <dd>{a.completedAt ? fmtDateTime(a.completedAt) : '—'}</dd>
            <dt className="text-slate-500">Payeur</dt>
            <dd>{a.payerName ?? '—'}</dd>
            <dt className="text-slate-500">Réf. provider</dt>
            <dd className="font-mono text-xs">{a.externalId ?? '— (pas encore connue)'}</dd>
            <dt className="text-slate-500">Montant vérifié</dt>
            <dd
              className={
                a.verifiedAmount !== null && a.verifiedAmount !== a.amount
                  ? 'font-semibold text-red-700'
                  : ''
              }
            >
              {a.verifiedAmount === null ? '—' : fmtXof(a.verifiedAmount)}
            </dd>
            <dt className="text-slate-500">Frais provider</dt>
            <dd>{a.fees === null ? '—' : fmtXof(a.fees)}</dd>
            <dt className="text-slate-500">Parcours</dt>
            <dd>
              {a.checkout?.kind === 'WIDGET'
                ? 'Widget (côté client)'
                : a.checkout?.kind === 'REDIRECT'
                  ? 'Redirection'
                  : '—'}
            </dd>
          </dl>
        </Card>
        <Card title="Transaction provider (verify)">
          {t ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">Identifiant</dt>
              <dd className="font-mono text-xs">{t.externalId}</dd>
              <dt className="text-slate-500">Statut provider</dt>
              <dd>{t.providerStatus ?? '—'}</dd>
              <dt className="text-slate-500">Statut normalisé</dt>
              <dd>{t.normalizedStatus}</dd>
              <dt className="text-slate-500">Montant / frais</dt>
              <dd>
                {t.amount === null ? '—' : fmtXof(t.amount)} /{' '}
                {t.fees === null ? '—' : fmtXof(t.fees)}
              </dd>
              <dt className="text-slate-500">Vérifications</dt>
              <dd>
                {t.verifyCount}{' '}
                {t.lastVerifiedAt && (
                  <span className="text-slate-500">
                    (dernière : {fmtDateTime(t.lastVerifiedAt)})
                  </span>
                )}
              </dd>
            </dl>
          ) : (
            <Empty>
              Aucune transaction provider rattachée (widget sans retour, ou initiate en échec).
            </Empty>
          )}
        </Card>
        <Card title={`Webhooks reçus (${webhooks.length})`}>
          {webhooks.length === 0 ? (
            <Empty>
              Aucun webhook : la vérification peut venir du retour du parent ou de la
              réconciliation.
            </Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {webhooks.map((w) => (
                <li key={w.id} className="rounded-md border border-slate-200 p-2">
                  <div className="flex items-center justify-between">
                    <span>{fmtDateTime(w.receivedAt)}</span>
                    <Badge tone={w.signatureValid ? 'green' : 'red'}>
                      {w.signatureValid ? 'signature OK' : 'signature KO'}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    événement {w.externalEventId.slice(0, 16)}… · indice {w.hintStatus ?? '—'} ·{' '}
                    {w.processedAt
                      ? `traité ${fmtDateTime(w.processedAt)}`
                      : (w.processingError ?? 'en file')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Paiement créé" className="mt-4">
        {payment ? (
          <PaymentsTable payments={[payment]} />
        ) : (
          <Empty>Aucun paiement : seule une vérification SUCCEEDED en crée un.</Empty>
        )}
      </Card>
      <Card title="Journal" className="mt-4">
        <Table
          head={
            <>
              <th>Quand</th>
              <th>Action</th>
              <th>Par</th>
            </>
          }
        >
          {audit.map((e, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap">{fmtDateTime(e.at)}</td>
              <td className="font-mono text-xs">{e.action}</td>
              <td>{e.by ?? 'système'}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
