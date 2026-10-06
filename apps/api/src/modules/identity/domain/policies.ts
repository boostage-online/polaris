import type { Permission } from '@polaris/contracts';

/**
 * Règles d'autorisation pures (ADR-0007). Testées unitairement, sans NestJS ni base.
 */
export const RolePolicy = {
  /** Un rôle verrouillé (ADMIN) ne change pas de permissions. */
  canEditPermissions(role: { isLocked: boolean }): boolean {
    return !role.isLocked;
  },

  /**
   * Retirer MANAGE_ROLES n'est autorisé que s'il reste au moins un autre membre actif qui le détient.
   * `holdersAfterChange` = nombre de membres (hors celui modifié) détenant encore la permission.
   */
  canRemoveManageRoles(holdersAfterChange: number): boolean {
    return holdersAfterChange >= 1;
  },

  /** Les permissions d'un rôle doivent toutes exister et ne jamais inclure de permission plateforme. */
  validateTenantPermissions(permissions: readonly string[], known: ReadonlySet<string>): string[] {
    const errors: string[] = [];
    for (const p of permissions) {
      if (!known.has(p)) errors.push(`Permission inconnue : ${p}`);
      else if (p.startsWith('PLATFORM_')) errors.push(`Permission réservée à la plateforme : ${p}`);
    }
    return errors;
  },

  /** Séparation des tâches : les futures policies finance l'étendront (saisir ≠ annuler). */
  conflicting(permissions: readonly Permission[]): string[] {
    const set = new Set(permissions);
    const warnings: string[] = [];
    if (set.has('RECORD_MANUAL_PAYMENT') && set.has('CANCEL_PAYMENT')) {
      warnings.push(
        'RECORD_MANUAL_PAYMENT et CANCEL_PAYMENT sur le même rôle : la policy finance refusera la même personne sur le même paiement',
      );
    }
    return warnings;
  },
};

export const LockoutPolicy = {
  /** Délai (s) avant nouvel essai après `failures` échecs consécutifs : 0 jusqu'à 4, puis 2^n s plafonné à 15 min. */
  delaySeconds(failures: number): number {
    if (failures < 5) return 0;
    return Math.min(2 ** (failures - 4), 900);
  },
  maxIpFailuresPerHour: 20,
  otpMaxAttempts: 5,
  otpTtlSeconds: 300,
  otpMaxSendsPerHour: 3,
};
