'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { ApiError, auth } from '@/lib/api';

function InvitationForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.acceptInvitation(token, password);
      router.replace('/login?invited=1');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'Invitation invalide ou expirée.'
          : err instanceof ApiError && err.status === 422
            ? 'Mot de passe trop court (10 caractères minimum).'
            : 'Service indisponible.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!token) return <p className="p-8 text-slate-600">Lien d&apos;invitation incomplet.</p>;
  return (
    <main className="mx-auto max-w-sm px-4 py-10">
      <h1 className="mb-4 text-xl font-semibold">Créez votre mot de passe</h1>
      <form onSubmit={submit} className="space-y-4">
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="10 caractères minimum"
        />
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="w-full rounded-md px-3 py-2 font-medium text-white"
          style={{ background: 'var(--color-brand)' }}
        >
          Activer mon compte
        </button>
      </form>
    </main>
  );
}

export default function InvitationPage() {
  return (
    <Suspense fallback={null}>
      <InvitationForm />
    </Suspense>
  );
}
