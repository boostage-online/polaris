import { describe, expect, it } from 'vitest';
import { addDays, localDateParts, offsetMinutes, zonedDateTimeToUtc } from './tz';

describe('fuseaux horaires', () => {
  it('Cotonou (UTC+1) : 08:00 local = 07:00Z', () => {
    expect(zonedDateTimeToUtc('2027-01-18', '08:00', 'Africa/Porto-Novo').toISOString()).toBe(
      '2027-01-18T07:00:00.000Z',
    );
    expect(offsetMinutes(new Date('2027-01-18T07:00:00Z'), 'Africa/Porto-Novo')).toBe(60);
  });
  it("Paris : tient compte de l'heure d'été", () => {
    expect(zonedDateTimeToUtc('2027-07-01', '08:00', 'Europe/Paris').toISOString()).toBe(
      '2027-07-01T06:00:00.000Z',
    );
    expect(zonedDateTimeToUtc('2027-01-01', '08:00', 'Europe/Paris').toISOString()).toBe(
      '2027-01-01T07:00:00.000Z',
    );
  });
  it('jour ISO et arithmétique de dates', () => {
    expect(localDateParts(new Date('2027-01-18T07:00:00Z'), 'Africa/Porto-Novo')).toEqual({
      date: '2027-01-18',
      isoWeekday: 1,
    });
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
  });
});
