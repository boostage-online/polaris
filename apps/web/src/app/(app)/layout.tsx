import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';

/** Toutes les pages connectées partagent la coque : navigation par permissions, en-tête, session. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
