import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '../config/config.module';
import { ENV, type Env } from '../config/env';
import { DatabaseModule } from '../database/database.module';
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

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ pinoHttp: { level: env.LOG_LEVEL } }),
    }),
    DatabaseModule,
    SharedModule,
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
  ],
  exports: [OutboxRelayService, DomainEventsProcessor, MaintenanceService],
})
export class WorkerModule {}
