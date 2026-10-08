import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BILLING_RULES,
  feeStatus,
  installmentStatus,
  planAllocation,
  receiptNumber,
  reminderKindFor,
  remaining,
} from './ledger';

const R = DEFAULT_BILLING_RULES;
const inst = (
  o: Partial<{
    amountDue: number;
    adjustmentsTotal: number;
    amountAllocated: number;
    dueDate: string;
  }>,
) => ({
  amountDue: 10_000,
  adjustmentsTotal: 0,
  amountAllocated: 0,
  dueDate: '2026-10-15',
  ...o,
});

describe('Statuts dérivés (ADR-0005)', () => {
  it('échéance : PENDING avant la date, DUE le jour, OVERDUE après la grâce, PARTIALLY_PAID, PAID', () => {
    expect(installmentStatus(inst({}), '2026-10-01', R)).toBe('PENDING');
    expect(installmentStatus(inst({}), '2026-10-15', R)).toBe('DUE');
    expect(installmentStatus(inst({}), '2026-10-16', R)).toBe('OVERDUE');
    expect(installmentStatus(inst({}), '2026-10-17', { ...R, graceDays: 5 })).toBe('DUE');
    expect(installmentStatus(inst({ amountAllocated: 4_000 }), '2026-10-20', R)).toBe(
      'PARTIALLY_PAID',
    );
    expect(installmentStatus(inst({ amountAllocated: 10_000 }), '2026-10-20', R)).toBe('PAID');
  });
  it('un ajustement réduit le dû ; ajustée à zéro sans paiement → CANCELLED ; une remise peut solder', () => {
    expect(installmentStatus(inst({ adjustmentsTotal: -10_000 }), '2026-10-20', R)).toBe(
      'CANCELLED',
    );
    expect(
      installmentStatus(
        inst({ adjustmentsTotal: -6_000, amountAllocated: 4_000 }),
        '2026-10-20',
        R,
      ),
    ).toBe('PAID');
    expect(remaining(inst({ adjustmentsTotal: -2_000, amountAllocated: 5_000 }))).toBe(3_000);
    expect(remaining(inst({ amountAllocated: 12_000 }))).toBe(0);
  });
  it('créance : OPEN / PARTIALLY_PAID / PAID / CANCELLED', () => {
    expect(feeStatus(['PENDING', 'PENDING'], 20_000, 0)).toBe('OPEN');
    expect(feeStatus(['PAID', 'PENDING'], 20_000, 10_000)).toBe('PARTIALLY_PAID');
    expect(feeStatus(['PAID', 'PAID'], 20_000, 20_000)).toBe('PAID');
    expect(feeStatus(['CANCELLED'], 0, 0)).toBe('CANCELLED');
  });
});

describe("Plan d'allocation", () => {
  const open = [
    { id: 'b', seq: 2, ...inst({ dueDate: '2026-11-15' }) },
    { id: 'a', seq: 1, ...inst({ dueDate: '2026-10-15', amountAllocated: 2_500 }) },
    { id: 'c', seq: 3, ...inst({ dueDate: '2026-12-15' }) },
  ];
  it('les plus anciennes d’abord, partiel puis reliquat en crédit', () => {
    const p = planAllocation(20_000, open);
    expect(p.lines).toEqual([
      { installmentId: 'a', amount: 7_500 },
      { installmentId: 'b', amount: 10_000 },
      { installmentId: 'c', amount: 2_500 },
    ]);
    expect(p.remainder).toBe(0);
    expect(planAllocation(40_000, open).remainder).toBe(12_500);
  });
  it('les échéances ciblées passent devant, dans l’ordre donné', () => {
    const p = planAllocation(12_000, open, ['c', 'b']);
    expect(p.lines).toEqual([
      { installmentId: 'c', amount: 10_000 },
      { installmentId: 'b', amount: 2_000 },
    ]);
  });
  it('un paiement sans échéance ouverte devient entièrement un crédit', () => {
    expect(planAllocation(5_000, [])).toEqual({ lines: [], remainder: 5_000 });
  });
});

describe('Reçus et rappels', () => {
  it('numérotation {CODE}-{ANNEE}-{SEQ:6}', () => {
    expect(receiptNumber('lycee-demo', 2026, 7)).toBe('LYCEE-DEMO-2026-000007');
  });
  it('rappels J−7, J−1, J+1 puis toutes les 2 semaines', () => {
    expect(reminderKindFor('2026-10-15', '2026-10-08', R)).toBe('DUE_SOON');
    expect(reminderKindFor('2026-10-15', '2026-10-14', R)).toBe('DUE_SOON');
    expect(reminderKindFor('2026-10-15', '2026-10-10', R)).toBeNull();
    expect(reminderKindFor('2026-10-15', '2026-10-15', R)).toBeNull();
    expect(reminderKindFor('2026-10-15', '2026-10-16', R)).toBe('OVERDUE');
    expect(reminderKindFor('2026-10-15', '2026-10-20', R)).toBeNull();
    expect(reminderKindFor('2026-10-15', '2026-10-30', R)).toBe('OVERDUE');
  });
});
