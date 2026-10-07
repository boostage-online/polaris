import { z } from 'zod';

const bool = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.literal('')])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  DATABASE_URL_PLATFORM: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_PRIVATE_JWK: z.string().optional().default(''),
  JWT_PUBLIC_JWK: z.string().optional().default(''),
  JWT_KID: z.string().default('dev-1'),
  JWT_ISSUER: z.string().default('polaris'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  /** Plafond global par IP et par minute (les routes sensibles ont leurs propres limites). */
  RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  /** Secret de l'empreinte de vérification des reçus (QR / page publique). */
  RECEIPT_SECRET: z.string().min(16).default('dev-receipt-secret-change-me'),
  REFRESH_TOKEN_TTL_DAYS_STAFF: z.coerce.number().int().min(1).default(30),
  REFRESH_TOKEN_TTL_DAYS_GUARDIAN: z.coerce.number().int().min(1).default(90),
  REFRESH_TOKEN_TTL_HOURS_PLATFORM: z.coerce.number().int().min(1).default(8),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool.default('false'),

  SMS_PROVIDER: z.enum(['log']).default('log'),
  EMAIL_PROVIDER: z.enum(['log']).default('log'),
  SENTRY_DSN: z.string().optional().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Lit et valide l'environnement une seule fois ; échoue au démarrage si une variable manque. */
export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (!parsed.data.JWT_PRIVATE_JWK || !parsed.data.JWT_PUBLIC_JWK) {
      throw new Error('JWT_PRIVATE_JWK et JWT_PUBLIC_JWK sont obligatoires en production');
    }
    if (!parsed.data.COOKIE_SECURE) throw new Error('COOKIE_SECURE doit être true en production');
    if (parsed.data.RECEIPT_SECRET === 'dev-receipt-secret-change-me')
      throw new Error('RECEIPT_SECRET doit être défini en production');
  }
  cached = parsed.data;
  return cached;
}

export const ENV = Symbol('ENV');
