'use client';
import { Badge } from './ui';
import { SESSION_STATUS } from '@/lib/format';

export const ATT_STATUS: Record<string, string> = {
  PRESENT: 'Présent',
  ABSENT: 'Absent',
  LATE: 'Retard',
};
export const EXCUSE_STATUS: Record<string, string> = {
  NONE: '',
  PENDING: 'justificatif en attente',
  EXCUSED: 'justifié',
  REJECTED: 'justificatif refusé',
};
export const JUSTIF_STATUS: Record<string, string> = {
  PENDING: 'À traiter',
  APPROVED: 'Accepté',
  REJECTED: 'Refusé',
  INFO_REQUESTED: 'Complément demandé',
};

/** Libellé composé « Absent · justifié » (ADR-0006 : deux axes, un seul libellé à l'écran). */
export function statusLabel(status: string, excuse: string, lateMinutes?: number | null): string {
  const base =
    status === 'LATE' && lateMinutes ? `Retard ${lateMinutes} min` : (ATT_STATUS[status] ?? status);
  const ex = status === 'PRESENT' ? '' : EXCUSE_STATUS[excuse];
  return ex ? `${base} · ${ex}` : base;
}

export function StatusBadge({
  status,
  excuse,
  lateMinutes,
}: {
  status: string;
  excuse?: string;
  lateMinutes?: number | null;
}) {
  const tone =
    status === 'PRESENT'
      ? 'green'
      : status === 'LATE'
        ? 'amber'
        : excuse === 'EXCUSED'
          ? 'slate'
          : 'red';
  return <Badge tone={tone}>{statusLabel(status, excuse ?? 'NONE', lateMinutes)}</Badge>;
}

export function SessionStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={status === 'CANCELLED' ? 'red' : status === 'HELD' ? 'green' : 'blue'}>
      {SESSION_STATUS[status] ?? status}
    </Badge>
  );
}

export function SheetState({
  sheet,
}: {
  sheet: { status: string; counts: { present: number; absent: number; late: number } } | null;
}) {
  if (!sheet) return <Badge tone="amber">À faire</Badge>;
  if (sheet.status === 'DRAFT') return <Badge tone="amber">Brouillon</Badge>;
  return (
    <span className="flex items-center gap-1">
      <Badge tone="green">{sheet.status === 'LOCKED' ? 'Verrouillée' : 'Soumise'}</Badge>
      {sheet.counts.absent > 0 && <Badge tone="red">{sheet.counts.absent} abs.</Badge>}
      {sheet.counts.late > 0 && <Badge tone="amber">{sheet.counts.late} ret.</Badge>}
    </span>
  );
}
