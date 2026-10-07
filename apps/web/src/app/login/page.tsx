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
  // Étape MFA : défi renvoyé par l'API (5 minutes), code TOTP ou code de récupération.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await auth.login(identifier.trim(), password);
      if ('mfaRequired' in r) {
        setChallenge(r.challenge);
        setPassword('');
        return;
      }
      router.replace(r.membership ? '/dashboard' : '/select-membership');
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

  async function submitMfa(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const value = code.trim().toUpperCase();
      const pair = await auth.mfaVerify(
        challenge,
        useRecovery ? { recoveryCode: value } : { code: value.replace(/\s/g, '') },
      );
      router.replace(pair.membership ? '/dashboard' : '/select-membership');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.problem.code === 'MFA_REQUIRED') {
        setError(
          err.problem.detail?.includes('expiré')
            ? 'Le délai est dépassé : recommencez la connexion.'
            : 'Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.',
        );
        if (err.problem.detail?.includes('expiré')) setChallenge(null);
      } else if (err instanceof ApiError && err.status === 423) {
        setError('Compte temporairement verrouillé. Réessayez dans quelques minutes.');
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
      {challenge ? (
        <>
          <p className="mb-6 text-sm text-slate-600">
            Deuxième facteur : saisissez le code à 6 chiffres de votre application
            d&apos;authentification.
          </p>
          <form onSubmit={submitMfa} className="space-y-4" noValidate>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                {useRecovery ? 'Code de récupération' : 'Code à 6 chiffres'}
              </span>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-lg tracking-widest"
                autoComplete="one-time-code"
                inputMode={useRecovery ? 'text' : 'numeric'}
                placeholder={useRecovery ? 'XXXXX-XXXXX' : '123 456'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
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
              {busy ? 'Vérification…' : 'Valider'}
            </button>
            <div className="flex justify-between text-xs text-slate-500">
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setCode('');
                  setError(null);
                }}
              >
                {useRecovery ? 'Utiliser l’application' : 'Utiliser un code de récupération'}
              </button>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setChallenge(null);
                  setCode('');
                  setError(null);
                }}
              >
                Recommencer
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
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
        </>
      )}
    </main>
  );
}
