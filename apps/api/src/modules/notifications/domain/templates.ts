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
  | 'SMS_CAP_WARNING'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_REVERSED'
  | 'INSTALLMENT_DUE_SOON'
  | 'INSTALLMENT_OVERDUE'
  | 'LEDGER_INTEGRITY'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_REVIEW_NEEDED';

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
  paymentReceived(p: {
    tenantName: string;
    firstName: string;
    amount: number;
    receiptNumber: string;
    credit: number;
  }): Rendered {
    return {
      title: 'Paiement reçu',
      body: clip(
        `${p.tenantName} : paiement de ${xof(p.amount)} reçu pour ${p.firstName}. Reçu n° ${p.receiptNumber}.${p.credit > 0 ? ` Trop-perçu ${xof(p.credit)} porté en crédit.` : ''}`,
        160,
      ),
      actionUrl: '/children',
    };
  },
  paymentReversed(p: {
    tenantName: string;
    firstName: string;
    amount: number;
    receiptNumber: string;
  }): Rendered {
    return {
      title: 'Paiement annulé',
      body: clip(
        `${p.tenantName} : le paiement de ${xof(p.amount)} pour ${p.firstName} a été annulé (reçu d'annulation ${p.receiptNumber}). Contactez la caisse.`,
        160,
      ),
      actionUrl: '/children',
    };
  },
  /** Un SMS par tuteur : toutes les échéances de ses enfants concernées ce jour. */
  installmentsReminder(p: {
    tenantName: string;
    kind: 'DUE_SOON' | 'OVERDUE';
    items: { firstName: string; amount: number; dueDate: string; label: string }[];
    message?: string;
  }): Rendered {
    const total = p.items.reduce((s, i) => s + i.amount, 0);
    const names = [...new Set(p.items.map((i) => i.firstName))].join(', ');
    const first = p.items[0];
    const body =
      p.kind === 'DUE_SOON'
        ? `${p.tenantName} : ${xof(total)} à régler pour ${names} avant le ${fr(first?.dueDate ?? '')} (${p.items.length} échéance${p.items.length > 1 ? 's' : ''}).`
        : `${p.tenantName} : ${xof(total)} en retard de paiement pour ${names}${p.message ? ` — ${p.message}` : ''}. Merci de régulariser.`;
    return {
      title: p.kind === 'DUE_SOON' ? 'Échéance à venir' : 'Retard de paiement',
      body: clip(body, 160),
      actionUrl: '/children',
    };
  },
  ledgerIntegrity(p: { mismatches: number }): Rendered {
    return {
      title: 'Contrôle du grand-livre',
      body: `${p.mismatches} écart(s) détecté(s) entre montants stockés et recalculés : vérifier le journal.`,
      actionUrl: '/finance',
    };
  },
  paymentFailed(p: {
    tenantName: string;
    firstName: string;
    amount: number;
    status: 'FAILED' | 'CANCELLED' | 'EXPIRED';
  }): Rendered {
    const why =
      p.status === 'CANCELLED'
        ? 'a été annulé'
        : p.status === 'EXPIRED'
          ? 'a expiré (délai dépassé)'
          : "n'a pas abouti";
    return {
      title: 'Paiement non abouti',
      body: clip(
        `${p.tenantName} : votre paiement de ${xof(p.amount)} pour ${p.firstName} ${why}. Aucun montant n'a été prélevé par Polaris ; vous pouvez réessayer.`,
        160,
      ),
      actionUrl: '/children',
    };
  },
  paymentReviewNeeded(p: {
    reason: 'UNKNOWN_STATUS' | 'AMOUNT_MISMATCH' | 'ORPHAN_TRANSACTION' | 'PROVIDER_MUTE';
    amount: number | null;
    externalId: string | null;
  }): Rendered {
    const label: Record<typeof p.reason, string> = {
      UNKNOWN_STATUS: 'statut provider inconnu',
      AMOUNT_MISMATCH: 'montant confirmé différent du montant demandé',
      ORPHAN_TRANSACTION: 'paiement réussi chez le provider sans tentative connue',
      PROVIDER_MUTE: 'provider muet après expiration',
    };
    return {
      title: 'Transaction à traiter',
      body: `${label[p.reason]}${p.amount !== null ? ` — ${xof(p.amount)}` : ''}${p.externalId ? ` (réf. ${p.externalId})` : ''}. Voir « Transactions en attente ».`,
      actionUrl: '/finance/payments/pending',
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
  PAYMENT_RECEIVED: ['SMS', 'INAPP'],
  PAYMENT_REVERSED: ['SMS', 'INAPP'],
  INSTALLMENT_DUE_SOON: ['SMS', 'INAPP'],
  INSTALLMENT_OVERDUE: ['SMS', 'INAPP'],
  LEDGER_INTEGRITY: ['INAPP', 'EMAIL'],
  PAYMENT_FAILED: ['INAPP'],
  PAYMENT_REVIEW_NEEDED: ['INAPP', 'EMAIL'],
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

const xof = (n: number) => `${n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} FCFA`;

export function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
function fr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
