import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Availability, PublicStatus } from '@polaris/contracts';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../database/database.service';
import type { Db } from '../../../database/request-context';
import { availabilityChecks } from '../../../database/schema';

/** Objectif G8 : disponibilité ≥ 99,5 % sur le mois. */
export const AVAILABILITY_TARGET = 99.5;
const PROBE_TIMEOUT_MS = 5_000;
const RETENTION_DAYS = 90;

/**
 * Disponibilité mesurée de l'intérieur (Phase 8, G8) : le worker sonde `/health/ready` chaque minute et
 * enregistre succès, latence et motif d'échec. La mesure est honnête mais partielle (elle ne voit pas une
 * panne réseau entre l'utilisateur et la plateforme) : une sonde externe (PaaS ou service tiers) la complète
 * en production ; les deux doivent raconter la même histoire.
 */
@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Une sonde : HTTP GET sur l'URL de santé (par défaut `API_PUBLIC_URL/api/v1/health/ready`), 5 s max. */
  async probe(url?: string) {
    const target = url ?? `${this.env.API_PUBLIC_URL}/api/v1/health/ready`;
    const started = Date.now();
    let ok = false;
    let detail: string | null = null;
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      ok = res.status === 200;
      if (!ok) detail = `HTTP ${res.status}`;
    } catch (e) {
      detail =
        (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message.slice(0, 200);
    }
    const latencyMs = Date.now() - started;
    const checkedAt = new Date();
    await this.db.withPlatformTx('availability probe', (tx) =>
      tx.insert(availabilityChecks).values({ id: randomUUID(), checkedAt, ok, latencyMs, detail }),
    );
    if (!ok) this.logger.warn({ msg: 'availability probe failed', target, detail, latencyMs });
    return { ok, latencyMs, detail, checkedAt: checkedAt.toISOString() };
  }

  /** Purge des sondes de plus de 90 jours (appelée après la sonde, une fois par heure suffit). */
  async prune() {
    await this.db.withPlatformTx('availability prune', (tx) =>
      tx.execute(
        sql`delete from availability_checks where checked_at < now() - make_interval(days => ${RETENTION_DAYS})`,
      ),
    );
  }

  async stats(days = 30): Promise<Availability> {
    const tx = this.db.current();
    return this.computeStats(tx, days);
  }

  private async computeStats(tx: Db, days: number) {
    const [perDay, last] = await Promise.all([
      tx.execute<{ day: string; checks: number; failures: number; p95: number | null }>(sql`
        select to_char(checked_at at time zone 'UTC', 'YYYY-MM-DD') as day,
               count(*)::int as checks,
               count(*) filter (where not ok)::int as failures,
               (percentile_cont(0.95) within group (order by latency_ms))::int as p95
        from availability_checks
        where checked_at >= (current_date - make_interval(days => ${days - 1}))::timestamptz
        group by 1 order by 1`),
      tx.execute<{ checked_at: Date; ok: boolean }>(
        sql`select checked_at, ok from availability_checks order by checked_at desc limit 1`,
      ),
    ]);
    const checks = perDay.rows.reduce((a, d) => a + Number(d.checks), 0);
    const failures = perDay.rows.reduce((a, d) => a + Number(d.failures), 0);
    const availability =
      checks > 0 ? Math.round(((checks - failures) * 10000) / checks) / 100 : null;
    const l = last.rows[0];
    return {
      windowDays: days,
      checks,
      failures,
      availability,
      target: AVAILABILITY_TARGET,
      meetsTarget: availability === null ? null : availability >= AVAILABILITY_TARGET,
      lastCheckAt: l ? new Date(l.checked_at).toISOString() : null,
      lastCheckOk: l ? l.ok : null,
      days: perDay.rows.map((d) => ({
        day: d.day,
        checks: Number(d.checks),
        failures: Number(d.failures),
        availability:
          Number(d.checks) > 0
            ? Math.round(((Number(d.checks) - Number(d.failures)) * 10000) / Number(d.checks)) / 100
            : null,
        p95LatencyMs: d.p95 === null ? null : Number(d.p95),
      })),
    };
  }

  /** Page publique : état courant (3 dernières sondes) et disponibilité des 30 derniers jours. Rien d'autre. */
  async publicStatus(): Promise<PublicStatus> {
    return this.db.withPlatformTx('public status', async (tx) => {
      const [recent, stats] = await Promise.all([
        tx.execute<{ ok: boolean; checked_at: Date }>(
          sql`select ok, checked_at from availability_checks where checked_at >= now() - interval '15 minutes' order by checked_at desc limit 3`,
        ),
        this.computeStats(tx, 30),
      ]);
      const r = recent.rows;
      let status: PublicStatus['status'] = 'UNKNOWN';
      if (r.length > 0) {
        const failures = r.filter((x) => !x.ok).length;
        status = failures === 0 ? 'OPERATIONAL' : failures === r.length ? 'OUTAGE' : 'DEGRADED';
      }
      return {
        status,
        checkedAt: r[0] ? new Date(r[0].checked_at).toISOString() : null,
        availability30d: stats.availability,
        days: stats.days.map((d) => ({
          day: d.day,
          availability: d.availability,
          checks: d.checks,
        })),
      };
    });
  }
}
