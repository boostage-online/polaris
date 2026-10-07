import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env';
import { AppError } from '../../../common/errors/app-error';
import { RedisService } from '../../shared';
import { ProviderError, type PaymentProvider, type ProviderCode } from '../domain/provider';
import { FakeProvider } from './fake.provider';
import { FedaPayProvider } from './fedapay.provider';
import { KKiaPayProvider } from './kkiapay.provider';

const CB_THRESHOLD = 5;
const CB_WINDOW_SECONDS = 60;
const CB_OPEN_SECONDS = 120;

/**
 * Registre des adaptateurs (un par code) et disjoncteur par (tenant, provider) dans Redis : après
 * 5 échecs réseau en une minute, le provider est déclaré indisponible 2 min (503 PROVIDER_UNAVAILABLE)
 * — on ne martèle pas un provider en panne et le parent a un message clair.
 */
@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly providers = new Map<ProviderCode, PaymentProvider>();
  readonly fake: FakeProvider | null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {
    this.providers.set(
      'FEDAPAY',
      new FedaPayProvider(
        { SANDBOX: env.FEDAPAY_API_BASE_SANDBOX, LIVE: env.FEDAPAY_API_BASE_LIVE },
        env.PROVIDER_TIMEOUT_MS,
      ),
    );
    this.providers.set(
      'KKIAPAY',
      new KKiaPayProvider(
        { SANDBOX: env.KKIAPAY_API_BASE_SANDBOX, LIVE: env.KKIAPAY_API_BASE_LIVE },
        env.PROVIDER_TIMEOUT_MS,
      ),
    );
    this.fake = env.PAYMENT_FAKE_PROVIDER_ENABLED
      ? new FakeProvider(redis.client, env.WEB_ORIGIN)
      : null;
    if (this.fake) this.providers.set('FAKE', this.fake);
  }

  available(): ProviderCode[] {
    return [...this.providers.keys()];
  }

  get(code: ProviderCode): PaymentProvider {
    const p = this.providers.get(code);
    if (!p)
      throw AppError.validation([{ path: 'provider', message: `Provider ${code} indisponible` }]);
    return p;
  }

  // ---------------------------------------------------------------- disjoncteur
  private key(tenantId: string, provider: string, part: 'fail' | 'open') {
    return `payments:cb:${tenantId}:${provider}:${part}`;
  }

  async health(tenantId: string, provider: string) {
    const [open, fails] = await Promise.all([
      this.redis.client.get(this.key(tenantId, provider, 'open')),
      this.redis.client.get(this.key(tenantId, provider, 'fail')),
    ]);
    return { circuitOpen: Boolean(open), failuresLastMinute: Number(fails ?? 0) };
  }

  /** Exécute un appel provider sous disjoncteur ; les erreurs réseau comptent, les refus métier non. */
  async guard<T>(tenantId: string, provider: string, fn: () => Promise<T>): Promise<T> {
    if (await this.redis.client.get(this.key(tenantId, provider, 'open')))
      throw new ProviderError('UNAVAILABLE', 'Provider déclaré indisponible (disjoncteur ouvert)');
    try {
      const out = await fn();
      await this.redis.client.del(this.key(tenantId, provider, 'fail'));
      return out;
    } catch (e) {
      if (e instanceof ProviderError && (e.kind === 'UNAVAILABLE' || e.kind === 'TIMEOUT')) {
        const k = this.key(tenantId, provider, 'fail');
        const n = await this.redis.client.incr(k);
        if (n === 1) await this.redis.client.expire(k, CB_WINDOW_SECONDS);
        if (n >= CB_THRESHOLD) {
          await this.redis.client.set(
            this.key(tenantId, provider, 'open'),
            '1',
            'EX',
            CB_OPEN_SECONDS,
          );
          this.logger.warn({
            msg: 'payment provider circuit opened',
            tenantId,
            provider,
            failures: n,
          });
        }
      }
      throw e;
    }
  }

  async resetCircuit(tenantId: string, provider: string) {
    await this.redis.client.del(
      this.key(tenantId, provider, 'open'),
      this.key(tenantId, provider, 'fail'),
    );
  }
}
