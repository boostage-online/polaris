import { describe, expect, it } from 'vitest';
import { DEFAULT_CHANNELS, Templates, clip, resolveChannels } from './templates';

describe('Templates de notification', () => {
  it('agrège plusieurs enfants dans un seul SMS ≤ 160 caractères', () => {
    const r = Templates.attendanceMarked({
      tenantName: 'Lycée de démonstration',
      startsAt: '2026-10-12T07:00:00Z',
      tz: 'Africa/Porto-Novo',
      children: [
        { firstName: 'Aïcha', status: 'ABSENT', lateMinutes: null, subjectName: 'Mathématiques' },
        { firstName: 'Koffi', status: 'LATE', lateMinutes: 10, subjectName: 'Mathématiques' },
      ],
    });
    expect(r.title).toBe('Absence signalée');
    expect(r.body).toContain('Aïcha absent(e)');
    expect(r.body).toContain('Koffi en retard (10 min)');
    expect(r.body).toContain('08:00'); // heure de Cotonou
    expect(r.body.length).toBeLessThanOrEqual(160);
  });
  it('tronque proprement un corps trop long', () => {
    expect(clip('a'.repeat(200), 160)).toHaveLength(160);
    expect(clip('court', 160)).toBe('court');
  });
  it('résout les canaux : préférence > défaut, in-app toujours, push ignoré en V1', () => {
    expect(resolveChannels('STUDENT_ABSENT', undefined)).toEqual(DEFAULT_CHANNELS.STUDENT_ABSENT);
    expect(resolveChannels('STUDENT_LATE', ['SMS'])).toEqual(['SMS', 'INAPP']);
    expect(resolveChannels('STUDENT_ABSENT', ['PUSH'])).toEqual(['INAPP']);
    expect(resolveChannels('STUDENT_ABSENT', [])).toEqual(['INAPP']);
  });
  it('décision de justificatif', () => {
    const r = Templates.justificationReviewed({
      firstName: 'Aïcha',
      decision: 'APPROVED',
      comment: null,
      fromDate: '2026-10-12',
      toDate: '2026-10-12',
    });
    expect(r.body).toBe('Le justificatif de Aïcha du 12/10/2026 est accepté.');
  });
});
