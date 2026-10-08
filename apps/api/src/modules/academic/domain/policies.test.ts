import { describe, expect, it } from 'vitest';
import { SchedulePolicy } from './policies';

describe('SchedulePolicy', () => {
  it('détecte les chevauchements le même jour seulement', () => {
    const a = { weekday: 1, startTime: '08:00', endTime: '10:00' };
    expect(SchedulePolicy.overlaps(a, { weekday: 1, startTime: '09:00', endTime: '11:00' })).toBe(
      true,
    );
    expect(SchedulePolicy.overlaps(a, { weekday: 1, startTime: '10:00', endTime: '12:00' })).toBe(
      false,
    );
    expect(SchedulePolicy.overlaps(a, { weekday: 2, startTime: '09:00', endTime: '11:00' })).toBe(
      false,
    );
  });
  it("limite l'enseignant à ses cours sauf portée globale", () => {
    const own = { permissions: new Set(['TAKE_ATTENDANCE']), staffProfileId: 'sp1' };
    expect(SchedulePolicy.canSeeSession(own, ['sp1'])).toBe(true);
    expect(SchedulePolicy.canSeeSession(own, ['sp2'])).toBe(false);
    expect(
      SchedulePolicy.canSeeSession(
        { permissions: new Set(['TAKE_ATTENDANCE_ANY']), staffProfileId: null },
        ['sp2'],
      ),
    ).toBe(true);
  });
});
