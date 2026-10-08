import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../../database/database.service';
import type { Db } from '../../../database/request-context';
import { academicYears } from '../../../database/schema';
import { ImportService } from './import.service';

type CountRow = Record<string, string | number | null>;

const n = (row: CountRow | undefined, key: string) => Number(row?.[key] ?? 0);

/**
 * Tableaux de bord « scolarité » et « administrateur ».
 * Agrégats SQL sous RLS (le tenant courant est posé par la transaction) ; aucune donnée nominative.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly imports: ImportService,
  ) {}

  async registrar() {
    const tx = this.db.current();
    const year = await this.currentYearId(tx);
    const s = (
      await tx.execute<CountRow>(sql`
        select
          count(*) filter (where s.status = 'ACTIVE')                                               as active,
          count(*) filter (where s.status <> 'ACTIVE')                                              as left_count,
          count(*) filter (where s.status = 'ACTIVE' and not exists (
            select 1 from student_guardians sg where sg.student_id = s.id and sg.unlinked_at is null)) as without_guardian,
          count(*) filter (where s.status = 'ACTIVE' and not exists (
            select 1 from enrollments e where e.student_id = s.id and e.is_primary and e.left_at is null
              and e.academic_year_id = ${year}::uuid))                                              as without_class,
          count(*) filter (where s.status = 'ACTIVE' and (
            s.birth_date is null
            or not exists (select 1 from student_guardians sg where sg.student_id = s.id and sg.unlinked_at is null)
            or not exists (select 1 from enrollments e where e.student_id = s.id and e.is_primary and e.left_at is null
              and e.academic_year_id = ${year}::uuid)))                                             as incomplete
        from students s where s.deleted_at is null`)
    ).rows[0];
    const g = (
      await tx.execute<CountRow>(sql`
        select count(*) as total, count(*) filter (where user_id is not null) as activated
        from guardians where deleted_at is null`)
    ).rows[0];
    const e = (
      await tx.execute<CountRow>(sql`
        select count(*) as total from enrollments
        where is_primary and academic_year_id = ${year}::uuid`)
    ).rows[0];
    return {
      students: {
        active: n(s, 'active'),
        left: n(s, 'left_count'),
        withoutGuardian: n(s, 'without_guardian'),
        withoutClass: n(s, 'without_class'),
        incomplete: n(s, 'incomplete'),
      },
      guardians: { total: n(g, 'total'), activated: n(g, 'activated') },
      enrollmentsThisYear: n(e, 'total'),
      recentImports: await this.imports.recent(5),
    };
  }

  async admin() {
    const tx = this.db.current();
    const year = await this.currentYearId(tx);
    const c = (
      await tx.execute<CountRow>(sql`
        select
          (select count(*) from students where deleted_at is null and status = 'ACTIVE')                         as students,
          (select count(*) from staff_profiles where is_teacher)                                                 as teachers,
          (select count(*) from staff_profiles)                                                                  as staff,
          (select count(*) from groups where deleted_at is null and academic_year_id = ${year}::uuid)            as groups,
          (select count(*) from course_offerings where deleted_at is null and academic_year_id = ${year}::uuid)  as courses,
          (select count(*) from sessions where status = 'PLANNED'
             and starts_at between now() and now() + interval '7 days')                                          as upcoming`)
    ).rows[0];
    const issues: { code: string; message: string; count: number }[] = [];
    const push = (code: string, message: string, count: number) => {
      if (count > 0) issues.push({ code, message, count });
    };
    if (!year) {
      push('NO_CURRENT_YEAR', "Aucune année académique courante n'est définie", 1);
    } else {
      const i = (
        await tx.execute<CountRow>(sql`
          select
            (select count(*) from course_offerings co where co.deleted_at is null and co.academic_year_id = ${year}::uuid
               and not exists (select 1 from course_teachers ct where ct.course_offering_id = co.id))            as courses_without_teacher,
            (select count(*) from course_offerings co where co.deleted_at is null and co.academic_year_id = ${year}::uuid
               and not exists (select 1 from schedule_slots ss where ss.course_offering_id = co.id and ss.deleted_at is null)) as courses_without_slot,
            (select count(*) from groups g where g.deleted_at is null and g.kind = 'CLASS' and g.academic_year_id = ${year}::uuid
               and not exists (select 1 from enrollments e where e.group_id = g.id and e.left_at is null))         as empty_groups,
            (select count(*) from groups g where g.deleted_at is null and g.kind = 'CLASS' and g.academic_year_id = ${year}::uuid
               and g.capacity is not null and g.capacity < (select count(*) from enrollments e where e.group_id = g.id and e.left_at is null)) as over_capacity,
            (select count(*) from staff_profiles sp where sp.is_teacher
               and not exists (select 1 from course_teachers ct where ct.staff_profile_id = sp.id))               as teachers_without_course`)
      ).rows[0];
      push('COURSES_WITHOUT_TEACHER', 'Cours sans enseignant', n(i, 'courses_without_teacher'));
      push('COURSES_WITHOUT_SLOT', 'Cours sans créneau horaire', n(i, 'courses_without_slot'));
      push('EMPTY_GROUPS', 'Classes sans élève inscrit', n(i, 'empty_groups'));
      push('GROUPS_OVER_CAPACITY', 'Classes au-dessus de leur capacité', n(i, 'over_capacity'));
      push('TEACHERS_WITHOUT_COURSE', 'Enseignants sans cours', n(i, 'teachers_without_course'));
    }
    return {
      counts: {
        students: n(c, 'students'),
        teachers: n(c, 'teachers'),
        staff: n(c, 'staff'),
        groups: n(c, 'groups'),
        courses: n(c, 'courses'),
        upcomingSessions7d: n(c, 'upcoming'),
      },
      configurationIssues: issues,
    };
  }

  /** Année courante ou null (le tableau de bord ne doit pas échouer sur un tenant vierge). */
  private async currentYearId(tx: Db): Promise<string | null> {
    const row = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    return row?.id ?? null;
  }
}
