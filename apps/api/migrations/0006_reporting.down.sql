-- contract : rollback (développement et CI uniquement).
DROP TABLE IF EXISTS tenant_exports, scheduled_reports, report_refreshes, report_finance_daily, report_attendance_daily CASCADE;
