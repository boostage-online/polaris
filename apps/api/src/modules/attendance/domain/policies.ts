/**
 * Règles d'assiduité (ADR-0006) et de portée (ADR-0007). Pur : aucune dépendance d'infrastructure.
 */

export interface AttendanceRules {
  /** Au-delà de ce retard (minutes), l'élève est compté ABSENT ; la durée est conservée. */
  lateToAbsentMinutes: number;
  /** Fenêtre de correction ordinaire après la fin de la séance (heures). */
  correctionWindowHours: number;
  /** Les tuteurs autorisés peuvent déposer un justificatif. */
  guardianJustificationsEnabled: boolean;
  /** Seuil d'alerte : N absences non justifiées sur W jours. */
  repeatedAbsenceThreshold: number;
  repeatedAbsenceWindowDays: number;
}

export const DEFAULT_RULES: AttendanceRules = {
  lateToAbsentMinutes: 30,
  correctionWindowHours: 48,
  guardianJustificationsEnabled: false,
  repeatedAbsenceThreshold: 3,
  repeatedAbsenceWindowDays: 30,
};

/** Règles effectives d'un tenant depuis `tenants.settings.attendance` (valeurs partielles tolérées). */
export function rulesFrom(settings: Record<string, unknown> | null | undefined): AttendanceRules {
  const a = (settings?.['attendance'] ?? {}) as Partial<AttendanceRules>;
  return { ...DEFAULT_RULES, ...stripUndefined(a) };
}
function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export interface Actor {
  permissions: ReadonlySet<string>;
  staffProfileId: string | null;
}
export interface SessionWindow {
  startsAt: Date;
  endsAt: Date;
}

/** L'appel peut s'ouvrir 15 min avant le début ; au-delà de 24 h après la fin, il est « rétroactif ». */
export const OPEN_BEFORE_START_MS = 15 * 60_000;
export const RETROACTIVE_AFTER_END_MS = 24 * 3_600_000;
/** Une séance est « à faire » tant que sa fin n'est pas passée de plus de 30 min. */
export const NEXT_GRACE_MS = 30 * 60_000;

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE';

export const AttendancePolicy = {
  teaches(actor: Actor, teacherIds: readonly string[]): boolean {
    return actor.staffProfileId !== null && teacherIds.includes(actor.staffProfileId);
  },
  /** Peut faire l'appel : vie scolaire (portée globale) ou enseignant du cours. */
  canTake(actor: Actor, teacherIds: readonly string[]): boolean {
    if (actor.permissions.has('TAKE_ATTENDANCE_ANY')) return true;
    return actor.permissions.has('TAKE_ATTENDANCE') && this.teaches(actor, teacherIds);
  },
  /** Peut lire une feuille : portée globale, ou enseignant du cours avec VIEW/TAKE. */
  canView(actor: Actor, teacherIds: readonly string[]): boolean {
    if (
      actor.permissions.has('VIEW_ATTENDANCE_ANY') ||
      actor.permissions.has('TAKE_ATTENDANCE_ANY') ||
      actor.permissions.has('VIEW_ATTENDANCE_REPORTS')
    )
      return true;
    return (
      (actor.permissions.has('VIEW_ATTENDANCE') || actor.permissions.has('TAKE_ATTENDANCE')) &&
      this.teaches(actor, teacherIds)
    );
  },
  /** Trop tôt pour ouvrir ? (avant début − 15 min) */
  tooEarly(session: SessionWindow, now: Date): boolean {
    return now.getTime() < session.startsAt.getTime() - OPEN_BEFORE_START_MS;
  },
  /** Saisie rétroactive : plus de 24 h après la fin (réservée à TAKE_ATTENDANCE_ANY). */
  isRetroactive(session: SessionWindow, now: Date): boolean {
    return now.getTime() > session.endsAt.getTime() + RETROACTIVE_AFTER_END_MS;
  },
  /** Correction dans la fenêtre ordinaire ? (fin de séance + fenêtre tenant) */
  withinCorrectionWindow(session: SessionWindow, now: Date, rules: AttendanceRules): boolean {
    return now.getTime() <= session.endsAt.getTime() + rules.correctionWindowHours * 3_600_000;
  },
  /**
   * Qui peut corriger un enregistrement soumis : dans la fenêtre et feuille non verrouillée →
   * EDIT_ATTENDANCE ; sinon → EDIT_ATTENDANCE_LOCKED. Renvoie `null` si interdit.
   */
  correctionMode(
    actor: Actor,
    sheetStatus: 'DRAFT' | 'SUBMITTED' | 'LOCKED',
    session: SessionWindow,
    now: Date,
    rules: AttendanceRules,
  ): { outOfWindow: boolean } | null {
    const ordinary =
      sheetStatus === 'SUBMITTED' && this.withinCorrectionWindow(session, now, rules);
    if (ordinary && actor.permissions.has('EDIT_ATTENDANCE')) return { outOfWindow: false };
    if (actor.permissions.has('EDIT_ATTENDANCE_LOCKED')) return { outOfWindow: !ordinary };
    return null;
  },
  /**
   * Normalise une saisie : un retard au-delà du seuil devient une absence (durée conservée) ;
   * la durée d'un retard est bornée par la durée de la séance ; les attributs incohérents sont effacés.
   */
  normalize(
    input: {
      status: AttendanceStatus;
      lateMinutes?: number | null;
      leftEarlyAt?: string | null;
      note?: string | null;
    },
    session: SessionWindow,
    rules: AttendanceRules,
  ): {
    status: AttendanceStatus;
    lateMinutes: number | null;
    leftEarlyAt: Date | null;
    note: string | null;
    errors: string[];
  } {
    const errors: string[] = [];
    const duration = Math.max(
      1,
      Math.round((session.endsAt.getTime() - session.startsAt.getTime()) / 60_000),
    );
    let status = input.status;
    let lateMinutes = input.lateMinutes ?? null;
    let leftEarlyAt = input.leftEarlyAt ? new Date(input.leftEarlyAt) : null;
    if (status === 'LATE') {
      if (!lateMinutes || lateMinutes < 1) errors.push('Durée du retard requise');
      else if (lateMinutes > duration)
        errors.push(`Retard supérieur à la durée de la séance (${duration} min)`);
      else if (lateMinutes >= rules.lateToAbsentMinutes) status = 'ABSENT';
    } else if (status === 'PRESENT') {
      lateMinutes = null;
    } else {
      // ABSENT saisi directement : pas de durée (sauf si issu d'un retard converti ci-dessus).
      lateMinutes = null;
    }
    if (leftEarlyAt && status !== 'PRESENT') leftEarlyAt = null;
    if (
      leftEarlyAt &&
      (leftEarlyAt.getTime() <= session.startsAt.getTime() ||
        leftEarlyAt.getTime() >= session.endsAt.getTime())
    )
      errors.push('La sortie anticipée doit être pendant la séance');
    return { status, lateMinutes, leftEarlyAt, note: input.note?.trim() || null, errors };
  },
  /** La « prochaine » séance : première sans feuille soumise dont la fin n'est pas passée de plus de 30 min. */
  nextSessionId(
    sessions: readonly { id: string; endsAt: Date; sheetStatus: string | null }[],
    now: Date,
  ): string | null {
    const sorted = [...sessions].sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());
    return (
      sorted.find(
        (s) =>
          s.sheetStatus !== 'SUBMITTED' &&
          s.sheetStatus !== 'LOCKED' &&
          s.endsAt.getTime() > now.getTime() - NEXT_GRACE_MS,
      )?.id ?? null
    );
  },
};

/** Lecture « présence physique » : EXCUSED compte comme absent ; taux en % entier, null sans séance. */
export function presenceRate(present: number, sessions: number): number | null {
  return sessions === 0 ? null : Math.round((present / sessions) * 100);
}
