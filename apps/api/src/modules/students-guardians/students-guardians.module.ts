import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic';
import { AuditModule } from '../audit';
import { DashboardService } from './application/dashboard.service';
import { GuardianService } from './application/guardian.service';
import { ImportService } from './application/import.service';
import { StudentService } from './application/student.service';
import {
  DashboardsController,
  GuardiansController,
  ImportsController,
  MyChildrenController,
  StudentGuardiansController,
} from './controllers/guardians.controller';
import { EnrollmentsController, StudentsController } from './controllers/students.controller';

@Module({
  imports: [AuditModule, AcademicModule],
  controllers: [
    StudentsController,
    EnrollmentsController,
    GuardiansController,
    StudentGuardiansController,
    MyChildrenController,
    ImportsController,
    DashboardsController,
  ],
  providers: [StudentService, GuardianService, ImportService, DashboardService],
  exports: [StudentService, GuardianService],
})
export class StudentsGuardiansModule {}
