import { describe, expect, it } from 'vitest';
import { AttendancePolicy, DEFAULT_RULES, presenceRate, rulesFrom } from './policies';

const session = {
  startsAt: new Date('2026-10-12T07:00:00Z'),
  endsAt: new Date('2026-10-12T09:00:00Z'),
};
const perms = (...p: string[]) => new Set(p);

describe('AttendancePolicy — portée', () => {
  it("l'enseignant du cours peut faire l'appel, pas un autre enseignant", () => {
    const teacher = { permissions: perms('TAKE_ATTENDANCE'), staffProfileId: 'sp1' };
    expect(AttendancePolicy.canTake(teacher, ['sp1'])).toBe(true);
    expect(AttendancePolicy.canTake(teacher, ['sp2'])).toBe(false);
    expect(
      AttendancePolicy.canTake(
        { permissions: perms('TAKE_ATTENDANCE_ANY'), staffProfileId: null },
        ['sp2'],
      ),
    ).toBe(true);
  });
  it('la lecture suit la même logique avec les permissions de vue', () => {
    expect(
      AttendancePolicy.canView({ permissions: perms('VIEW_ATTENDANCE'), staffProfileId: 'sp1' }, [
        'sp1',
      ]),
    ).toBe(true);
    expect(
      AttendancePolicy.canView({ permissions: perms('VIEW_ATTENDANCE'), staffProfileId: 'sp1' }, [
        'sp2',
      ]),
    ).toBe(false);
    expect(
      AttendancePolicy.canView(
        { permissions: perms('VIEW_ATTENDANCE_REPORTS'), staffProfileId: null },
        [],
      ),
    ).toBe(true);
  });
});

describe('AttendancePolicy — temps', () => {
  it('trop tôt avant début − 15 min, rétroactif après fin + 24 h', () => {
    expect(AttendancePolicy.tooEarly(session, new Date('2026-10-12T06:40:00Z'))).toBe(true);
    expect(AttendancePolicy.tooEarly(session, new Date('2026-10-12T06:50:00Z'))).toBe(false);
    expect(AttendancePolicy.isRetroactive(session, new Date('2026-10-13T08:59:00Z'))).toBe(false);
    expect(AttendancePolicy.isRetroactive(session, new Date('2026-10-13T09:01:00Z'))).toBe(true);
  });
  it('mode de correction : fenêtre ordinaire vs verrouillé/hors fenêtre', () => {
    const editor = { permissions: perms('EDIT_ATTENDANCE'), staffProfileId: 'sp1' };
    const unlocker = { permissions: perms('EDIT_ATTENDANCE_LOCKED'), staffProfileId: null };
    const inWindow = new Date('2026-10-13T08:00:00Z');
    const late = new Date('2026-10-20T08:00:00Z');
    expect(
      AttendancePolicy.correctionMode(editor, 'SUBMITTED', session, inWindow, DEFAULT_RULES),
    ).toEqual({ outOfWindow: false });
    expect(
      AttendancePolicy.correctionMode(editor, 'SUBMITTED', session, late, DEFAULT_RULES),
    ).toBeNull();
    expect(
      AttendancePolicy.correctionMode(editor, 'LOCKED', session, inWindow, DEFAULT_RULES),
    ).toBeNull();
    expect(
      AttendancePolicy.correctionMode(unlocker, 'LOCKED', session, inWindow, DEFAULT_RULES),
    ).toEqual({ outOfWindow: true });
    expect(
      AttendancePolicy.correctionMode(unlocker, 'SUBMITTED', session, late, DEFAULT_RULES),
    ).toEqual({ outOfWindow: true });
  });
  it('la prochaine séance ignore les feuilles soumises et les séances finies depuis > 30 min', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    const list = [
      { id: 'a', endsAt: new Date('2026-10-12T09:00:00Z'), sheetStatus: null }, // finie depuis 1 h
      { id: 'b', endsAt: new Date('2026-10-12T10:15:00Z'), sheetStatus: 'SUBMITTED' },
      { id: 'c', endsAt: new Date('2026-10-12T12:00:00Z'), sheetStatus: 'DRAFT' },
    ];
    expect(AttendancePolicy.nextSessionId(list, now)).toBe('c');
  });
});

describe('AttendancePolicy — normalisation (ADR-0006)', () => {
  it('un retard au-delà du seuil devient une absence, durée conservée', () => {
    const r = AttendancePolicy.normalize(
      { status: 'LATE', lateMinutes: 45 },
      session,
      DEFAULT_RULES,
    );
    expect(r.status).toBe('ABSENT');
    expect(r.lateMinutes).toBe(45);
    expect(r.errors).toEqual([]);
  });
  it('un retard court reste un retard ; sans durée → erreur ; au-delà de la séance → erreur', () => {
    expect(
      AttendancePolicy.normalize({ status: 'LATE', lateMinutes: 10 }, session, DEFAULT_RULES)
        .status,
    ).toBe('LATE');
    expect(
      AttendancePolicy.normalize({ status: 'LATE' }, session, DEFAULT_RULES).errors,
    ).toHaveLength(1);
    expect(
      AttendancePolicy.normalize({ status: 'LATE', lateMinutes: 500 }, session, DEFAULT_RULES)
        .errors,
    ).toHaveLength(1);
  });
  it("la sortie anticipée n'a de sens que pour un présent, pendant la séance", () => {
    const ok = AttendancePolicy.normalize(
      { status: 'PRESENT', leftEarlyAt: '2026-10-12T08:30:00Z' },
      session,
      DEFAULT_RULES,
    );
    expect(ok.leftEarlyAt?.toISOString()).toBe('2026-10-12T08:30:00.000Z');
    expect(
      AttendancePolicy.normalize(
        { status: 'ABSENT', leftEarlyAt: '2026-10-12T08:30:00Z' },
        session,
        DEFAULT_RULES,
      ).leftEarlyAt,
    ).toBeNull();
    expect(
      AttendancePolicy.normalize(
        { status: 'PRESENT', leftEarlyAt: '2026-10-12T10:30:00Z' },
        session,
        DEFAULT_RULES,
      ).errors,
    ).toHaveLength(1);
  });
  it('les règles tenant surchargent les défauts partiellement', () => {
    expect(rulesFrom({ attendance: { lateToAbsentMinutes: 15 } }).lateToAbsentMinutes).toBe(15);
    expect(rulesFrom({ attendance: { lateToAbsentMinutes: 15 } }).correctionWindowHours).toBe(48);
    expect(rulesFrom(null)).toEqual(DEFAULT_RULES);
  });
  it('taux de présence physique', () => {
    expect(presenceRate(9, 10)).toBe(90);
    expect(presenceRate(0, 0)).toBeNull();
  });
});
