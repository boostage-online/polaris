'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import type { Me } from '@polaris/contracts';
import { ApiError, auth, hasSession, refreshSession } from '@/lib/api';

/** Charge /me (après refresh silencieux si besoin) ; redirige vers /login sans session, vers le choix d'établissement sans membership actif. */
export function SessionGate({
  children,
  requireMembership = true,
}: {
  children: (me: Me) => ReactNode;
  requireMembership?: boolean;
}) {
  const router = useRouter();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      if (!hasSession() && !(await refreshSession()))
        throw new ApiError(401, {
          type: 'about:blank',
          title: 'Non connecté',
          status: 401,
          code: 'UNAUTHENTICATED',
        });
      return auth.me();
    },
    retry: false,
  });

  useEffect(() => {
    if (me.isError) router.replace('/login');
    else if (me.data && requireMembership && !me.data.membership)
      router.replace('/select-membership');
  }, [me.isError, me.data, requireMembership, router]);

  if (me.isPending) return <p className="p-8 text-slate-500">Chargement…</p>;
  if (me.isError || !me.data) return null;
  if (requireMembership && !me.data.membership) return null;
  return <>{children(me.data)}</>;
}
