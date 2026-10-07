'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, auth } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const pair = await auth.login(identifier.trim(), password);
      router.replace(pair.membership ? '/dashboard' : '/select-membership');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 423
            ? 'Compte temporairement verrouillé. Réessayez dans quelques minutes.'
            : err.status === 429
              ? 'Trop de tentatives. Patientez un instant.'
              : 'Identifiant ou mot de passe incorrect.',
        );
      } else setError('Service indisponible. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold" style={{ color: 'var(--color-brand)' }}>
        Polaris
      </h1>
      <p className="mb-6 text-sm text-slate-600">Connectez-vous à votre établissement.</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">E-mail ou téléphone</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            autoComplete="username"
            inputMode="email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Mot de passe</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
          />
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md px-3 py-2 font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--color-brand)' }}
        >
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p className="mt-6 text-xs text-slate-500">
        Parent ? La connexion par code SMS arrive avec l&apos;application parents (Phase 3).
      </p>
    </main>
  );
}
