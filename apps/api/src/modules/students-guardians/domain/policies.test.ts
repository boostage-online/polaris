import { describe, expect, it } from 'vitest';
import { GuardianPolicy, MatriculePolicy, normalizeName, normalizePhone } from './policies';

describe('GuardianPolicy', () => {
  const link = {
    canViewAttendance: true,
    canViewFinance: false,
    canPay: true,
    canJustify: true,
    unlinkedAt: null,
  };
  it('respecte les drapeaux et refuse un lien délié', () => {
    expect(GuardianPolicy.canAccess(link, 'attendance')).toBe(true);
    expect(GuardianPolicy.canAccess(link, 'finance')).toBe(false);
    expect(GuardianPolicy.canAccess(link, 'pay')).toBe(false); // payer exige de voir la finance
    expect(GuardianPolicy.canAccess({ ...link, unlinkedAt: new Date() }, 'attendance')).toBe(false);
    expect(GuardianPolicy.canAccess(null, 'attendance')).toBe(false);
  });
});

describe('normalisation', () => {
  it('téléphones béninois et internationaux', () => {
    expect(normalizePhone('97 12 34 56')).toBe('+2290197123456');
    expect(normalizePhone('0197123456')).toBe('+2290197123456');
    expect(normalizePhone('+229 01 97 12 34 56')).toBe('+2290197123456');
    expect(normalizePhone('+229 97 12 34 56')).toBe('+2290197123456');
    expect(normalizePhone('0033612345678')).toBe('+33612345678');
    expect(normalizePhone('abc')).toBeNull();
  });
  it('noms sans accents ni casse', () => {
    expect(normalizeName('  Kévin  D’ALMEIDA ')).toBe('kevin d almeida');
  });
  it('matricule généré', () => {
    expect(MatriculePolicy.generate('2026-2027', 42)).toBe('2026-00042');
  });
});
