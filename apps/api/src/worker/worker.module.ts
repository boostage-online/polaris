import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '../config/config.module';
import { ENV, type Env } from '../config/env';
import { DatabaseModule } from '../database/database.module';
import { AcademicModule } from '../modules/academic';
import { SharedModule } from '../modules/shared';
import { DomainEventsProcessor } from './domain-events.processor';
import {
  EVENT_HANDLERS,
  InvitationEmailHandler,
  SecurityAlertHandler,
  TenantLifecycleHandler,
} from './event-handlers';
import { MaintenanceService } from './maintenance.service';
import { OutboxRelayService } from './outbox-relay.service';
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
  ],
  providers: [
    InvitationEmailHandler,
    SecurityAlertHandler,
    TenantLifecycleHandler,
    {
      provide: EVENT_HANDLERS,
      inject: [InvitationEmailHandler, SecurityAlertHandler, TenantLifecycleHandler],
      useFactory: (...handlers: unknown[]) => handlers,
    },
    OutboxRelayService,
    DomainEventsProcessor,
    MaintenanceService,
    SchedulesService,
  ],
  exports: [OutboxRelayService, DomainEventsProcessor, MaintenanceService, SchedulesService],
})
export class WorkerModule {}
