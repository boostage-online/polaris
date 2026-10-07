/**
 * Conversion « date + heure locale du tenant » → instant UTC, sans dépendance externe.
 * Suffisant pour les fuseaux sans heure d'été (UEMOA) et correct ailleurs à la minute près.
 */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset = offsetMinutes(new Date(guess), timeZone);
  const adjusted = guess - offset * 60_000;
  // Deuxième passe pour les transitions d'heure d'été.
  const offset2 = offsetMinutes(new Date(adjusted), timeZone);
  return new Date(guess - offset2 * 60_000);
}

/** Décalage (minutes) du fuseau par rapport à UTC à l'instant donné. */
export function offsetMinutes(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value])) as Record<
    string,
    string
  >;
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']),
    Number(parts['minute']),
    Number(parts['second']),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Date locale (AAAA-MM-JJ) et jour ISO (1 = lundi) d'un instant dans un fuseau. */
export function localDateParts(at: Date, timeZone: string): { date: string; isoWeekday: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value])) as Record<
    string,
    string
  >;
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    isoWeekday: map[parts['weekday'] ?? ''] ?? 0,
  };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
