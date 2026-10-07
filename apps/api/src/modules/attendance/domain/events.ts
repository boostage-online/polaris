import type { DomainEvent } from '../../shared';

/** Événements d'assiduité publiés via l'outbox (ADR-0003) ; consommés par le moteur de notifications. */
export const AttendanceEvents = {
  AttendanceSheetSubmitted: 'AttendanceSheetSubmitted',
  AttendanceCorrected: 'AttendanceCorrected',
  JustificationSubmitted: 'JustificationSubmitted',
  JustificationReviewed: 'JustificationReviewed',
  RepeatedAbsencesDetected: 'RepeatedAbsencesDetected',
} as const;

export interface MarkedStudent {
  studentId: string;
  recordId: string;
  status: 'ABSENT' | 'LATE';
  lateMinutes: number | null;
}

export const attendanceSheetSubmitted = (p: {
  tenantId: string;
  sheetId: string;
  sessionId: string;
  startsAt: string;
  subjectName: string;
  groupName: string;
  marked: MarkedStudent[];
  retroactive: boolean;
}): DomainEvent => ({
  type: AttendanceEvents.AttendanceSheetSubmitted,
  aggregateType: 'AttendanceSheet',
  aggregateId: p.sheetId,
  tenantId: p.tenantId,
  payload: p,
});

export const attendanceCorrected = (p: {
  tenantId: string;
  recordId: string;
  sessionId: string;
  studentId: string;
  from: string;
  to: string;
  startsAt: string;
  subjectName: string;
  reason: string;
}): DomainEvent => ({
  type: AttendanceEvents.AttendanceCorrected,
  aggregateType: 'AttendanceRecord',
  aggregateId: p.recordId,
  tenantId: p.tenantId,
  payload: p,
});

export const justificationSubmitted = (p: {
  tenantId: string;
  justificationId: string;
  studentId: string;
  fromDate: string;
  toDate: string;
  submittedByKind: 'STAFF' | 'GUARDIAN';
}): DomainEvent => ({
  type: AttendanceEvents.JustificationSubmitted,
  aggregateType: 'AbsenceJustification',
  aggregateId: p.justificationId,
  tenantId: p.tenantId,
  payload: p,
});

export const justificationReviewed = (p: {
  tenantId: string;
  justificationId: string;
  studentId: string;
  decision: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED';
  comment: string | null;
  submittedBy: string | null;
  fromDate: string;
  toDate: string;
}): DomainEvent => ({
  type: AttendanceEvents.JustificationReviewed,
  aggregateType: 'AbsenceJustification',
  aggregateId: p.justificationId,
  tenantId: p.tenantId,
  payload: p,
});

export const repeatedAbsencesDetected = (p: {
  tenantId: string;
  alertId: string;
  studentId: string;
  count: number;
  windowFrom: string;
  windowTo: string;
}): DomainEvent => ({
  type: AttendanceEvents.RepeatedAbsencesDetected,
  aggregateType: 'AttendanceAlert',
  aggregateId: p.alertId,
  tenantId: p.tenantId,
  payload: p,
});
