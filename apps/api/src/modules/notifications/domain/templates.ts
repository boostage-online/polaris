/**
 * Gabarits des notifications (français, SMS ≤ 160 caractères visés). Purs : testables sans infrastructure.
 * Les variables sont typées par type de notification ; le rendu est identique pour tous les canaux,
 * l'in-app affichant titre + corps, le SMS le corps seul.
 */
export type NotificationKind =
  | 'STUDENT_ABSENT'
  | 'STUDENT_LATE'
  | 'JUSTIFICATION_REVIEWED'
  | 'JUSTIFICATION_SUBMITTED'
  | 'REPEATED_ABSENCES'
  | 'ATTENDANCE_SHEET_MISSING'
  | 'SMS_CAP_WARNING';

export type NotificationChannel = 'SMS' | 'EMAIL' | 'PUSH' | 'INAPP';

export interface Rendered {
  title: string;
  body: string;
  actionUrl: string | null;
}

export interface ChildMark {
  firstName: string;
  status: 'ABSENT' | 'LATE';
  lateMinutes: number | null;
  subjectName: string;
}

const time = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(
    new Date(iso),
  );
const day = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: tz }).format(
    new Date(iso),
  );

export const Templates = {
  /** Un SMS par tuteur et par appel : tous ses enfants concernés y figurent (agrégation). */
  attendanceMarked(p: {
    tenantName: string;
    startsAt: string;
    tz: string;
    children: ChildMark[];
  }): Rendered {
    const when = `${day(p.startsAt, p.tz)} ${time(p.startsAt, p.tz)}`;
    const parts = p.children.map((c) =>
      c.status === 'ABSENT'
        ? `${c.firstName} absent(e) en ${c.subjectName}`
        : `${c.firstName} en retard (${c.lateMinutes ?? '?'} min) en ${c.subjectName}`,
    );
    const absent = p.children.some((c) => c.status === 'ABSENT');
    return {
      title: absent ? 'Absence signalée' : 'Retard signalé',
      body: clip(`${p.tenantName} — ${when} : ${parts.join(' ; ')}.`, 160),
      actionUrl: '/children',
    };
  },
  justificationReviewed(p: {
    firstName: string;
    decision: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED';
    comment: string | null;
    fromDate: string;
    toDate: string;
  }): Rendered {
    const range =
      p.fromDate === p.toDate ? `du ${fr(p.fromDate)}` : `du ${fr(p.fromDate)} au ${fr(p.toDate)}`;
    const verdict =
      p.decision === 'APPROVED'
        ? 'accepté'
        : p.decision === 'REJECTED'
          ? 'refusé'
          : 'en attente de complément';
    return {
      title: `Justificatif ${verdict}`,
      body: clip(
        `Le justificatif de ${p.firstName} ${range} est ${verdict}${p.comment ? ` : ${p.comment}` : ''}.`,
        160,
      ),
      actionUrl: '/children',
    };
  },
  justificationSubmitted(p: {
    firstName: string;
    lastName: string;
    fromDate: string;
    toDate: string;
    byGuardian: boolean;
  }): Rendered {
    return {
      title: 'Justificatif à traiter',
      body: `${p.lastName} ${p.firstName} — ${fr(p.fromDate)} → ${fr(p.toDate)}${p.byGuardian ? ' (déposé par un parent)' : ''}.`,
      actionUrl: '/justifications',
    };
  },
  repeatedAbsences(p: {
    firstName: string;
    lastName: string;
    count: number;
    windowDays: number;
    forGuardian: boolean;
  }): Rendered {
    return {
      title: p.forGuardian ? 'Absences répétées' : 'Élève à surveiller',
      body: p.forGuardian
        ? clip(
            `${p.firstName} compte ${p.count} absences non justifiées sur ${p.windowDays} jours. Merci de contacter l'établissement.`,
            160,
          )
        : `${p.lastName} ${p.firstName} : ${p.count} absences non justifiées sur ${p.windowDays} jours.`,
      actionUrl: p.forGuardian ? '/children' : '/attendance/watchlist',
    };
  },
  sheetMissing(p: {
    subjectName: string;
    groupName: string;
    startsAt: string;
    tz: string;
    sessionId: string;
  }): Rendered {
    return {
      title: 'Appel non fait',
      body: `${p.subjectName} — ${p.groupName}, ${day(p.startsAt, p.tz)} ${time(p.startsAt, p.tz)} : la feuille d'appel n'a pas été soumise.`,
      actionUrl: `/attendance/sessions/${p.sessionId}`,
    };
  },
  smsCapWarning(p: { sent: number; cap: number; month: string }): Rendered {
    return {
      title: 'Quota SMS bientôt atteint',
      body: `${p.sent} SMS envoyés sur ${p.cap} pour ${p.month}. Au-delà, les SMS seront suspendus (in-app conservé).`,
      actionUrl: '/notifications',
    };
  },
};

/** Canaux par défaut par type de notification ; les préférences utilisateur les remplacent (hors PUSH, V1). */
export const DEFAULT_CHANNELS: Record<NotificationKind, NotificationChannel[]> = {
  STUDENT_ABSENT: ['SMS', 'INAPP'],
  STUDENT_LATE: ['INAPP'],
  JUSTIFICATION_REVIEWED: ['SMS', 'INAPP'],
  JUSTIFICATION_SUBMITTED: ['INAPP'],
  REPEATED_ABSENCES: ['SMS', 'INAPP'],
  ATTENDANCE_SHEET_MISSING: ['INAPP'],
  SMS_CAP_WARNING: ['INAPP', 'EMAIL'],
};

/** Résout les canaux effectifs : préférence si présente, sinon défaut ; l'in-app est toujours conservé. */
export function resolveChannels(
  kind: NotificationKind,
  preferred: NotificationChannel[] | undefined,
): NotificationChannel[] {
  const base = preferred ?? DEFAULT_CHANNELS[kind];
  const set = new Set<NotificationChannel>(base.filter((c) => c !== 'PUSH'));
  set.add('INAPP');
  return [...set];
}

export function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
function fr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
