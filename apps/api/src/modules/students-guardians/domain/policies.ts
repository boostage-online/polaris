/** Règles pures du module élèves/tuteurs (ADR-0007, question 3). */

export type GuardianRight = 'attendance' | 'finance' | 'pay' | 'justify';

export interface LinkFlags {
  canViewAttendance: boolean;
  canViewFinance: boolean;
  canPay: boolean;
  canJustify: boolean;
  unlinkedAt: Date | string | null;
}

export const GuardianPolicy = {
  /** Un tuteur n'accède à un élève que par un lien actif portant le droit demandé. */
  canAccess(link: LinkFlags | null | undefined, right: GuardianRight): boolean {
    if (!link || link.unlinkedAt) return false;
    switch (right) {
      case 'attendance':
        return link.canViewAttendance;
      case 'finance':
        return link.canViewFinance;
      case 'pay':
        return link.canPay && link.canViewFinance;
      case 'justify':
        return link.canJustify && link.canViewAttendance;
    }
  },
};

export const MatriculePolicy = {
  /** Matricule généré : {ANNÉE}-{SEQ:5}, unique par tenant (garanti par la contrainte). */
  generate(yearLabel: string, seq: number): string {
    const year = (yearLabel.match(/\d{4}/)?.[0] ?? String(new Date().getFullYear())).slice(0, 4);
    return `${year}-${String(seq).padStart(5, '0')}`;
  },
};

/** Normalisation des téléphones béninois et internationaux vers E.164 (import, saisie). */
export function normalizePhone(raw: string, defaultCountryCode = '229'): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) {
    // Ancien format béninois (+229 + 8 chiffres) : on insère le préfixe 01 pour ne pas dédoubler un parent.
    if (/^\+229\d{8}$/.test(digits)) return `+22901${digits.slice(4)}`;
    return /^\+[1-9]\d{6,14}$/.test(digits) ? digits : null;
  }
  if (digits.startsWith('00')) return normalizePhone(`+${digits.slice(2)}`, defaultCountryCode);
  const local = digits.replace(/^0+/, '');
  if (local.length < 7) return null;
  // Bénin : numéros à 10 chiffres depuis 2024 (préfixe 01), 8 chiffres avant ; on ajoute 01 si 8 chiffres.
  if (defaultCountryCode === '229' && local.length === 8) return `+229 01${local}`.replace(' ', '');
  return `+${defaultCountryCode}${local}`;
}

/** Candidats doublons : même nom (insensible aux accents/casse) et même date de naissance, ou même téléphone. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
