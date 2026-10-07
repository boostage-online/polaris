'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { PaymentConfig, PaymentProviderCode } from '@polaris/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorAlert,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
} from '@/components/ui';
import { fmtDateTime, PROVIDER_LABELS } from '@/lib/format';
import { payments, tenant } from '@/lib/resources';

const PROVIDERS: {
  code: PaymentProviderCode;
  secrets: { key: string; label: string; hint?: string }[];
  publicKey: boolean;
  help: string;
}[] = [
  {
    code: 'FEDAPAY',
    publicKey: false,
    secrets: [
      {
        key: 'secretKey',
        label: 'Clé secrète (sk_…)',
        hint: 'Tableau de bord FedaPay → Développeurs → Clés API',
      },
    ],
    help: "Créez un compte FedaPay au nom de l'établissement, faites valider le KYC, puis déclarez l'URL de webhook ci-dessous (FedaPay vous donnera le secret de signature à coller ici).",
  },
  {
    code: 'KKIAPAY',
    publicKey: true,
    secrets: [
      { key: 'privateKey', label: 'Clé privée' },
      { key: 'secret', label: 'Secret' },
    ],
    help: "Les trois clés KKiaPay (publique, privée, secret) se trouvent dans le tableau de bord → Développeurs. Déclarez l'URL de webhook et le secret partagé (en-tête x-kkiapay-secret).",
  },
  {
    code: 'FAKE',
    publicKey: false,
    secrets: [],
    help: 'Provider de démonstration (environnement de test uniquement) : aucun argent ne circule ; une caisse factice simule le téléphone du parent. À désactiver avant la mise en production.',
  },
];

/** Compte marchand de l'établissement (ADR-0010, Option A) : clés chiffrées, test de connexion, activation. */
export default function PaymentSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payments', 'configs'], queryFn: payments.configs });
  const t = useQuery({ queryKey: ['tenant'], queryFn: tenant.get });
  const [selected, setSelected] = useState<PaymentProviderCode>('FEDAPAY');
  const refresh = () => qc.invalidateQueries({ queryKey: ['payments', 'configs'] });
  const test = useMutation({
    mutationFn: (p: string) => payments.testConfig(p),
    onSuccess: refresh,
  });
  const status = useMutation({
    mutationFn: (v: { p: string; s: 'ACTIVE' | 'DISABLED' }) => payments.setConfigStatus(v.p, v.s),
    onSuccess: refresh,
  });
  const outage = useMutation({ mutationFn: (on: boolean) => payments.setFakeOutage(on) });
  const [minAmount, setMinAmount] = useState('100');
  useEffect(() => {
    if (t.data) setMinAmount(String(t.data.settings.payments?.minAmount ?? 100));
  }, [t.data]);
  const saveRules = useMutation({
    mutationFn: () => tenant.updateSettings({ payments: { minAmount: Number(minAmount) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant'] }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  const configs = q.data;
  const active = configs.find((c) => c.status === 'ACTIVE');
  const current = configs.find((c) => c.provider === selected) ?? null;
  const def = PROVIDERS.find((p) => p.code === selected)!;
  return (
    <>
      <PageHeader
        title="Paiement en ligne"
        subtitle="Option A : l'argent des parents arrive directement sur le compte provider de l'établissement ; Polaris n'encaisse rien."
      />
      {!active && (
        <div className="mb-4">
          <Alert tone="warning">
            Aucun provider actif : les parents ne voient pas le bouton « Payer en ligne ».
            Enregistrez vos clés, testez la connexion, puis activez.
          </Alert>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Providers">
          <ul className="space-y-2">
            {PROVIDERS.map((p) => {
              const c = configs.find((x) => x.provider === p.code);
              return (
                <li key={p.code}>
                  <button
                    onClick={() => setSelected(p.code)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                      selected === p.code
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/5'
                        : 'border-slate-200'
                    }`}
                  >
                    <span className="font-medium">{PROVIDER_LABELS[p.code]}</span>
                    {c ? (
                      <Badge
                        tone={
                          c.status === 'ACTIVE'
                            ? 'green'
                            : c.status === 'PENDING_TEST'
                              ? 'amber'
                              : 'slate'
                        }
                      >
                        {c.status === 'ACTIVE'
                          ? `Actif · ${c.environment}`
                          : c.status === 'PENDING_TEST'
                            ? 'À tester'
                            : 'Désactivé'}
                      </Badge>
                    ) : (
                      <Badge>Non configuré</Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <ErrorAlert error={test.error ?? status.error} />
          <div className="mt-4 border-t border-slate-100 pt-3">
            <form
              className="space-y-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                saveRules.mutate();
              }}
            >
              <Field
                label="Montant minimal d'un paiement en ligne (FCFA)"
                hint="Les providers facturent des frais fixes : évitez les micro-paiements."
              >
                <Input
                  type="number"
                  min={0}
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                />
              </Field>
              <Button type="submit" size="sm" variant="secondary" disabled={saveRules.isPending}>
                Enregistrer
              </Button>
              <ErrorAlert error={saveRules.error} />
            </form>
          </div>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <ConfigForm key={selected} def={def} current={current} onDone={refresh} />
          {current && (
            <Card title="Connexion et activation">
              <p className="text-sm text-slate-600">{def.help}</p>
              <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  URL de webhook à déclarer chez {PROVIDER_LABELS[current.provider]}
                </p>
                <code className="block break-all text-xs">{current.webhookUrl}</code>
                <p className="mt-1 text-xs text-slate-500">
                  Secret de signature :{' '}
                  {current.webhookSecretSet
                    ? 'enregistré'
                    : 'manquant — les webhooks seront refusés'}
                  .
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button onClick={() => test.mutate(current.provider)} disabled={test.isPending}>
                  {test.isPending ? 'Test…' : 'Tester la connexion'}
                </Button>
                {current.status === 'DISABLED' && (
                  <Button
                    variant="secondary"
                    onClick={() => status.mutate({ p: current.provider, s: 'ACTIVE' })}
                  >
                    Activer
                  </Button>
                )}
                {current.status === 'ACTIVE' && (
                  <Button
                    variant="danger"
                    onClick={() => status.mutate({ p: current.provider, s: 'DISABLED' })}
                  >
                    Désactiver
                  </Button>
                )}
                {current.lastTestAt && (
                  <span className="text-xs text-slate-500">
                    Dernier test {fmtDateTime(current.lastTestAt)} : {current.lastTestResult}
                  </span>
                )}
              </div>
              {current.status === 'PENDING_TEST' && (
                <p className="mt-2 text-xs text-slate-500">
                  Un test réussi active ce provider et désactive le précédent (un seul provider
                  actif par établissement).
                </p>
              )}
              {current.provider === 'FAKE' && (
                <div className="mt-3 flex items-center gap-2 text-sm">
                  <span className="text-slate-600">Simuler une panne du provider :</span>
                  <Button size="sm" variant="secondary" onClick={() => outage.mutate(true)}>
                    Panne
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => outage.mutate(false)}>
                    Rétablir
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function ConfigForm({
  def,
  current,
  onDone,
}: {
  def: (typeof PROVIDERS)[number];
  current: PaymentConfig | null;
  onDone: () => Promise<unknown>;
}) {
  const [env, setEnv] = useState<'SANDBOX' | 'LIVE'>(current?.environment ?? 'SANDBOX');
  const [publicKey, setPublicKey] = useState(current?.publicKey ?? '');
  const [secrets, setSecrets] = useState<Record<string, string>>(
    Object.fromEntries(def.secrets.map((s) => [s.key, current?.credentialsMasked[s.key] ?? ''])),
  );
  const [webhookSecret, setWebhookSecret] = useState(current?.webhookSecretSet ? '••••' : '');
  const m = useMutation({
    mutationFn: () =>
      payments.upsertConfig({
        provider: def.code,
        environment: env,
        publicKey: def.publicKey ? publicKey.trim() : undefined,
        credentials: secrets,
        webhookSecret: webhookSecret || undefined,
      }),
    onSuccess: onDone,
  });
  return (
    <Card title={`${PROVIDER_LABELS[def.code]} — clés`}>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Environnement">
          <Select
            value={env}
            onChange={(e) => setEnv(e.target.value as 'SANDBOX' | 'LIVE')}
            disabled={def.code === 'FAKE'}
          >
            <option value="SANDBOX">Sandbox (test)</option>
            <option value="LIVE">Production (argent réel)</option>
          </Select>
        </Field>
        {def.publicKey && (
          <Field label="Clé publique">
            <Input value={publicKey} onChange={(e) => setPublicKey(e.target.value)} required />
          </Field>
        )}
        {def.secrets.map((s) => (
          <Field
            key={s.key}
            label={s.label}
            hint={s.hint ?? 'Chiffrée en base ; seuls les 4 derniers caractères sont réaffichés.'}
          >
            <Input
              type="password"
              autoComplete="off"
              value={secrets[s.key] ?? ''}
              onChange={(e) => setSecrets((x) => ({ ...x, [s.key]: e.target.value }))}
              required={!current}
            />
          </Field>
        ))}
        {def.code !== 'FAKE' && (
          <Field
            label="Secret de signature des webhooks"
            hint="Fourni par le provider lors de la déclaration de l'URL."
          >
            <Input
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
          </Field>
        )}
        <div className="md:col-span-2">
          <ErrorAlert error={m.error} />
          {m.isSuccess && (
            <Alert tone="success">Clés enregistrées. Testez la connexion pour activer.</Alert>
          )}
        </div>
        <div className="md:col-span-2">
          <Button type="submit" disabled={m.isPending}>
            {current ? 'Mettre à jour les clés' : 'Enregistrer'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
