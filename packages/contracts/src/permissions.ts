/**
 * Catalogue global des permissions (ADR-0007).
 *
 * Source de vérité unique : la table `permissions` est synchronisée depuis ce fichier par
 * migration/seed, jamais depuis l'interface. Une faute de frappe est une erreur de compilation.
 *
 * Convention : `VERBE_OBJET`, suffixe `_ANY` pour la portée globale (hors de « ses » cours/classes).
 */
export const PERMISSION_DEFINITIONS = [
  // --- Tenant / configuration ---
  {
    code: 'MANAGE_TENANT_SETTINGS',
    module: 'tenancy',
    description: "Modifier les paramètres de l'établissement",
  },
  {
    code: 'MANAGE_ACADEMIC_STRUCTURE',
    module: 'academic',
    description: 'Gérer années, programmes, niveaux, groupes, matières',
  },
  {
    code: 'MANAGE_SCHEDULES',
    module: 'academic',
    description: 'Gérer cours, emplois du temps et séances',
  },
  {
    code: 'MANAGE_USERS',
    module: 'identity',
    description: 'Inviter et gérer les membres du personnel',
  },
  {
    code: 'RESET_USER_MFA',
    module: 'identity',
    description: "Réinitialiser la double authentification d'un membre (identité vérifiée)",
    sensitive: true,
  },
  {
    code: 'MANAGE_ROLES',
    module: 'identity',
    description: 'Attribuer des rôles et modifier leurs permissions',
  },
  { code: 'VIEW_AUDIT_LOG', module: 'audit', description: "Consulter le journal d'audit" },

  // --- Élèves et tuteurs ---
  { code: 'VIEW_STUDENTS', module: 'students-guardians', description: 'Consulter les élèves' },
  {
    code: 'MANAGE_PRIVACY',
    module: 'students-guardians',
    description: 'Exporter ou anonymiser les données personnelles (RGPD)',
  },
  { code: 'CREATE_STUDENT', module: 'students-guardians', description: 'Créer un élève' },
  { code: 'EDIT_STUDENT', module: 'students-guardians', description: 'Modifier un élève' },
  {
    code: 'IMPORT_STUDENTS',
    module: 'students-guardians',
    description: 'Importer élèves et tuteurs',
  },
  {
    code: 'MANAGE_ENROLLMENTS',
    module: 'students-guardians',
    description: 'Inscrire, changer de classe, clôturer',
  },
  {
    code: 'MANAGE_GUARDIANS',
    module: 'students-guardians',
    description: 'Créer et modifier les tuteurs',
  },
  {
    code: 'LINK_GUARDIAN',
    module: 'students-guardians',
    description: 'Lier ou délier un tuteur et un élève',
  },

  // --- Assiduité ---
  {
    code: 'VIEW_ATTENDANCE',
    module: 'attendance',
    description: "Consulter l'assiduité de ses cours",
  },
  {
    code: 'VIEW_ATTENDANCE_ANY',
    module: 'attendance',
    description: "Consulter l'assiduité de tout l'établissement",
  },
  { code: 'TAKE_ATTENDANCE', module: 'attendance', description: "Faire l'appel de ses cours" },
  {
    code: 'TAKE_ATTENDANCE_ANY',
    module: 'attendance',
    description: "Faire l'appel de n'importe quelle séance",
  },
  {
    code: 'EDIT_ATTENDANCE',
    module: 'attendance',
    description: 'Corriger un appel dans la fenêtre autorisée',
  },
  {
    code: 'EDIT_ATTENDANCE_LOCKED',
    module: 'attendance',
    description: 'Corriger un appel hors fenêtre ou verrouillé',
  },
  {
    code: 'REVIEW_JUSTIFICATION',
    module: 'attendance',
    description: 'Accepter ou refuser un justificatif',
  },
  {
    code: 'VIEW_ATTENDANCE_REPORTS',
    module: 'attendance',
    description: "Consulter les rapports d'assiduité",
  },

  // --- Finance ---
  { code: 'VIEW_FEES', module: 'billing', description: 'Consulter les frais et créances' },
  {
    code: 'MANAGE_FEE_STRUCTURES',
    module: 'billing',
    description: 'Créer et modifier les grilles de frais',
  },
  { code: 'ASSIGN_FEES', module: 'billing', description: 'Affecter des frais à des élèves' },
  { code: 'ADJUST_FEES', module: 'billing', description: 'Émettre un ajustement de créance' },
  { code: 'VIEW_PAYMENTS', module: 'payments', description: 'Consulter les paiements' },
  {
    code: 'RECORD_MANUAL_PAYMENT',
    module: 'billing',
    description: 'Enregistrer un paiement manuel',
    sensitive: true,
  },
  {
    code: 'CANCEL_PAYMENT',
    module: 'billing',
    description: 'Annuler un paiement (écriture compensatoire)',
    sensitive: true,
  },
  {
    code: 'ISSUE_REFUND',
    module: 'payments',
    description: 'Émettre un remboursement',
    sensitive: true,
  },
  {
    code: 'VIEW_FINANCIAL_REPORTS',
    module: 'reporting',
    description: 'Consulter les rapports financiers',
  },
  {
    code: 'SEND_PAYMENT_REMINDER',
    module: 'billing',
    description: 'Envoyer un rappel de paiement',
  },
  {
    code: 'MANAGE_PAYMENT_PROVIDER',
    module: 'payments',
    description: 'Configurer le provider de paiement',
    sensitive: true,
  },
  {
    code: 'EXPORT_FINANCIAL_DATA',
    module: 'reporting',
    description: 'Exporter les données financières',
  },

  // --- Rapports généraux ---
  {
    code: 'VIEW_REPORTS',
    module: 'reporting',
    description: 'Consulter les tableaux de bord de direction',
  },

  // --- Plateforme (Super Admin) ---
  {
    code: 'PLATFORM_MANAGE_TENANTS',
    module: 'platform',
    description: 'Créer, activer, suspendre des établissements',
  },
  {
    code: 'PLATFORM_VIEW_METRICS',
    module: 'platform',
    description: 'Consulter les métriques de la plateforme',
  },
  {
    code: 'PLATFORM_IMPERSONATE',
    module: 'platform',
    description: 'Impersonner un membre (tracé, limité)',
    sensitive: true,
  },
] as const;

export type Permission = (typeof PERMISSION_DEFINITIONS)[number]['code'];

export const PERMISSIONS = Object.freeze(
  Object.fromEntries(PERMISSION_DEFINITIONS.map((p) => [p.code, p.code])) as {
    [K in Permission]: K;
  },
);

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_DEFINITIONS.map((p) => p.code);

/** Permissions exigeant la MFA TOTP (ADR-0008). */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = PERMISSION_DEFINITIONS.filter(
  (p): p is typeof p & { sensitive: true } => 'sensitive' in p && p.sensitive === true,
).map((p) => p.code);

/**
 * Permissions d'une session d'impersonation Super Admin (Partie 11) : celles de l'administrateur,
 * moins toute action financière ou sensible — le support regarde et configure, il n'encaisse pas.
 */
export const IMPERSONATION_EXCLUDED: readonly Permission[] = [
  ...SENSITIVE_PERMISSIONS,
  'RECORD_MANUAL_PAYMENT',
  'CANCEL_PAYMENT',
  'ISSUE_REFUND',
  'MANAGE_PAYMENT_PROVIDER',
  'MANAGE_PRIVACY',
];

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Rôles système copiés dans chaque nouveau tenant (ADR-0007).
 * Modifiables et duplicables par l'administrateur, sauf `ADMIN` dont les permissions sont figées.
 */
export const SYSTEM_ROLES = {
  ADMIN: {
    name: 'Administrateur',
    description: "Configuration complète de l'établissement",
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith('PLATFORM_')),
  },
  REGISTRAR: {
    name: 'Scolarité',
    description: 'Élèves, inscriptions, tuteurs, imports',
    permissions: [
      'VIEW_STUDENTS',
      'CREATE_STUDENT',
      'EDIT_STUDENT',
      'IMPORT_STUDENTS',
      'MANAGE_ENROLLMENTS',
      'MANAGE_GUARDIANS',
      'LINK_GUARDIAN',
      'VIEW_ATTENDANCE_ANY',
    ],
  },
  TEACHER: {
    name: 'Enseignant',
    description: "Appel et consultation de l'assiduité de ses cours",
    permissions: ['VIEW_ATTENDANCE', 'TAKE_ATTENDANCE', 'EDIT_ATTENDANCE', 'VIEW_STUDENTS'],
  },
  STUDENT_LIFE: {
    name: 'Vie scolaire',
    description: 'Absences, retards, justificatifs, corrections',
    permissions: [
      'VIEW_STUDENTS',
      'VIEW_ATTENDANCE_ANY',
      'TAKE_ATTENDANCE_ANY',
      'EDIT_ATTENDANCE',
      'EDIT_ATTENDANCE_LOCKED',
      'REVIEW_JUSTIFICATION',
      'VIEW_ATTENDANCE_REPORTS',
    ],
  },
  ACADEMIC_HEAD: {
    name: 'Responsable pédagogique',
    description: "Analyse de l'assiduité",
    permissions: [
      'VIEW_STUDENTS',
      'VIEW_ATTENDANCE_ANY',
      'VIEW_ATTENDANCE_REPORTS',
      'VIEW_REPORTS',
    ],
  },
  DIRECTION: {
    name: 'Direction',
    description: 'KPI et rapports de synthèse',
    permissions: [
      'VIEW_STUDENTS',
      'VIEW_ATTENDANCE_ANY',
      'VIEW_ATTENDANCE_REPORTS',
      'VIEW_REPORTS',
      'VIEW_FEES',
      'VIEW_PAYMENTS',
      'VIEW_FINANCIAL_REPORTS',
      'VIEW_AUDIT_LOG',
    ],
  },
  FINANCE: {
    name: 'Caisse / Finance',
    description: 'Frais, encaissements, impayés, rappels',
    permissions: [
      'VIEW_STUDENTS',
      'VIEW_FEES',
      'MANAGE_FEE_STRUCTURES',
      'ASSIGN_FEES',
      'ADJUST_FEES',
      'VIEW_PAYMENTS',
      'RECORD_MANUAL_PAYMENT',
      'CANCEL_PAYMENT',
      'VIEW_FINANCIAL_REPORTS',
      'SEND_PAYMENT_REMINDER',
      'EXPORT_FINANCIAL_DATA',
    ],
  },
} as const satisfies Record<
  string,
  { name: string; description: string; permissions: readonly Permission[] }
>;

export type SystemRoleCode = keyof typeof SYSTEM_ROLES;
export const SYSTEM_ROLE_CODES = Object.keys(SYSTEM_ROLES) as SystemRoleCode[];
