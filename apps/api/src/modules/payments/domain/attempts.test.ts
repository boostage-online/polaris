import { describe, expect, it } from 'vitest';
import {
  mapFedaPayStatus,
  mapKKiaPayStatus,
  nextCheckDelayMs,
  nextStatus,
  paymentRulesFrom,
  validateAmount,
} from './attempts';

describe('mappings de statuts provider → interne', () => {
  it('FedaPay : table de la Partie 10, inconnu → UNKNOWN', () => {
    expect(mapFedaPayStatus('pending')).toBe('PENDING');
    expect(mapFedaPayStatus('approved')).toBe('SUCCEEDED');
    expect(mapFedaPayStatus('transferred')).toBe('SUCCEEDED');
    expect(mapFedaPayStatus('declined')).toBe('FAILED');
    expect(mapFedaPayStatus('canceled')).toBe('CANCELLED');
    expect(mapFedaPayStatus('expired')).toBe('EXPIRED');
    expect(mapFedaPayStatus('refunded')).toBe('SUCCEEDED');
    expect(mapFedaPayStatus('quelque-chose')).toBe('UNKNOWN');
    expect(mapFedaPayStatus(null)).toBe('UNKNOWN');
  });
  it('KKiaPay : SUCCESS / FAILED / PENDING, inconnu → UNKNOWN', () => {
    expect(mapKKiaPayStatus('SUCCESS')).toBe('SUCCEEDED');
    expect(mapKKiaPayStatus('failed')).toBe('FAILED');
    expect(mapKKiaPayStatus('PENDING')).toBe('PENDING');
    expect(mapKKiaPayStatus('bizarre')).toBe('UNKNOWN');
  });
});

describe('machine d’états des tentatives', () => {
  const now = new Date('2026-10-07T10:00:00Z');
  const expires = new Date('2026-10-07T10:30:00Z');
  it('un statut terminal ne bouge plus (confirmations concurrentes idempotentes)', () => {
    expect(nextStatus('SUCCEEDED', 'FAILED', now, expires)).toBeNull();
    expect(nextStatus('FAILED', 'SUCCEEDED', now, expires)).toBeNull();
    expect(nextStatus('EXPIRED', 'SUCCEEDED', now, expires)).toBeNull();
  });
  it('seul SUCCEEDED vérifié mène à SUCCEEDED ; PENDING → PROCESSING une fois', () => {
    expect(nextStatus('PENDING', 'SUCCEEDED', now, expires)).toBe('SUCCEEDED');
    expect(nextStatus('PENDING', 'PENDING', now, expires)).toBe('PROCESSING');
    expect(nextStatus('PROCESSING', 'PENDING', now, expires)).toBeNull();
    expect(nextStatus('PROCESSING', 'FAILED', now, expires)).toBe('FAILED');
    expect(nextStatus('PENDING', 'CANCELLED', now, expires)).toBe('CANCELLED');
    expect(nextStatus('PENDING', 'UNKNOWN', now, expires)).toBe('UNKNOWN');
  });
  it('NOT_FOUND : on attend jusqu’à expiration + 24 h, puis EXPIRED', () => {
    expect(nextStatus('PENDING', 'NOT_FOUND', now, expires)).toBeNull();
    const later = new Date(expires.getTime() + 25 * 3_600_000);
    expect(nextStatus('PENDING', 'NOT_FOUND', later, expires)).toBe('EXPIRED');
  });
  it('backoff de réconciliation croissant', () => {
    const d = [0, 1, 2, 3, 4, 5, 9].map(nextCheckDelayMs);
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThanOrEqual(d[i - 1]!);
    expect(d[0]).toBe(2 * 60_000);
  });
});

describe('règles de montant', () => {
  const rules = paymentRulesFrom({ payments: { minAmount: 500 } });
  it('min ≤ montant ≤ solde', () => {
    expect(validateAmount(500, 10_000, rules).ok).toBe(true);
    expect(validateAmount(10_000, 10_000, rules).ok).toBe(true);
    expect(validateAmount(499, 10_000, rules).ok).toBe(false);
    expect(validateAmount(10_001, 10_000, rules).ok).toBe(false);
    expect(validateAmount(500, 0, rules).ok).toBe(false);
    expect(validateAmount(500.5, 10_000, rules).ok).toBe(false);
  });
  it('le surplus est autorisé si le tenant l’accepte (devient crédit)', () => {
    expect(validateAmount(20_000, 10_000, { ...rules, allowOverpayment: true }).ok).toBe(true);
  });
  it('valeurs par défaut', () => {
    expect(paymentRulesFrom(null)).toEqual({ minAmount: 100, allowOverpayment: false });
  });
});
