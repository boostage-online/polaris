import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic';
import { AuditModule } from '../audit';
import { StudentsGuardiansModule } from '../students-guardians';
import { AttendanceDashboardService } from './application/attendance-dashboard.service';
import { JustificationService } from './application/justification.service';
import { SheetService } from './application/sheet.service';
import { StatsService } from './application/stats.service';
import {
  AttendanceDashboardsController,
  AttendanceRecordsController,
  AttendanceSheetsController,
  JustificationsController,
  MyChildrenAttendanceController,
  MyTodayController,
  SessionAttendanceController,
  StudentAttendanceController,
  WatchlistController,
} from './controllers/attendance.controller';

@Module({
  imports: [AuditModule, AcademicModule, StudentsGuardiansModule],
  controllers: [
    MyTodayController,
    SessionAttendanceController,
    AttendanceSheetsController,
    AttendanceRecordsController,
    JustificationsController,
    StudentAttendanceController,
    WatchlistController,
    AttendanceDashboardsController,
    MyChildrenAttendanceController,
  ],
  providers: [StatsService, SheetService, JustificationService, AttendanceDashboardService],
  exports: [StatsService, SheetService, JustificationService],
})
export class AttendanceModule {}
