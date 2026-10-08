-- contract : rollback (développement et CI uniquement).
DROP TABLE IF EXISTS import_jobs, student_guardians, guardians, enrollments, students, sessions, schedule_slots,
  course_teachers, course_offerings, staff_profiles, subjects, groups, levels, programs CASCADE;
DROP FUNCTION IF EXISTS unaccent_lite(text);
