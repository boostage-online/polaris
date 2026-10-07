'use client';
import type {
  AcademicYear,
  AdminDashboard,
  ChildSummary,
  ClassSession,
  Course,
  CreateAcademicYearInput,
  CreateCourseInput,
  CreateGroupInput,
  CreateGuardianInput,
  CreateScheduleSlotInput,
  CreateStudentInput,
  Enrollment,
  Group,
  Guardian,
  GuardianLink,
  ImportJob,
  LinkGuardianInput,
  Program,
  RegistrarDashboard,
  Staff,
  Student,
  Subject,
  Term,
} from '@polaris/contracts';
import { api, apiEnvelope, del, json, patch, put, qs, type PageMeta } from './api';

/** Fonctions d'accès aux ressources Phase 2, une par route, typées par les contrats. */

export const years = {
  list: () => api<AcademicYear[]>('/academic-years'),
  create: (b: CreateAcademicYearInput) => api<AcademicYear>('/academic-years', json(b)),
  update: (id: string, b: Partial<CreateAcademicYearInput>) =>
    api<AcademicYear>(`/academic-years/${id}`, patch(b)),
  setCurrent: (id: string) => api<AcademicYear>(`/academic-years/${id}/set-current`, json({})),
  terms: (id: string) => api<Term[]>(`/academic-years/${id}/terms`),
  addTerm: (id: string, b: { label: string; startDate: string; endDate: string }) =>
    api<Term>(`/academic-years/${id}/terms`, json(b)),
};

export const programs = {
  list: () => api<Program[]>('/programs'),
  create: (b: { code: string; name: string }) => api<Program>('/programs', json(b)),
  update: (id: string, b: { code?: string; name?: string }) =>
    api<Program>(`/programs/${id}`, patch(b)),
  remove: (id: string) => api<void>(`/programs/${id}`, del()),
  addLevel: (id: string, b: { name: string; rank?: number }) =>
    api<Program>(`/programs/${id}/levels`, json(b)),
  updateLevel: (levelId: string, b: { name?: string; rank?: number }) =>
    api<Program>(`/levels/${levelId}`, patch(b)),
};

export const groups = {
  list: (q: { academicYearId?: string; kind?: 'CLASS' | 'SUBGROUP'; levelId?: string } = {}) =>
    api<Group[]>(`/groups${qs(q)}`),
  get: (id: string) => api<Group>(`/groups/${id}`),
  create: (b: CreateGroupInput) => api<Group>('/groups', json(b)),
  update: (id: string, b: Partial<Omit<CreateGroupInput, 'academicYearId'>>) =>
    api<Group>(`/groups/${id}`, patch(b)),
  remove: (id: string) => api<void>(`/groups/${id}`, del()),
};

export const subjects = {
  list: () => api<Subject[]>('/subjects'),
  create: (b: { code: string; name: string; levelId?: string | null }) =>
    api<Subject>('/subjects', json(b)),
  update: (id: string, b: { code?: string; name?: string; levelId?: string | null }) =>
    api<Subject>(`/subjects/${id}`, patch(b)),
  remove: (id: string) => api<void>(`/subjects/${id}`, del()),
};

export const staff = {
  list: () => api<Staff[]>('/staff'),
  update: (
    membershipId: string,
    b: { isTeacher?: boolean; employeeNumber?: string | null; title?: string | null },
  ) => api<Staff>(`/staff/${membershipId}`, patch(b)),
};

export const courses = {
  list: (q: { academicYearId?: string; groupId?: string; teacherStaffProfileId?: string } = {}) =>
    api<Course[]>(`/courses${qs(q)}`),
  get: (id: string) => api<Course>(`/courses/${id}`),
  create: (b: CreateCourseInput) => api<Course>('/courses', json(b)),
  setTeachers: (id: string, teachers: { staffProfileId: string; role?: 'MAIN' | 'ASSISTANT' }[]) =>
    api<Course>(`/courses/${id}/teachers`, put({ teachers })),
  remove: (id: string) => api<void>(`/courses/${id}`, del()),
  addSlot: (id: string, b: CreateScheduleSlotInput) =>
    apiEnvelope<{ id: string }, { warnings?: string[] }>(`/courses/${id}/schedule-slots`, json(b)),
  removeSlot: (slotId: string) => api<void>(`/schedule-slots/${slotId}`, del()),
  addSession: (id: string, b: { startsAt: string; endsAt: string; room?: string | null }) =>
    api<ClassSession>(`/courses/${id}/sessions`, json(b)),
};

export interface SessionsQuery {
  from?: string;
  to?: string;
  groupId?: string;
  courseOfferingId?: string;
  status?: 'PLANNED' | 'HELD' | 'CANCELLED';
  limit?: number;
  cursor?: string;
}
export const sessions = {
  list: (q: SessionsQuery) => apiEnvelope<ClassSession[], PageMeta>(`/sessions${qs(q)}`),
  mine: (q: { from?: string; to?: string; limit?: number; cursor?: string }) =>
    apiEnvelope<ClassSession[], PageMeta>(`/me/schedule${qs(q)}`),
  get: (id: string) => api<ClassSession>(`/sessions/${id}`),
  update: (
    id: string,
    b: {
      startsAt?: string;
      endsAt?: string;
      room?: string | null;
      status?: 'PLANNED' | 'HELD' | 'CANCELLED';
      cancelReason?: string | null;
    },
  ) => api<ClassSession>(`/sessions/${id}`, patch(b)),
  generate: (horizonDays = 14) =>
    api<{ created: number; scanned: number }>('/sessions/generate', json({ horizonDays })),
};

export interface StudentsQuery {
  q?: string;
  groupId?: string;
  academicYearId?: string;
  status?: 'ACTIVE' | 'LEFT' | 'GRADUATED';
  incomplete?: boolean;
  limit?: number;
  cursor?: string;
}
export const students = {
  list: (q: StudentsQuery) => apiEnvelope<Student[], PageMeta>(`/students${qs(q)}`),
  get: (id: string) => api<Student>(`/students/${id}`),
  create: (b: CreateStudentInput) => api<Student>('/students', json(b)),
  update: (id: string, b: Partial<Omit<CreateStudentInput, 'groupId'>>) =>
    api<Student>(`/students/${id}`, patch(b)),
  enroll: (id: string, b: { groupId: string; enrolledAt?: string }) =>
    api<Enrollment>(`/students/${id}/enrollments`, json(b)),
  transfer: (id: string, b: { toGroupId: string; effectiveDate?: string; reason?: string }) =>
    api<Student>(`/students/${id}/transfer`, json(b)),
  leave: (id: string, b: { status: 'LEFT' | 'GRADUATED'; leftAt?: string; reason?: string }) =>
    api<Student>(`/students/${id}/leave`, json(b)),
  closeEnrollment: (enrollmentId: string, b: { leftAt?: string; reason?: string }) =>
    api<Enrollment>(`/enrollments/${enrollmentId}/close`, json(b)),
  guardians: (id: string) => api<GuardianLink[]>(`/students/${id}/guardians`),
  linkGuardian: (id: string, b: LinkGuardianInput) =>
    api<GuardianLink>(`/students/${id}/guardians`, json(b)),
};

export const guardians = {
  list: (q: { q?: string; activated?: boolean; limit?: number; cursor?: string }) =>
    apiEnvelope<Guardian[], PageMeta>(`/guardians${qs(q)}`),
  get: (id: string) => api<Guardian>(`/guardians/${id}`),
  create: (b: CreateGuardianInput) => api<Guardian>('/guardians', json(b)),
  update: (id: string, b: Partial<CreateGuardianInput>) =>
    api<Guardian>(`/guardians/${id}`, patch(b)),
  invite: (id: string) => api<{ invited: boolean }>(`/guardians/${id}/invite`, json({})),
  updateLink: (
    linkId: string,
    b: {
      relationship?: 'MOTHER' | 'FATHER' | 'TUTOR' | 'OTHER';
      isPrimary?: boolean;
      canViewAttendance?: boolean;
      canViewFinance?: boolean;
      canPay?: boolean;
      canJustify?: boolean;
    },
  ) => api<GuardianLink>(`/student-guardians/${linkId}`, patch(b)),
  unlink: (linkId: string, reason: string) =>
    api<void>(`/student-guardians/${linkId}`, del({ reason })),
  myChildren: () => api<ChildSummary[]>('/me/children'),
};

export const imports = {
  students: (csv: string, opts: { dryRun: boolean; academicYearId?: string }) =>
    api<ImportJob>(`/imports/students${qs(opts)}`, json({ csv })),
  guardians: (csv: string, opts: { dryRun: boolean }) =>
    api<ImportJob>(`/imports/guardians${qs(opts)}`, json({ csv })),
  get: (id: string) => api<ImportJob>(`/imports/${id}`),
};

export const dashboards = {
  registrar: () => api<RegistrarDashboard>('/dashboards/registrar'),
  admin: () => api<AdminDashboard>('/dashboards/admin'),
};
