import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic';
import { AuditModule } from '../audit';
import { DashboardService } from './application/dashboard.service';
import { GuardianService } from './application/guardian.service';
import { ImportService } from './application/import.service';
import { PrivacyService } from './application/privacy.service';
import { StudentService } from './application/student.service';
import {
  DashboardsController,
  GuardiansController,
  ImportsController,
  MyChildrenController,
  StudentGuardiansController,
} from './controllers/guardians.controller';
import { MyPersonalDataController, PrivacyController } from './controllers/privacy.controller';
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
    PrivacyController,
    MyPersonalDataController,
  ],
  providers: [StudentService, GuardianService, ImportService, DashboardService, PrivacyService],
  exports: [StudentService, GuardianService, PrivacyService],
})
export class StudentsGuardiansModule {}
