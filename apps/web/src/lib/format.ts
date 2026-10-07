/** Formats français : dates, heures, jours. Le fuseau de l'établissement est fourni par /me. */
export const WEEKDAYS = [
  '',
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
];
export const WEEKDAYS_SHORT = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function fmtDate(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: iso.length === 10 ? 'UTC' : (tz ?? undefined),
  }).format(d);
}

export function fmtTime(iso: string, tz?: string | null): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz ?? undefined,
  }).format(new Date(iso));
}

export function fmtDateTime(iso: string, tz?: string | null): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz ?? undefined,
  }).format(new Date(iso));
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const RELATIONSHIPS: Record<string, string> = {
  MOTHER: 'Mère',
  FATHER: 'Père',
  TUTOR: 'Tuteur / tutrice',
  OTHER: 'Autre',
};
export const STUDENT_STATUS: Record<string, string> = {
  ACTIVE: 'Actif',
  LEFT: 'Parti',
  GRADUATED: 'Diplômé',
};
export const SESSION_STATUS: Record<string, string> = {
  PLANNED: 'Prévue',
  HELD: 'Tenue',
  CANCELLED: 'Annulée',
};

/** Montants XOF entiers : `60 000 FCFA` (espace insécable fine remplacée par une espace simple). */
export function fmtXof(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} FCFA`;
}
export const INSTALLMENT_STATUS: Record<
  string,
  { label: string; tone: 'slate' | 'green' | 'amber' | 'red' | 'blue' }
> = {
  PENDING: { label: 'À venir', tone: 'slate' },
  DUE: { label: 'Due', tone: 'amber' },
  OVERDUE: { label: 'En retard', tone: 'red' },
  PARTIALLY_PAID: { label: 'Partiel', tone: 'blue' },
  PAID: { label: 'Payée', tone: 'green' },
  CANCELLED: { label: 'Annulée', tone: 'slate' },
};
export const FEE_STATUS: Record<
  string,
  { label: string; tone: 'slate' | 'green' | 'amber' | 'red' | 'blue' }
> = {
  OPEN: { label: 'Ouverte', tone: 'amber' },
  PARTIALLY_PAID: { label: 'Partiel', tone: 'blue' },
  PAID: { label: 'Soldée', tone: 'green' },
  CANCELLED: { label: 'Annulée', tone: 'slate' },
};
export const PAYMENT_METHODS: Record<string, string> = {
  CASH: 'Espèces',
  BANK_TRANSFER: 'Virement',
  CHEQUE: 'Chèque',
  MOBILE_MONEY_OFFLINE: 'Mobile money (hors ligne)',
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Carte',
};
export const ADJUSTMENT_KINDS: Record<string, string> = {
  DISCOUNT: 'Remise',
  SCHOLARSHIP: 'Bourse',
  WAIVER: 'Exonération',
  PENALTY: 'Pénalité',
  CORRECTION: 'Correction',
};
