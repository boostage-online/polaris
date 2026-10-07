import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, Reflector } from '@nestjs/core';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { ProblemDetailsSchema } from '@polaris/contracts';
import {
  META_API_DOC,
  META_PERMISSION,
  META_PUBLIC,
  META_SCOPE,
  type ApiDocOptions,
} from '../common/decorators';

extendZodWithOpenApi(z);

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const;

export interface RouteInfo {
  method: (typeof METHODS)[number];
  /** Chemin Express (`/api/v1/roles/:id`). */
  path: string;
  isPublic: boolean;
  scope: string;
  permission: string | undefined;
  doc: ApiDocOptions | undefined;
  controller: string;
  handler: string;
}

/** Inventaire des routes réellement enregistrées (source unique pour l'OpenAPI et les tests de permissions). */
export function collectRoutes(app: INestApplication): RouteInfo[] {
  const discovery = app.get(DiscoveryService);
  const reflector = app.get(Reflector);
  const routes: RouteInfo[] = [];
  for (const wrapper of discovery.getControllers()) {
    const target = wrapper.metatype as (new () => unknown) | undefined;
    if (!target) continue;
    const basePath = normalize(
      Reflect.getMetadata(PATH_METADATA, target) as string | string[] | undefined,
    );
    const proto = target.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const handler = proto[name] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof handler !== 'function') continue;
      const methodIdx = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (methodIdx === undefined) continue;
      const subPath = normalize(
        Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined,
      );
      routes.push({
        method: METHODS[methodIdx] ?? 'get',
        path: `/api/v1${basePath}${subPath}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/',
        isPublic: reflector.getAllAndOverride<boolean>(META_PUBLIC, [handler, target]) ?? false,
        scope: reflector.getAllAndOverride<string>(META_SCOPE, [handler, target]) ?? 'tenant',
        permission: reflector
          .getAllAndOverride<string[] | undefined>(META_PERMISSION, [handler, target])
          ?.join(' | '),
        doc: reflector.getAllAndOverride<ApiDocOptions | undefined>(META_API_DOC, [
          handler,
          target,
        ]),
        controller: target.name,
        handler: name,
      });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/**
 * Génère l'OpenAPI 3.1 depuis les contrôleurs réellement enregistrés et leurs schémas zod (@ApiDoc).
 * La spec ne peut donc pas diverger des routes : une route sans @ApiDoc apparaît quand même,
 * marquée « non documentée », et le test de contrat la signale.
 */
export type OpenApiDocument = Record<string, unknown> & {
  paths?: Record<string, unknown>;
  'x-undocumented-routes': string[];
};

export async function buildOpenApiDocument(app: INestApplication): Promise<OpenApiDocument> {
  const registry = new OpenAPIRegistry();
  registry.register('ProblemDetails', ProblemDetailsSchema);
  const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  const undocumented: string[] = [];

  for (const r of collectRoutes(app)) {
    const { method, path, doc, isPublic, scope, permission } = r;
    if (!doc) undocumented.push(`${method.toUpperCase()} ${path}`);
    const status = doc?.status ?? (method === 'post' ? 201 : 200);
    const description = [
      doc ? '' : '⚠️ Route non documentée (@ApiDoc manquant).',
      `Portée : ${isPublic ? 'publique' : scope}.`,
      permission ? `Permission : \`${permission}\`.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    registry.registerPath({
      method,
      path: path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
      summary: doc?.summary ?? `${method.toUpperCase()} ${path}`,
      description,
      tags: doc?.tags ?? [path.split('/')[3] ?? 'default'],
      deprecated: doc?.deprecated,
      security: isPublic ? [] : [{ [bearer.name]: [] }],
      request: {
        params: (doc?.params as z.AnyZodObject | undefined) ?? pathParams(path),
        query: doc?.query as z.AnyZodObject | undefined,
        body: doc?.body ? { content: { 'application/json': { schema: doc.body } } } : undefined,
      },
      responses: {
        [status]: doc?.response
          ? {
              description: 'OK',
              content: {
                'application/json': {
                  schema: z.object({ data: doc.response, meta: z.record(z.unknown()).optional() }),
                },
              },
            }
          : { description: status === 204 ? 'Aucun contenu' : 'OK' },
        401: {
          description: 'Non authentifié',
          content: { 'application/problem+json': { schema: ProblemDetailsSchema } },
        },
        403: {
          description: 'Permission manquante',
          content: { 'application/problem+json': { schema: ProblemDetailsSchema } },
        },
        404: {
          description: "Introuvable (ou d'un autre établissement)",
          content: { 'application/problem+json': { schema: ProblemDetailsSchema } },
        },
        422: {
          description: 'Validation',
          content: { 'application/problem+json': { schema: ProblemDetailsSchema } },
        },
      },
    });
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const document = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Polaris API',
      version: '1.0.0',
      description:
        'API REST versionnée (ADR-0009). Enveloppe `{ data, meta }`, erreurs RFC 9457, pagination par curseur, en-tête `Idempotency-Key` sur les créations. Clients web : en-tête `X-Client: web/<version>` pour le mode cookie.',
    },
    servers: [{ url: '/' }],
  });
  return {
    ...(document as unknown as Record<string, unknown>),
    'x-undocumented-routes': undocumented,
  };
}

function normalize(p: string | string[] | undefined): string {
  const s = Array.isArray(p) ? (p[0] ?? '') : (p ?? '');
  if (!s || s === '/') return '';
  return s.startsWith('/') ? s : `/${s}`;
}

function pathParams(path: string): z.AnyZodObject | undefined {
  const names = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
  if (names.length === 0) return undefined;
  return z.object(Object.fromEntries(names.map((n) => [n, z.string()])));
}
