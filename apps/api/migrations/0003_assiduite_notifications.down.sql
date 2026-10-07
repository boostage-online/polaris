-- contract : rollback (développement et CI uniquement).
DROP TABLE IF EXISTS notification_preferences, notifications, attendance_alerts, attendance_daily_stats,
  justification_records, absence_justifications, attendance_record_revisions, attendance_records, attendance_sheets CASCADE;
