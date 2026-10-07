'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Me } from '@polaris/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auth, endImpersonation, isImpersonating } from '@/lib/api';
import { notifs, platformOps } from '@/lib/resources';
import { fmtTime } from '@/lib/format';
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
  kind?: 'STAFF' | 'GUARDIAN' | 'PLATFORM';
}
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Accueil',
    items: [
      { href: '/dashboard', label: 'Tableau de bord' },
      { href: '/children', label: 'Mes enfants', kind: 'GUARDIAN' },
      {
        href: '/attendance/today',
        label: 'Mes appels',
        kind: 'STAFF',
        any: ['TAKE_ATTENDANCE', 'TAKE_ATTENDANCE_ANY'],
      },
      { href: '/schedule', label: 'Mon emploi du temps', kind: 'STAFF' },
      { href: '/notifications', label: 'Notifications' },
      { href: '/settings/security', label: 'Sécurité du compte' },
    ],
  },
  {
    title: 'Pilotage',
    items: [
      { href: '/direction', label: 'Direction', any: ['VIEW_REPORTS'] },
      { href: '/pedagogy', label: 'Pédagogie', any: ['VIEW_ATTENDANCE_REPORTS'] },
      {
        href: '/reports',
        label: 'Rapports',
        any: ['VIEW_REPORTS', 'VIEW_ATTENDANCE_REPORTS', 'VIEW_FINANCIAL_REPORTS'],
      },
    ],
  },
  {
    title: 'Assiduité',
    items: [
      {
        href: '/attendance/sheets',
        label: "Feuilles d'appel",
        any: ['VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS'],
      },
      {
        href: '/justifications',
        label: 'Justificatifs',
        any: ['REVIEW_JUSTIFICATION', 'VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS'],
      },
      {
        href: '/attendance/watchlist',
        label: 'Élèves à surveiller',
        any: ['VIEW_ATTENDANCE_ANY', 'VIEW_ATTENDANCE_REPORTS', 'REVIEW_JUSTIFICATION'],
      },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/finance', label: 'Tableau de bord finance', any: ['VIEW_FINANCIAL_REPORTS'] },
      { href: '/finance/cash', label: 'Journal de caisse', any: ['VIEW_PAYMENTS'] },
      { href: '/finance/payments', label: 'Paiements en ligne', any: ['VIEW_PAYMENTS'] },
      { href: '/finance/unpaid', label: 'Impayés et rappels', any: ['VIEW_FEES'] },
      { href: '/finance/assign', label: 'Affecter des frais', any: ['ASSIGN_FEES'] },
      {
        href: '/finance/catalog',
        label: 'Catalogue de frais',
        any: ['MANAGE_FEE_STRUCTURES', 'VIEW_FEES'],
      },
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
      {
        href: '/admin/notifications',
        label: 'Journal des notifications',
        any: ['MANAGE_TENANT_SETTINGS', 'VIEW_AUDIT_LOG'],
      },
      { href: '/settings/payments', label: 'Paiement en ligne', any: ['MANAGE_PAYMENT_PROVIDER'] },
      { href: '/settings', label: 'Paramètres', any: ['MANAGE_TENANT_SETTINGS'] },
      {
        href: '/onboarding',
        label: 'Assistant de démarrage',
        any: [
          'MANAGE_TENANT_SETTINGS',
          'MANAGE_ACADEMIC_STRUCTURE',
          'MANAGE_USERS',
          'IMPORT_STUDENTS',
        ],
      },
      { href: '/admin/audit', label: "Journal d'audit", any: ['VIEW_AUDIT_LOG'] },
      { href: '/admin/privacy', label: 'Données personnelles', any: ['MANAGE_PRIVACY'] },
    ],
  },
  {
    title: 'Super Admin',
    items: [
      {
        href: '/platform',
        label: 'Plateforme',
        any: ['PLATFORM_VIEW_METRICS', 'PLATFORM_MANAGE_TENANTS'],
      },
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
          {me.impersonation && <ImpersonationBanner me={me} />}
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
              <Bell />
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

/** Bannière obligatoire d'une session de support Super Admin (Partie 11) : qui, pourquoi, jusqu'à quand, sortie. */
function ImpersonationBanner({ me }: { me: Me }) {
  const router = useRouter();
  const qc = useQueryClient();
  const imp = me.impersonation!;
  const end = useMutation({
    mutationFn: async () => {
      // On revient d'abord au jeton plateforme, puis on clôture la session (route plateforme).
      const sessionId = imp.sessionId;
      endImpersonation();
      await platformOps.endImpersonation(sessionId).catch(() => undefined);
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.replace('/platform');
    },
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm text-amber-950">
      <p>
        <strong>Session de support</strong> dans « {imp.tenantName} » — motif : {imp.reason}. Expire
        à {fmtTime(imp.expiresAt, me.tenantTimezone)}. Aucune action financière n&apos;est possible
        ; tout est journalisé.
      </p>
      {isImpersonating() && (
        <button
          onClick={() => end.mutate()}
          disabled={end.isPending}
          className="rounded-md border border-amber-900/40 bg-white/70 px-2.5 py-1 text-xs font-medium"
        >
          Quitter le mode support
        </button>
      )}
    </div>
  );
}

/** Cloche : nombre de notifications non lues (rafraîchi toutes les 60 s). */
function Bell() {
  const q = useQuery({
    queryKey: ['notifications', 'inbox', 'badge'],
    queryFn: () => notifs.inbox({ unread: true, limit: 1 }),
    refetchInterval: 60_000,
  });
  const unread = q.data?.meta.unread ?? 0;
  return (
    <Link
      href="/notifications"
      className="relative rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100"
      aria-label={`Notifications (${unread} non lues)`}
    >
      🔔
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
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
