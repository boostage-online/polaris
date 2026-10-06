'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Me } from '@polaris/contracts';
import { auth } from '@/lib/api';
import { SessionGate } from './session-gate';

const MeContext = createContext<Me | null>(null);

/** Session courante (utilisateur, établissement, permissions) pour tous les écrans. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe() hors de AppShell');
  return me;
}
export function useCan() {
  const me = useMe();
  const set = new Set(me.permissions);
  return (...any: string[]) => any.some((p) => set.has(p));
}

interface NavItem {
  href: string;
  label: string;
  /** Visible si l'une de ces permissions est détenue ; `kind` restreint au type d'appartenance. */
  any?: string[];
  kind?: 'STAFF' | 'GUARDIAN';
}
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Accueil',
    items: [
      { href: '/dashboard', label: 'Tableau de bord' },
      { href: '/children', label: 'Mes enfants', kind: 'GUARDIAN' },
      { href: '/schedule', label: 'Mon emploi du temps', kind: 'STAFF' },
    ],
  },
  {
    title: 'Scolarité',
    items: [
      { href: '/students', label: 'Élèves', any: ['VIEW_STUDENTS'] },
      { href: '/guardians', label: 'Tuteurs', any: ['VIEW_STUDENTS'] },
      { href: '/imports', label: 'Imports', any: ['IMPORT_STUDENTS'] },
      { href: '/sessions', label: 'Planning des séances', any: ['VIEW_STUDENTS'] },
    ],
  },
  {
    title: 'Établissement',
    items: [
      { href: '/structure', label: 'Structure académique', any: ['MANAGE_ACADEMIC_STRUCTURE'] },
      { href: '/courses', label: 'Cours et emplois du temps', any: ['MANAGE_SCHEDULES'] },
      { href: '/staff', label: 'Personnel', any: ['MANAGE_USERS'] },
    ],
  },
];

function visible(item: NavItem, me: Me): boolean {
  if (item.kind && me.membership?.kind !== item.kind) return false;
  if (!item.any) return true;
  return item.any.some((p) => me.permissions.includes(p));
}

export function AppShell({ children }: { children: ReactNode }) {
  return <SessionGate>{(me) => <Shell me={me}>{children}</Shell>}</SessionGate>;
}

function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => visible(i, me)) })).filter(
    (s) => s.items.length > 0,
  );

  const nav = (
    <nav className="space-y-5 text-sm">
      {sections.map((s) => (
        <div key={s.title}>
          <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {s.title}
          </p>
          <ul className="space-y-0.5">
            {s.items.map((i) => {
              const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => setOpen(false)}
                    className={
                      active
                        ? 'block rounded-md bg-[var(--color-brand)]/10 px-2 py-1.5 font-medium text-[var(--color-brand)]'
                        : 'block rounded-md px-2 py-1.5 text-slate-700 hover:bg-slate-100'
                    }
                  >
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
        <aside className="hidden border-r border-slate-200 bg-white px-3 py-4 lg:block">
          <Brand me={me} />
          {nav}
        </aside>
        <div className="flex min-h-dvh flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
            <div className="flex items-center gap-3">
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-sm lg:hidden"
                onClick={() => setOpen((o) => !o)}
                aria-label="Menu"
              >
                ☰
              </button>
              <p className="truncate text-sm text-slate-600">
                {me.membership?.tenant?.name ?? 'Plateforme'}
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden text-slate-700 sm:inline">
                {me.user.displayName ?? me.user.email ?? me.user.phone}
              </span>
              {me.memberships.length > 1 && (
                <button
                  onClick={() => router.push('/select-membership')}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs"
                >
                  Changer d&apos;établissement
                </button>
              )}
              <button
                onClick={async () => {
                  await auth.logout();
                  router.replace('/login');
                }}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs"
              >
                Se déconnecter
              </button>
            </div>
          </header>
          {open && (
            <div className="border-b border-slate-200 bg-white px-3 py-3 lg:hidden">{nav}</div>
          )}
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        </div>
      </div>
    </MeContext.Provider>
  );
}

function Brand({ me }: { me: Me }) {
  return (
    <div className="mb-5 px-2">
      <p className="text-lg font-semibold" style={{ color: 'var(--color-brand)' }}>
        Polaris
      </p>
      <p className="truncate text-xs text-slate-500">
        {me.membership?.roles.map((r) => r.name).join(' · ') ||
          (me.membership?.kind === 'GUARDIAN' ? 'Parent' : '')}
      </p>
    </div>
  );
}
