import { describe, expect, it } from 'vitest';
import { LockoutPolicy, RolePolicy } from './policies';

describe('RolePolicy', () => {
  it('refuse de modifier un rôle verrouillé', () => {
    expect(RolePolicy.canEditPermissions({ isLocked: true })).toBe(false);
    expect(RolePolicy.canEditPermissions({ isLocked: false })).toBe(true);
  });
  it('protège le dernier détenteur de MANAGE_ROLES', () => {
    expect(RolePolicy.canRemoveManageRoles(0)).toBe(false);
    expect(RolePolicy.canRemoveManageRoles(1)).toBe(true);
  });
  it('rejette les permissions inconnues et plateforme', () => {
    const known = new Set(['VIEW_STUDENTS', 'PLATFORM_MANAGE_TENANTS']);
    expect(RolePolicy.validateTenantPermissions(['VIEW_STUDENTS'], known)).toEqual([]);
    expect(RolePolicy.validateTenantPermissions(['NOPE'], known)).toHaveLength(1);
    expect(RolePolicy.validateTenantPermissions(['PLATFORM_MANAGE_TENANTS'], known)).toHaveLength(
      1,
    );
  });
});

describe('LockoutPolicy', () => {
  it('ne verrouille pas avant 5 échecs puis croît exponentiellement', () => {
    expect(LockoutPolicy.delaySeconds(4)).toBe(0);
    expect(LockoutPolicy.delaySeconds(5)).toBe(2);
    expect(LockoutPolicy.delaySeconds(6)).toBe(4);
    expect(LockoutPolicy.delaySeconds(20)).toBe(900);
  });
});
