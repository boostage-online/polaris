import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';
import { buildOpenApiDocument } from './openapi/build';

export const API_PREFIX = 'api/v1';

/** Construit l'application HTTP (utilisé par main.ts, les tests et le générateur OpenAPI). */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const env = app.get<Env>(ENV);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.set('trust proxy', 1);
  // Taille maximale des corps (Partie 11) : 1 Mo JSON (imports CSV compris), formulaires 1 Mo.
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: false });
  app.use(
    helmet({
      // API JSON : aucune ressource n'est rendue ; la documentation interactive (/api/docs) est hors production.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: [env.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Client',
      'X-Request-Id',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-Trace-Id',
      'Retry-After',
      'Idempotent-Replayed',
      'Content-Disposition',
    ],
    maxAge: 600,
  });
  app.enableShutdownHooks();
  return app;
}

/** Monte la documentation interactive sur /api/docs (désactivée en production sauf flag explicite). */
export async function mountDocs(app: INestApplication) {
  const env = app.get<Env>(ENV);
  if (env.NODE_ENV === 'production' && process.env['EXPOSE_DOCS'] !== 'true') return;
  const document = await buildOpenApiDocument(app);
  const { serve, setup } = await import('swagger-ui-express');
  const http = app.getHttpAdapter().getInstance() as Express;
  http.get('/api/openapi.json', (_req, res) => res.json(document));
  http.use(
    '/api/docs',
    serve,
    setup(document as Record<string, unknown>, { customSiteTitle: 'Polaris API' }),
  );
}
