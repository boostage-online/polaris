'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SessionGate } from '@/components/session-gate';
import { auth } from '@/lib/api';

export default function SelectMembershipPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <SessionGate requireMembership={false}>
      {(me) => (
        <main className="mx-auto max-w-md px-4 py-10">
          <h1 className="mb-4 text-xl font-semibold">Choisissez un établissement</h1>
          <ul className="space-y-2">
            {me.memberships.map((m) => (
              <li key={m.id}>
                <button
                  disabled={busy !== null || m.tenant?.status === 'SUSPENDED'}
                  onClick={async () => {
                    setBusy(m.id);
                    try {
                      await auth.switchMembership(m.id);
                      router.replace('/dashboard');
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-left hover:border-slate-500 disabled:opacity-50"
                >
                  <span className="block font-medium">
                    {m.tenant?.name ?? 'Plateforme Polaris'}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {m.roles.map((r) => r.name).join(', ') || m.kind}
                    {m.tenant?.status === 'SUSPENDED' ? ' · suspendu' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </main>
      )}
    </SessionGate>
  );
}
