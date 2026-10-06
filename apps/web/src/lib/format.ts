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
