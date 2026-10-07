import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { ENV, type Env } from '../config/env';
import * as schema from './schema';
import { RequestContextStore, type Db } from './request-context';

/**
 * Accès base de données (ADR-0002).
 *
 * - `appPool`      : rôle applicatif sans BYPASSRLS. Toute requête métier passe par `withTenantTx`,
 *                    qui pose `SET LOCAL app.tenant_id` ; hors contexte, RLS renvoie zéro ligne.
 * - `platformPool` : rôle BYPASSRLS. Réservé au module Platform, à la connexion (identité globale)
 *                    et aux jobs transverses (relais outbox). Chaque usage est tracé en log.
 *
 * Les services n'accèdent jamais aux pools : ils utilisent `db.current()` qui renvoie la transaction
 * du contexte courant et échoue bruyamment s'il n'y en a pas.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly appPool: Pool;
  readonly platformPool: Pool;
  private readonly appDb: Db;
  private readonly platformDb: Db;

  constructor(@Inject(ENV) env: Env) {
    this.appPool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      application_name: 'polaris-app',
    });
    this.platformPool = new Pool({
      connectionString: env.DATABASE_URL_PLATFORM,
      max: 5,
      application_name: 'polaris-platform',
    });
    this.appDb = drizzle(this.appPool, { schema });
    this.platformDb = drizzle(this.platformPool, { schema });
  }

  /** Transaction courante. Lève une erreur hors de withTenantTx / withPlatformTx. */
  current(): Db {
    const ctx = RequestContextStore.get();
    if (!ctx?.tx) {
      throw new Error(
        'Aucune transaction active : encapsuler dans withTenantTx() ou withPlatformTx() (voir DatabaseService)',
      );
    }
    return ctx.tx;
  }

  /** Transaction scopée tenant : RLS active, `app.tenant_id` posé pour toute la transaction. */
  async withTenantTx<T>(tenantId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
    if (!tenantId) throw new Error('withTenantTx : tenantId manquant');
    return this.appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return this.runInTx(tx, 'app', tenantId, fn);
    });
  }

  /**
   * Transaction sans tenant sur le rôle applicatif : seules les tables hors RLS sont lisibles
   * (users, memberships, refresh_tokens…). Utilisée par l'authentification.
   */
  async withIdentityTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.appDb.transaction(async (tx) => this.runInTx(tx, 'app', null, fn));
  }

  /** Transaction BYPASSRLS. Usage restreint et journalisé. */
  async withPlatformTx<T>(reason: string, fn: (tx: Db) => Promise<T>): Promise<T> {
    this.logger.debug({ msg: 'platform transaction', reason });
    return this.platformDb.transaction(async (tx) => this.runInTx(tx, 'platform', null, fn));
  }

  private runInTx<T>(
    tx: Db,
    pool: 'app' | 'platform',
    tenantId: string | null,
    fn: (tx: Db) => Promise<T>,
  ) {
    const parent = RequestContextStore.get() ?? RequestContextStore.blank();
    return RequestContextStore.run(
      { ...parent, tx, pool, tenantId: tenantId ?? parent.tenantId },
      () => fn(tx),
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.appPool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await Promise.all([this.appPool.end(), this.platformPool.end()]);
  }
}
