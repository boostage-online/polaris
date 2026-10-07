import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '../config/config.module';
import { ENV, type Env } from '../config/env';
import { DatabaseModule } from '../database/database.module';
import { AcademicModule } from '../modules/academic';
import { BillingModule } from '../modules/billing';
import { PaymentsModule } from '../modules/payments';
import { NotificationsModule } from '../modules/notifications';
import { SharedModule } from '../modules/shared';
import { DomainEventsProcessor } from './domain-events.processor';
import {
  EVENT_HANDLERS,
  InvitationEmailHandler,
  NotificationsEventHandler,
  SecurityAlertHandler,
  TenantLifecycleHandler,
} from './event-handlers';
import { MaintenanceService } from './maintenance.service';
import { OutboxRelayService } from './outbox-relay.service';
import { PaymentsProcessor } from './payments.processor';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ pinoHttp: { level: env.LOG_LEVEL } }),
    }),
    DatabaseModule,
    SharedModule,
    AcademicModule,
    BillingModule,
    PaymentsModule,
    NotificationsModule,
  ],
  providers: [
    InvitationEmailHandler,
    SecurityAlertHandler,
    TenantLifecycleHandler,
    NotificationsEventHandler,
    {
      provide: EVENT_HANDLERS,
      inject: [
        InvitationEmailHandler,
        SecurityAlertHandler,
        TenantLifecycleHandler,
        NotificationsEventHandler,
      ],
      useFactory: (...handlers: unknown[]) => handlers,
    },
    OutboxRelayService,
    DomainEventsProcessor,
    MaintenanceService,
    SchedulesService,
    PaymentsProcessor,
  ],
  exports: [
    OutboxRelayService,
    DomainEventsProcessor,
    MaintenanceService,
    SchedulesService,
    PaymentsProcessor,
  ],
})
export class WorkerModule {}
