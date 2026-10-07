'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useMe } from '@/components/app-shell';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorAlert,
  Field,
  Input,
  Loading,
  PageHeader,
  Table,
} from '@/components/ui';
import { auth, refreshSession } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { security } from '@/lib/resources';

/** Sécurité du compte : authentification à deux facteurs (TOTP), codes de récupération, appareils connectés. */
export default function SecurityPage() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const mfa = useQuery({ queryKey: ['me', 'mfa'], queryFn: security.mfa });
  const sessions = useQuery({ queryKey: ['me', 'sessions'], queryFn: security.sessions });
  const revoke = useMutation({
    mutationFn: security.revokeSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'sessions'] }),
  });
  const logoutAll = useMutation({
    mutationFn: security.logoutAll,
    onSuccess: async () => {
      await auth.logout().catch(() => undefined);
      router.replace('/login');
    },
  });
  return (
    <>
      <PageHeader
        title="Sécurité du compte"
        subtitle={me.user.email ?? me.user.phone ?? undefined}
      />
      {mfa.isPending && <Loading />}
      <ErrorAlert error={mfa.error} />
      {mfa.data && (
        <div className="space-y-4">
          {mfa.data.required && !mfa.data.enabled && (
            <Alert tone="warning">
              Votre rôle donne accès à des actions sensibles (finance, plateforme) :
              l&apos;authentification à deux facteurs est <strong>obligatoire</strong>. Tant
              qu&apos;elle n&apos;est pas activée, ces actions vous sont refusées.
            </Alert>
          )}
          {mfa.data.enabled && !mfa.data.sessionVerified && (
            <Alert tone="info">
              Cette session a été ouverte sans second facteur. Reconnectez-vous pour accéder aux
              actions sensibles.
            </Alert>
          )}
          <MfaCard
            enabled={mfa.data.enabled}
            enrolledAt={mfa.data.enrolledAt}
            recoveryLeft={mfa.data.recoveryCodesLeft}
            onChanged={() => qc.invalidateQueries({ queryKey: ['me'] })}
          />
          <Card
            title="Appareils connectés"
            actions={
              <Button
                size="sm"
                variant="danger"
                disabled={logoutAll.isPending}
                onClick={() => logoutAll.mutate()}
              >
                Déconnecter tous les appareils
              </Button>
            }
          >
            <ErrorAlert error={revoke.error ?? logoutAll.error} />
            {sessions.isPending && <Loading />}
            {sessions.data &&
              (sessions.data.length === 0 ? (
                <Empty>Aucune session active.</Empty>
              ) : (
                <Table
                  head={
                    <>
                      <th>Appareil</th>
                      <th>Connecté le</th>
                      <th>Dernière activité</th>
                      <th></th>
                    </>
                  }
                >
                  {sessions.data.map((s) => (
                    <tr key={s.familyId}>
                      <td>
                        {s.deviceLabel ?? 'Navigateur'}{' '}
                        {s.current && <Badge tone="green">cet appareil</Badge>}
                      </td>
                      <td className="text-xs text-slate-500">{fmtDateTime(s.createdAt)}</td>
                      <td className="text-xs text-slate-500">{fmtDateTime(s.lastUsedAt)}</td>
                      <td className="text-right">
                        {!s.current && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={revoke.isPending}
                            onClick={() => revoke.mutate(s.familyId)}
                          >
                            Révoquer
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              ))}
          </Card>
        </div>
      )}
    </>
  );
}

function MfaCard({
  enabled,
  enrolledAt,
  recoveryLeft,
  onChanged,
}: {
  enabled: boolean;
  enrolledAt: string | null;
  recoveryLeft: number;
  onChanged: () => void;
}) {
  const [setup, setSetup] = useState<{
    secret: string;
    otpauthUrl: string;
    account: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'disable' | 'regen'>('idle');
  const start = useMutation({
    mutationFn: security.mfaSetup,
    onSuccess: (r) => {
      setSetup(r);
      setCode('');
    },
  });
  const enable = useMutation({
    mutationFn: () => security.mfaEnable(code.replace(/\s/g, '')),
    onSuccess: async (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      // Le prochain jeton d'accès porte le marquage MFA (la famille de refresh vient d'être marquée).
      await refreshSession();
      onChanged();
    },
  });
  const factor = () =>
    /^\d{6}$/.test(code.replace(/\s/g, ''))
      ? { code: code.replace(/\s/g, '') }
      : { recoveryCode: code.trim().toUpperCase() };
  const disable = useMutation({
    mutationFn: () => security.mfaDisable(factor()),
    onSuccess: () => {
      setMode('idle');
      setCode('');
      setCodes(null);
      onChanged();
    },
  });
  const regen = useMutation({
    mutationFn: () => security.mfaRecoveryCodes(factor()),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setMode('idle');
      setCode('');
      onChanged();
    },
  });
  const submitFactor = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'disable') disable.mutate();
    else if (mode === 'regen') regen.mutate();
  };
  return (
    <Card
      title="Authentification à deux facteurs (application d’authentification)"
      actions={
        enabled ? (
          <Badge tone="green">Activée{enrolledAt ? ` le ${fmtDateTime(enrolledAt)}` : ''}</Badge>
        ) : (
          <Badge tone="amber">Désactivée</Badge>
        )
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        À la connexion, un code à 6 chiffres généré par une application (Google Authenticator,
        Aegis, FreeOTP, 1Password…) est demandé en plus du mot de passe. Les codes de récupération
        permettent de se connecter si le téléphone est perdu : conservez-les en lieu sûr.
      </p>
      <ErrorAlert error={start.error ?? enable.error ?? disable.error ?? regen.error} />

      {codes && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-900">
            Codes de récupération — affichés une seule fois. Copiez-les maintenant.
          </p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-4">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}
            >
              Copier
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCodes(null)}>
              J&apos;ai noté mes codes
            </Button>
          </div>
        </div>
      )}

      {!enabled && !setup && (
        <Button disabled={start.isPending} onClick={() => start.mutate()}>
          Activer la double authentification
        </Button>
      )}

      {!enabled && setup && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            <p className="font-medium">1. Ajoutez le compte dans votre application</p>
            <p className="text-slate-600">
              Choisissez « Saisir une clé manuellement » et entrez cette clé (compte{' '}
              <span className="font-mono">{setup.account}</span>, émetteur Polaris) :
            </p>
            <p className="select-all rounded-md bg-slate-100 px-3 py-2 font-mono text-base tracking-wider">
              {setup.secret.match(/.{1,4}/g)?.join(' ')}
            </p>
            <p className="text-xs text-slate-500">
              Sur le téléphone, ce lien ouvre directement l&apos;application :{' '}
              <a className="underline" href={setup.otpauthUrl}>
                ajouter à l&apos;application d&apos;authentification
              </a>
              . La clé est valable 10 minutes.
            </p>
          </div>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              enable.mutate();
            }}
          >
            <p className="text-sm font-medium">2. Saisissez le code affiché pour confirmer</p>
            <Field label="Code à 6 chiffres">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123 456"
                required
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={enable.isPending}>
                Confirmer et activer
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
                Annuler
              </Button>
            </div>
          </form>
        </div>
      )}

      {enabled && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Codes de récupération restants : <strong>{recoveryLeft}</strong>
            {recoveryLeft <= 2 && ' — pensez à les régénérer.'}
          </p>
          {mode === 'idle' ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setMode('regen')}>
                Régénérer les codes de récupération
              </Button>
              <Button variant="danger" onClick={() => setMode('disable')}>
                Désactiver
              </Button>
            </div>
          ) : (
            <form onSubmit={submitFactor} className="max-w-sm space-y-3">
              <Field
                label={
                  mode === 'disable'
                    ? 'Confirmez avec un code (application ou récupération)'
                    : 'Code actuel (application ou récupération)'
                }
              >
                <Input
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant={mode === 'disable' ? 'danger' : 'primary'}
                  disabled={disable.isPending || regen.isPending}
                >
                  {mode === 'disable' ? 'Désactiver la MFA' : 'Régénérer'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setMode('idle')}>
                  Annuler
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
