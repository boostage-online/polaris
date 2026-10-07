/**
 * Règles pures du sous-grand-livre de créances (ADR-0005, Partie 9) : statuts dérivés, plan d'allocation,
 * numérotation des reçus, règles tenant. Aucune dépendance d'infrastructure.
 */
import { createHash } from 'node:crypto';

export type InstallmentStatus =
  | 'PENDING'
  | 'DUE'
  | 'OVERDUE'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';
export type StudentFeeStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export interface BillingRules {
  /** Jours de grâce avant qu'une échéance due soit « en retard ». */
  graceDays: number;
  /** Rappels avant échéance (J − n). */
  reminderDaysBefore: number[];
  /** Après l'échéance : premier rappel à J + 1, puis tous les n jours. */
  overdueReminderEveryDays: number;
  currency: string;
}
export const DEFAULT_BILLING_RULES: BillingRules = {
  graceDays: 0,
  reminderDaysBefore: [7, 1],
  overdueReminderEveryDays: 14,
  currency: 'XOF',
};
export function billingRulesFrom(
  settings: Record<string, unknown> | null | undefined,
): BillingRules {
  const b = (settings?.['billing'] ?? {}) as Partial<BillingRules>;
  const defined = Object.fromEntries(
    Object.entries(b).filter(([, v]) => v !== undefined),
  ) as Partial<BillingRules>;
  return { ...DEFAULT_BILLING_RULES, ...defined };
}

export interface InstallmentAmounts {
  amountDue: number;
  adjustmentsTotal: number;
  amountAllocated: number;
  dueDate: string;
}

/** Reste à payer d'une échéance (jamais négatif). */
export function remaining(i: InstallmentAmounts): number {
  return Math.max(0, i.amountDue + i.adjustmentsTotal - i.amountAllocated);
}
export function effectiveDue(i: InstallmentAmounts): number {
  return Math.max(0, i.amountDue + i.adjustmentsTotal);
}

/** Statut dérivé d'une échéance (Partie 9, « États et calculs »). */
export function installmentStatus(
  i: InstallmentAmounts,
  today: string,
  rules: BillingRules,
): InstallmentStatus {
  const due = effectiveDue(i);
  if (due === 0) return i.amountAllocated > 0 ? 'PAID' : 'CANCELLED';
  if (i.amountAllocated >= due) return 'PAID';
  if (i.amountAllocated > 0) return 'PARTIALLY_PAID';
  if (i.dueDate > today) return 'PENDING';
  return addDays(i.dueDate, rules.graceDays) < today ? 'OVERDUE' : 'DUE';
}

/** Statut dérivé d'une créance depuis ses échéances. */
export function feeStatus(
  statuses: InstallmentStatus[],
  totalDue: number,
  allocated: number,
): StudentFeeStatus {
  if (totalDue <= 0 && allocated === 0) return 'CANCELLED';
  if (
    statuses.length > 0 &&
    statuses.every((s) => s === 'PAID' || s === 'CANCELLED') &&
    allocated >= totalDue
  )
    return 'PAID';
  if (allocated > 0) return 'PARTIALLY_PAID';
  return 'OPEN';
}

export interface AllocationLine {
  installmentId: string;
  amount: number;
}
/**
 * Plan d'allocation d'un montant M sur des échéances ouvertes : les ciblées d'abord (dans l'ordre donné),
 * puis les autres par date d'échéance puis rang ; a = min(reste, M restant). Le reliquat devient un crédit.
 */
export function planAllocation(
  amount: number,
  open: ({ id: string; seq: number } & InstallmentAmounts)[],
  targetedIds: readonly string[] = [],
): { lines: AllocationLine[]; remainder: number } {
  const byDate = [...open].sort((a, b) =>
    a.dueDate === b.dueDate ? a.seq - b.seq : a.dueDate < b.dueDate ? -1 : 1,
  );
  const targeted = targetedIds
    .map((id) => byDate.find((i) => i.id === id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const rest = byDate.filter((i) => !targetedIds.includes(i.id));
  const lines: AllocationLine[] = [];
  let left = amount;
  for (const i of [...targeted, ...rest]) {
    if (left <= 0) break;
    const a = Math.min(remaining(i), left);
    if (a <= 0) continue;
    lines.push({ installmentId: i.id, amount: a });
    left -= a;
  }
  return { lines, remainder: left };
}

/** Numéro de reçu `{CODE_ETAB}-{ANNEE}-{SEQ:6}` (séquentiel par tenant et année, sans trou). */
export function receiptNumber(tenantCode: string, year: number, seq: number): string {
  return `${tenantCode.toUpperCase()}-${year}-${String(seq).padStart(6, '0')}`;
}

/** Empreinte de vérification publique : ne révèle rien, prouve l'authenticité (secret serveur). */
export function receiptHash(
  secret: string,
  tenantId: string,
  number: string,
  amount: number,
): string {
  return createHash('sha256')
    .update(`${secret}|${tenantId}|${number}|${amount}`)
    .digest('hex')
    .slice(0, 16);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  );
}

/** Les rappels dus aujourd'hui pour une échéance ouverte : J−n avant, J+1 puis tous les n jours après. */
export function reminderKindFor(
  dueDate: string,
  today: string,
  rules: BillingRules,
): 'DUE_SOON' | 'OVERDUE' | null {
  const delta = daysBetween(today, dueDate); // > 0 : à venir
  if (delta > 0) return rules.reminderDaysBefore.includes(delta) ? 'DUE_SOON' : null;
  const late = -delta;
  if (late < 1) return null;
  return late === 1 || (late - 1) % Math.max(1, rules.overdueReminderEveryDays) === 0
    ? 'OVERDUE'
    : null;
}

export const formatXof = (n: number) =>
  `${n.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} FCFA`;
