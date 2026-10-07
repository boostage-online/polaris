import {
  Body,
  Param,
  Query,
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { ZodSchema } from 'zod';
import type { Permission } from '@polaris/contracts';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import {
  RequestContextStore,
  type Actor,
  type RequestContext,
} from '../../database/request-context';

export const META_PUBLIC = 'polaris:public';
export const META_SCOPE = 'polaris:scope';
export const META_PERMISSION = 'polaris:permission';
export const META_RATE_LIMIT = 'polaris:rate-limit';
export const META_NO_TX = 'polaris:no-tx';
export const META_AUDIT = 'polaris:audit';
export const META_API_DOC = 'polaris:api-doc';

/** Route sans authentification (login, webhooks, health). */
export const Public = () => SetMetadata(META_PUBLIC, true);

export type RouteScope = 'tenant' | 'platform' | 'identity';
/**
 * Portée d'une route :
 *  - tenant   (défaut) : exige un membership tenant actif ; transaction RLS automatique
 *  - platform          : exige un membership PLATFORM ; transaction BYPASSRLS
 *  - identity          : utilisateur authentifié, sans tenant (GET /me, sessions)
 */
export const Scope = (scope: RouteScope) => SetMetadata(META_SCOPE, scope);

/** Permission requise ; plusieurs = l'une d'elles suffit (ex. TAKE_ATTENDANCE ou TAKE_ATTENDANCE_ANY). */
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(META_PERMISSION, permissions);

export interface RateLimitOptions {
  /** Nombre de requêtes autorisées par fenêtre. */
  points: number;
  /** Fenêtre en secondes. */
  duration: number;
  keyBy?: 'ip' | 'user' | 'tenant' | 'identifier';
  name?: string;
}
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(META_RATE_LIMIT, opts);

/** Désactive la transaction automatique (handler qui appelle un service externe). */
export const NoTransaction = () => SetMetadata(META_NO_TX, true);

export interface AuditOptions {
  action: string;
  entityType: string;
}
/** Journalise automatiquement l'appel (entité, acteur, résultat) dans audit_logs. */
export const Audited = (opts: AuditOptions) => SetMetadata(META_AUDIT, opts);

export interface ApiDocOptions {
  summary: string;
  tags?: string[];
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
  response?: ZodSchema;
  status?: number;
  deprecated?: boolean;
}
/** Métadonnées OpenAPI (source de la spec générée par scripts/generate-openapi.ts). */
export const ApiDoc = (opts: ApiDocOptions) => SetMetadata(META_API_DOC, opts);

export const ZodBody = (schema: ZodSchema) => Body(new ZodValidationPipe(schema));
export const ZodQuery = (schema: ZodSchema) => Query(new ZodValidationPipe(schema));
export const ZodParams = (schema: ZodSchema) => Param(new ZodValidationPipe(schema));

export const CurrentActor = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): Actor => {
    const actor = RequestContextStore.require().actor;
    if (!actor) throw new Error('CurrentActor utilisé sur une route publique');
    return actor;
  },
);

export const Ctx = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): RequestContext => RequestContextStore.require(),
);
