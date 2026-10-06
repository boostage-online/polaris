import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CourseService } from './application/course.service';
import { SessionService } from './application/session.service';
import { StructureService } from './application/structure.service';
import {
  CoursesController,
  MySessionsController,
  ScheduleSlotsController,
  SessionsController,
  StaffController,
} from './controllers/course.controller';
import {
  AcademicYearsController,
  GroupsController,
  LevelsController,
  ProgramsController,
  SubjectsController,
} from './controllers/structure.controller';

@Module({
  imports: [AuditModule],
  controllers: [
    AcademicYearsController,
    ProgramsController,
    LevelsController,
    GroupsController,
    SubjectsController,
    StaffController,
    CoursesController,
    ScheduleSlotsController,
    SessionsController,
    MySessionsController,
  ],
  providers: [StructureService, CourseService, SessionService],
  exports: [StructureService, CourseService, SessionService],
})
export class AcademicModule {}
