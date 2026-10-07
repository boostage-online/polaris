import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance';
import { AuditModule } from '../audit';
import { NotificationPlanner } from './application/notification-planner.service';
import { NotificationService } from './application/notification.service';
import {
  MyNotificationsController,
  NotificationsAdminController,
} from './controllers/notifications.controller';

@Module({
  imports: [AuditModule, AttendanceModule],
  controllers: [MyNotificationsController, NotificationsAdminController],
  providers: [NotificationPlanner, NotificationService],
  exports: [NotificationPlanner, NotificationService],
})
export class NotificationsModule {}
