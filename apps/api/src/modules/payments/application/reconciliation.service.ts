import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  paymentAttempts,
  paymentReconciliationRuns,
  providerTransactions,
  tenantPaymentConfigs,
  type ReconciliationOrphan,
} from '../../../database/schema';
import { AppError } from '../../../common/errors/app-error';
import { AuditService } from '../../audit';
import { OutboxService } from '../../shared';
import { RECONCILE_GRACE_HOURS } from '../domain/attempts';
import { paymentReviewNeeded } from '../domain/events';
import { ProviderError, type ProviderCode } from '../domain/provider';
import { ProviderRegistry } from '../infrastructure/provider-registry';
import { PaymentConfigService } from './payment-config.service';
import { PaymentsService } from './payments.service';

/**
 * Trois jobs (Partie 10) : `ReconcilePendingAttempts` (5 min), `ExpireStaleAttempts` (15 min),
 * `DailyProviderReconciliation` (J−1). Tous idempotents ; tous tournent tenant par tenant avec ses clés.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly registry: ProviderRegistry,
    private readonly configs: PaymentConfigService,
    private readonly payments: PaymentsService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  /** Tentatives PENDING/PROCESSING dont `next_check_at` est passé : `verify` + confirmation, backoff par tentative. */
  async reconcilePending(tenantId: string, now = new Date()) {
    const due = await this.db.withTenantTx(tenantId, (tx) =>
      this.payments.dueForReconciliation(tx, now),
    );
    let confirmed = 0;
    for (const a of due) {
      try {
        const r = await this.payments.confirmJob({
          tenantId,
          attemptId: a.id,
          source: 'RECONCILIATION',
        });
        if (r && r.status !== a.status) confirmed++;
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        // Déjà replanifié par `confirm` ; on n'insiste pas pendant la panne.
        if (e.kind === 'UNAVAILABLE') break;
      }
    }
    return { checked: due.length, changed: confirmed };
  }

  /** Au-delà de `expires_at + 24 h` : sans transaction connue → EXPIRED ; avec transaction mais provider muet → UNKNOWN + revue. */
  async expireStale(tenantId: string, now = new Date()) {
    return this.db.withTenantTx(tenantId, async (tx) => {
      const limit = new Date(now.getTime() - RECONCILE_GRACE_HOURS * 3_600_000);
      const stale = await tx
        .select()
        .from(paymentAttempts)
        .where(
          and(
            inArray(paymentAttempts.status, ['CREATED', 'PENDING', 'PROCESSING']),
            lt(paymentAttempts.expiresAt, limit),
          ),
        );
      let expired = 0;
      let unknown = 0;
      for (const a of stale) {
        if (!a.externalId) {
          await tx
            .update(paymentAttempts)
            .set({
              status: 'EXPIRED',
              failureCode: 'EXPIRED',
              failureMessage: 'Le délai de paiement est dépassé. Vous pouvez relancer un paiement.',
              completedAt: now,
              nextCheckAt: null,
            })
            .where(eq(paymentAttempts.id, a.id));
          expired++;
        } else {
          await tx
            .update(paymentAttempts)
            .set({
              status: 'UNKNOWN',
              reviewStatus: 'OPEN',
              failureCode: 'PROVIDER_MUTE',
              nextCheckAt: null,
            })
            .where(eq(paymentAttempts.id, a.id));
          await this.outbox.publish(
            paymentReviewNeeded({
              tenantId,
              attemptId: a.id,
              reason: 'PROVIDER_MUTE',
              amount: a.amount,
              externalId: a.externalId,
            }),
          );
          unknown++;
        }
      }
      if (expired || unknown)
        this.logger.log({ msg: 'stale attempts processed', tenantId, expired, unknown });
      return { expired, unknown };
    });
  }

  /**
   * Réconciliation quotidienne provider ↔ nous pour la journée `day` (défaut J−1) : transactions réussies côté
   * provider inconnues chez nous → orphelines (revue manuelle) ; écarts de montant → rapport.
   */
  async daily(tenantId: string, day?: string) {
    const target = day ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const from = new Date(`${target}T00:00:00Z`);
    const to = new Date(from.getTime() + 86_400_000);
    const config = await this.db.withTenantTx(tenantId, (tx) => this.configs.active(tx, tenantId));
    if (!config) return null;
    const provider = this.registry.get(config.provider);
    const runId = randomUUID();
    const base = {
      id: runId,
      tenantId,
      provider: config.provider,
      day: target,
      checked: 0,
      matched: 0,
      orphans: [] as ReconciliationOrphan[],
      mismatches: [] as {
        externalId: string;
        attemptId: string;
        expected: number;
        actual: number;
      }[],
      error: null as string | null,
      createdAt: new Date(),
    };
    if (!provider.listTransactions) {
      await this.db.withTenantTx(tenantId, (tx) =>
        tx.insert(paymentReconciliationRuns).values({
          ...base,
          status: 'UNSUPPORTED',
          error:
            'Ce provider ne liste pas ses transactions : rapprochement via son tableau de bord',
        }),
      );
      return runId;
    }
    try {
      const remote = await this.registry.guard(tenantId, config.provider, () =>
        provider.listTransactions!(this.configs.credentials(config), { from, to }),
      );
      await this.db.withTenantTx(tenantId, async (tx) => {
        const ids = remote.map((r) => r.externalId);
        const known = ids.length
          ? await tx
              .select({ t: providerTransactions, a: paymentAttempts })
              .from(providerTransactions)
              .innerJoin(paymentAttempts, eq(paymentAttempts.id, providerTransactions.attemptId))
              .where(inArray(providerTransactions.externalId, ids))
          : [];
        const byExternal = new Map(known.map((k) => [k.t.externalId, k]));
        const previousOrphans = await this.resolvedOrphanIds(tx, tenantId);
        for (const r of remote) {
          base.checked++;
          const k = byExternal.get(r.externalId);
          if (!k) {
            if (r.status === 'SUCCEEDED')
              base.orphans.push({
                externalId: r.externalId,
                amount: r.amount,
                occurredAt: r.occurredAt,
                resolved: previousOrphans.has(r.externalId),
              });
            continue;
          }
          if (r.status === 'SUCCEEDED' && k.a.status === 'SUCCEEDED' && r.amount !== k.a.amount)
            base.mismatches.push({
              externalId: r.externalId,
              attemptId: k.a.id,
              expected: k.a.amount,
              actual: r.amount,
            });
          else base.matched++;
          // Succès côté provider mais tentative encore ouverte chez nous : on confirme tout de suite.
          if (r.status === 'SUCCEEDED' && ['PENDING', 'PROCESSING', 'CREATED'].includes(k.a.status))
            await this.payments
              .confirmJob({ tenantId, attemptId: k.a.id, source: 'RECONCILIATION' })
              .catch(() => undefined);
        }
        const openOrphans = base.orphans.filter((o) => !o.resolved);
        const status = openOrphans.length || base.mismatches.length ? 'DISCREPANCIES' : 'OK';
        await tx.insert(paymentReconciliationRuns).values({ ...base, status });
        if (status === 'DISCREPANCIES') {
          for (const o of openOrphans)
            await this.outbox.publish(
              paymentReviewNeeded({
                tenantId,
                attemptId: null,
                reason: 'ORPHAN_TRANSACTION',
                amount: o.amount,
                externalId: o.externalId,
              }),
            );
          this.logger.warn({
            msg: 'provider reconciliation discrepancies',
            tenantId,
            orphans: openOrphans.length,
            mismatches: base.mismatches.length,
          });
        }
      });
    } catch (e) {
      await this.db.withTenantTx(tenantId, (tx) =>
        tx
          .insert(paymentReconciliationRuns)
          .values({ ...base, status: 'ERROR', error: (e as Error).message }),
      );
    }
    return runId;
  }

  private async resolvedOrphanIds(tx: Db, tenantId: string) {
    const rows = await tx.execute<{ external_id: string }>(sql`
      select o->>'externalId' as external_id from payment_reconciliation_runs r, jsonb_array_elements(r.orphans) o
      where r.tenant_id = ${tenantId}::uuid and (o->>'resolved')::boolean = true`);
    return new Set(rows.rows.map((r) => r.external_id));
  }

  async runs(limit = 30) {
    const rows = await this.db
      .current()
      .select()
      .from(paymentReconciliationRuns)
      .where(eq(paymentReconciliationRuns.tenantId, this.tenantId))
      .orderBy(desc(paymentReconciliationRuns.day), desc(paymentReconciliationRuns.createdAt))
      .limit(limit);
    return rows.map((r) => this.dto(r));
  }

  async resolveOrphan(runId: string, externalId: string, note: string) {
    const tx = this.db.current();
    const run = await tx.query.paymentReconciliationRuns.findFirst({
      where: eq(paymentReconciliationRuns.id, runId),
    });
    if (!run) throw AppError.notFound('Réconciliation');
    const orphan = run.orphans.find((o) => o.externalId === externalId);
    if (!orphan) throw AppError.notFound('Transaction orpheline');
    const orphans = run.orphans.map((o) =>
      o.externalId === externalId ? { ...o, resolved: true, note } : o,
    );
    await tx
      .update(paymentReconciliationRuns)
      .set({ orphans })
      .where(eq(paymentReconciliationRuns.id, runId));
    await this.audit.record({
      action: 'payment_reconciliation.orphan_resolved',
      entityType: 'PaymentReconciliationRun',
      entityId: runId,
      after: { externalId, note },
    });
    return this.dto(
      (await tx.query.paymentReconciliationRuns.findFirst({
        where: eq(paymentReconciliationRuns.id, runId),
      }))!,
    );
  }

  /** Écran « transactions en attente » : UNKNOWN en revue, PENDING anciens, orphelins non résolus, santé provider. */
  async pending() {
    const tx = this.db.current();
    const unknown = await tx
      .select()
      .from(paymentAttempts)
      .where(
        and(eq(paymentAttempts.tenantId, this.tenantId), eq(paymentAttempts.reviewStatus, 'OPEN')),
      )
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(100);
    const stale = await tx
      .select()
      .from(paymentAttempts)
      .where(
        and(
          inArray(paymentAttempts.status, ['PENDING', 'PROCESSING']),
          lt(paymentAttempts.createdAt, new Date(Date.now() - 30 * 60_000)),
        ),
      )
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(100);
    const runs = await this.runs(14);
    const orphans = runs.flatMap((r) =>
      r.orphans.filter((o) => !o.resolved).map((o) => ({ ...o, runId: r.id, day: r.day })),
    );
    const config = await this.configs.active(tx);
    const health = config ? await this.registry.health(this.tenantId, config.provider) : null;
    const [u, s] = await Promise.all([
      this.payments.dtos(tx, unknown),
      this.payments.dtos(tx, stale),
    ]);
    return {
      unknown: u,
      stalePending: s,
      orphans,
      counts: { unknown: u.length, stalePending: s.length, orphans: orphans.length },
      lastReconciliation: runs[0] ?? null,
      providerHealth: config && health ? { provider: config.provider, ...health } : null,
    };
  }

  private dto(r: typeof paymentReconciliationRuns.$inferSelect) {
    return {
      id: r.id,
      provider: r.provider as ProviderCode,
      day: r.day,
      status: r.status,
      checked: r.checked,
      matched: r.matched,
      orphans: r.orphans,
      mismatches: r.mismatches,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Tenants ayant une configuration active (boucle des crons). */
  async tenantsWithActiveConfig() {
    return this.db.withPlatformTx('payments active tenants', async (tx) =>
      (
        await tx
          .select({ tenantId: tenantPaymentConfigs.tenantId })
          .from(tenantPaymentConfigs)
          .where(eq(tenantPaymentConfigs.status, 'ACTIVE'))
      ).map((r) => r.tenantId),
    );
  }
}
