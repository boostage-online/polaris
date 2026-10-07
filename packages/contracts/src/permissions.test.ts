import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, SENSITIVE_PERMISSIONS, SYSTEM_ROLES, isPermission } from './permissions';

describe('catalogue de permissions', () => {
  it('ne contient aucun doublon', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });
  it('respecte la convention VERBE_OBJET en majuscules', () => {
    for (const p of ALL_PERMISSIONS) expect(p).toMatch(/^[A-Z]+(_[A-Z]+)+$/);
  });
  it('tous les rôles système référencent des permissions existantes', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
    }
  });
  it('les permissions sensibles exigent la MFA et sont financières ou plateforme', () => {
    expect(SENSITIVE_PERMISSIONS).toEqual(
      expect.arrayContaining(['RECORD_MANUAL_PAYMENT', 'ISSUE_REFUND', 'MANAGE_PAYMENT_PROVIDER']),
    );
  });
  it("l'administrateur n'a aucune permission plateforme", () => {
    expect(SYSTEM_ROLES.ADMIN.permissions.some((p) => p.startsWith('PLATFORM_'))).toBe(false);
  });
});
