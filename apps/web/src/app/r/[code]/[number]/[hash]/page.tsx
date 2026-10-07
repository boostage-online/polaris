'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { ReceiptVerification } from '@polaris/contracts';
import { apiPublic } from '@/lib/api';
import { fmtDateTime, fmtXof } from '@/lib/format';

/**
 * Vérification publique d'un reçu (cible du lien / QR imprimé) : aucune donnée nominative,
 * seulement l'authenticité, le montant et l'établissement.
 */
export default function ReceiptVerifyPage() {
  const { code, number, hash } = useParams<{ code: string; number: string; hash: string }>();
  const q = useQuery({
    queryKey: ['receipt-verify', code, number, hash],
    queryFn: () =>
      apiPublic<ReceiptVerification>(
        `/receipts/verify/${encodeURIComponent(code)}/${encodeURIComponent(number)}/${encodeURIComponent(hash)}`,
      ),
    retry: false,
  });
  const r = q.data;
  const tone =
    !r || q.isError
      ? 'border-slate-200 bg-slate-50'
      : r.status === 'VALID'
        ? 'border-emerald-200 bg-emerald-50'
        : r.status === 'CANCELLED'
          ? 'border-amber-200 bg-amber-50'
          : 'border-red-200 bg-red-50';
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <p className="mb-1 text-lg font-semibold" style={{ color: 'var(--color-brand)' }}>
        Polaris
      </p>
      <h1 className="mb-4 text-xl font-semibold">Vérification de reçu</h1>
      <div className={`rounded-lg border p-5 ${tone}`}>
        <p className="font-mono text-lg">{decodeURIComponent(number)}</p>
        {q.isPending && <p className="mt-2 text-sm text-slate-500">Vérification…</p>}
        {q.isError && (
          <p className="mt-2 text-sm text-red-700">
            Vérification impossible pour le moment. Réessayez ou contactez l&apos;établissement.
          </p>
        )}
        {r && r.status === 'VALID' && (
          <>
            <p className="mt-2 text-2xl font-semibold text-emerald-800">✓ Reçu authentique</p>
            <p className="mt-1 text-sm text-emerald-900">
              Émis par <strong>{r.tenantName}</strong> le{' '}
              {r.issuedAt ? fmtDateTime(r.issuedAt) : '—'} pour un montant de{' '}
              <strong>{fmtXof(r.amount ?? 0)}</strong>.
            </p>
          </>
        )}
        {r && r.status === 'CANCELLED' && (
          <>
            <p className="mt-2 text-2xl font-semibold text-amber-800">Reçu annulé</p>
            <p className="mt-1 text-sm text-amber-900">
              Ce reçu de {fmtXof(r.amount ?? 0)} émis par {r.tenantName} a été annulé par une
              écriture compensatoire. Il ne vaut plus preuve de paiement.
            </p>
          </>
        )}
        {r && r.status === 'UNKNOWN' && (
          <>
            <p className="mt-2 text-2xl font-semibold text-red-800">✗ Reçu inconnu</p>
            <p className="mt-1 text-sm text-red-900">
              Aucun reçu ne correspond à ce numéro et à cette empreinte. Rapprochez-vous de
              l&apos;établissement.
            </p>
          </>
        )}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Cette page ne révèle aucune information personnelle : elle confirme seulement qu&apos;un
        reçu portant ce numéro a bien été émis pour ce montant.
      </p>
    </main>
  );
}
