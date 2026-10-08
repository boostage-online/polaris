import { Global, Module } from '@nestjs/common';
import { OutboxService } from './application/outbox.service';
import { CLOCK, EMAIL_GATEWAY, SMS_GATEWAY, systemClock } from './domain/ports';
import { IdempotencyInterceptor } from './infrastructure/idempotency.interceptor';
import { LogEmailGateway, LogSmsGateway } from './infrastructure/log-gateways';
import { MetricsInterceptor } from './infrastructure/metrics.interceptor';
import { MetricsService } from './infrastructure/metrics.service';
import { RateLimitGuard } from './infrastructure/rate-limit.guard';
import { RedisService } from './infrastructure/redis.service';
import { TransactionInterceptor } from './infrastructure/transaction.interceptor';

@Global()
@Module({
  providers: [
    RedisService,
    MetricsService,
    OutboxService,
    RateLimitGuard,
    TransactionInterceptor,
    IdempotencyInterceptor,
    MetricsInterceptor,
    LogSmsGateway,
    LogEmailGateway,
    { provide: SMS_GATEWAY, useExisting: LogSmsGateway },
    { provide: EMAIL_GATEWAY, useExisting: LogEmailGateway },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [
    RedisService,
    MetricsService,
    OutboxService,
    RateLimitGuard,
    TransactionInterceptor,
    IdempotencyInterceptor,
    MetricsInterceptor,
    SMS_GATEWAY,
    EMAIL_GATEWAY,
    CLOCK,
    LogSmsGateway,
    LogEmailGateway,
  ],
})
export class SharedModule {}
