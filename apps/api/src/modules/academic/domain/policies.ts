/** Règles de portée de l'académique (ADR-0007, question 3 : « sur cette ressource ? »). */
export const SchedulePolicy = {
  /** Deux créneaux du même jour se chevauchent-ils ? (bornes HH:MM) */
  overlaps(
    a: { weekday: number; startTime: string; endTime: string },
    b: { weekday: number; startTime: string; endTime: string },
  ): boolean {
    return a.weekday === b.weekday && a.startTime < b.endTime && b.startTime < a.endTime;
  },
  /** Un enseignant voit une séance s'il enseigne le cours, sauf portée globale. */
  canSeeSession(
    actor: { permissions: ReadonlySet<string>; staffProfileId: string | null },
    teacherIds: readonly string[],
  ): boolean {
    if (
      actor.permissions.has('TAKE_ATTENDANCE_ANY') ||
      actor.permissions.has('VIEW_ATTENDANCE_ANY') ||
      actor.permissions.has('MANAGE_SCHEDULES')
    )
      return true;
    return actor.staffProfileId !== null && teacherIds.includes(actor.staffProfileId);
  },
};
