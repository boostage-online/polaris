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

  /** URL publique de l'API (URL de webhook communiquée aux providers). */
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  /** Clé maître (base64, 32 octets) du chiffrement d'enveloppe des secrets provider (ADR-0010) ; KMS à terme. */
  PAYMENT_MASTER_KEY: z.string().min(16).default('dev-master-key-change-me-0123456789abcdef'),
  /** Provider de démonstration (états pilotables) : jamais en production. */
  PAYMENT_FAKE_PROVIDER_ENABLED: bool.default('true'),
  FEDAPAY_API_BASE_SANDBOX: z.string().url().default('https://sandbox-api.fedapay.com/v1'),
  FEDAPAY_API_BASE_LIVE: z.string().url().default('https://api.fedapay.com/v1'),
  KKIAPAY_API_BASE_SANDBOX: z.string().url().default('https://api-sandbox.kkiapay.me/api/v1'),
  KKIAPAY_API_BASE_LIVE: z.string().url().default('https://api.kkiapay.me/api/v1'),
  /** Délai d'un appel provider (ms) avant abandon ; au-delà, retries puis réconciliation. */
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(8000),
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
    if (parsed.data.PAYMENT_MASTER_KEY.startsWith('dev-master-key'))
      throw new Error('PAYMENT_MASTER_KEY doit être défini en production');
    if (parsed.data.PAYMENT_FAKE_PROVIDER_ENABLED)
      throw new Error('PAYMENT_FAKE_PROVIDER_ENABLED doit être false en production');
  }
  cached = parsed.data;
  return cached;
}

export const ENV = Symbol('ENV');
