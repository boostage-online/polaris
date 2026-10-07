/**
 * SDK TypeScript généré depuis l'OpenAPI de l'API (`pnpm openapi`).
 * `schema.d.ts` n'est pas versionné ; il est produit en CI et en local.
 */
import createClient, { type ClientOptions } from 'openapi-fetch';
import type { paths } from './schema';

export type PolarisClient = ReturnType<typeof createClient<paths>>;

export function createPolarisClient(options: ClientOptions & { baseUrl: string }): PolarisClient {
  return createClient<paths>({ credentials: 'include', ...options });
}
export type { paths };
