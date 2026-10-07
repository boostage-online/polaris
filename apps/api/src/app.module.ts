import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ENV, type Env } from './config/env';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RequestContextMiddleware } from './common/http/request-context.middleware';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { HealthModule } from './health/health.module';
import { AuditModule } from './modules/audit';
import { AuthGuard, IdentityModule, PermissionGuard, ScopeGuard } from './modules/identity';
import { PlatformModule } from './modules/platform';
import {
  IdempotencyInterceptor,
  MetricsInterceptor,
  RateLimitGuard,
  SharedModule,
  TransactionInterceptor,
} from './modules/shared';
import { TenancyModule } from './modules/tenancy';

/** Clés jamais loguées (Partie 11). */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-kkiapay-secret"]',
  'req.headers["x-fedapay-signature"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.secret',
  '*.code',
];

@Module({
  imports: [
    ConfigModule,
    DiscoveryModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          redact: { paths: REDACT_PATHS, censor: '[redacted]' },
          autoLogging: {
            ignore: (req) =>
              (req.url ?? '').startsWith('/api/v1/health') || req.url === '/api/v1/metrics',
          },
          customProps: (req) => ({ requestId: req.headers['x-request-id'] }),
          serializers: {
            req: (req: { method: string; url: string; headers: Record<string, string> }) => ({
              method: req.method,
              url: req.url,
              client: req.headers['x-client'],
            }),
          },
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    DatabaseModule,
    SharedModule,
    AuditModule,
    TenancyModule,
    IdentityModule,
    PlatformModule,
    HealthModule,
  ],
  providers: [
    // Ordre des guards : authentification → périmètre (tenant) → rate limit → permission.
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: ScopeGuard },
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: APP_GUARD, useExisting: PermissionGuard },
    // Ordre des interceptors : métriques (extérieur) → idempotence → transaction → enveloppe (intérieur).
    { provide: APP_INTERCEPTOR, useExisting: MetricsInterceptor },
    { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useExisting: TransactionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
