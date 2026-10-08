import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  LaunchChecklistSchema,
  type GoLiveInput,
  type LaunchChecklist,
  type LaunchReadiness,
} from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../database/database.service';
import { tenants } from '../../../database/schema';
import { AuditService } from '../../audit';
import { PlatformService } from '../../platform';
import { EMAIL_GATEWAY, type EmailGateway } from '../../shared';
import { OnboardingService } from '../../tenancy';

/**
 * Mise en production d'un établissement (Phase 8). La bascule n'est pas un simple changement de statut :
 * elle exige que l'assistant de démarrage soit complet, qu'un administrateur ait la MFA, que le paiement en
 * ligne (s'il est activé) soit en mode réel, que le budget SMS soit fixé, qu'aucune alerte ne soit ouverte,
 * et que les points humains (contrat, budget validé, astreinte prévenue, données validées) soient cochés.
 * Après la bascule, l'établissement entre en **hypercare** (28 jours par défaut) : la revue quotidienne le
 * détaille ligne par ligne.
 */
@Injectable()
export class LaunchService {
  private readonly logger = new Logger(LaunchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly onboarding: OnboardingService,
    private readonly platform: PlatformService,
    private readonly audit: AuditService,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async readiness(tenantId: string): Promise<LaunchReadiness> {
    const tx = this.db.current();
    const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!tenant) throw AppError.notFound('Établissement');
    // L'assistant lit les tables tenant sous RLS : transaction tenant dédiée, imbriquée dans la requête plateforme.
    const onboarding = await this.db.withTenantTx(tenantId, () => this.onboarding.status());
    const facts = (
      await tx.execute<{
        payment_live: number;
        payment_sandbox: number;
        sms_cap: number | null;
        open_alerts: number;
        admins: number;
        admins_mfa: number;
      }>(sql`
        select (select count(*) from tenant_payment_configs c where c.tenant_id = ${tenantId}::uuid and c.status = 'ACTIVE' and c.environment = 'LIVE')::int as payment_live,
               (select count(*) from tenant_payment_configs c where c.tenant_id = ${tenantId}::uuid and c.status = 'ACTIVE' and c.environment = 'SANDBOX')::int as payment_sandbox,
               (t.settings -> 'notifications' ->> 'smsMonthlyCap')::int as sms_cap,
               (select count(*) from platform_alerts a where a.tenant_id = t.id and a.resolved_at is null)::int as open_alerts,
               (select count(*) from memberships m join membership_roles mr on mr.membership_id = m.id join roles r on r.id = mr.role_id
                 where m.tenant_id = t.id and m.status = 'ACTIVE' and r.system_code = 'ADMIN')::int as admins,
               (select count(*) from memberships m join users u on u.id = m.user_id join membership_roles mr on mr.membership_id = m.id join roles r on r.id = mr.role_id
                 where m.tenant_id = t.id and m.status = 'ACTIVE' and r.system_code = 'ADMIN' and u.mfa_enabled)::int as admins_mfa
        from tenants t where t.id = ${tenantId}::uuid`)
    ).rows[0]!;
    const checklist = LaunchChecklistSchema.parse(tenant.launchChecklist ?? {});
    const missing = onboarding.steps.filter((s) => !s.optional && !s.done).map((s) => s.title);
    const checks: LaunchReadiness['checks'] = [
      {
        key: 'onboarding',
        title: 'Assistant de démarrage : étapes obligatoires terminées',
        ok: missing.length === 0,
        blocking: true,
        detail: missing.length
          ? `Manque : ${missing.join(', ')}`
          : `${onboarding.completed}/${onboarding.total} étapes`,
      },
      {
        key: 'admin-mfa',
        title: 'Chaque administrateur a activé la MFA',
        ok: facts.admins > 0 && facts.admins_mfa === facts.admins,
        blocking: true,
        detail: `${facts.admins_mfa}/${facts.admins} administrateur(s)`,
      },
      {
        key: 'payments-live',
        title: 'Paiement en ligne en mode réel (ou désactivé)',
        ok: facts.payment_sandbox === 0,
        blocking: true,
        detail:
          facts.payment_live > 0
            ? 'Provider actif en mode réel'
            : facts.payment_sandbox > 0
              ? 'Provider encore en bac à sable : passer aux clés réelles ou désactiver'
              : 'Paiement en ligne non activé (caisse manuelle seulement)',
      },
      {
        key: 'sms-cap',
        title: 'Plafond mensuel de SMS fixé avec l’établissement',
        ok: facts.sms_cap !== null && facts.sms_cap > 0,
        blocking: true,
        detail: facts.sms_cap
          ? `${facts.sms_cap} SMS / mois`
          : 'Aucun plafond explicite (2 000 par défaut)',
      },
      {
        key: 'alerts',
        title: 'Aucune alerte de supervision ouverte sur l’établissement',
        ok: facts.open_alerts === 0,
        blocking: false,
        detail: facts.open_alerts ? `${facts.open_alerts} alerte(s) ouverte(s)` : null,
      },
      {
        key: 'first-sheet',
        title: 'Un premier appel réel a été soumis',
        ok: onboarding.steps.find((s) => s.key === 'first-sheet')?.done ?? false,
        blocking: false,
        detail: null,
      },
      {
        key: 'checklist',
        title: 'Points humains confirmés (contrat, budget SMS, astreinte, données validées)',
        ok:
          checklist.contractSigned &&
          checklist.smsBudgetValidated &&
          checklist.onCallInformed &&
          checklist.dataValidatedByTenant,
        blocking: true,
        detail:
          Object.entries(checklist)
            .filter(([, v]) => !v)
            .map(([k]) => k)
            .join(', ') || 'Tous confirmés',
      },
    ];
    const now = Date.now();
    return {
      tenant: {
        id: tenant.id,
        code: tenant.code,
        name: tenant.name,
        status: tenant.status,
        plan: tenant.plan,
        liveAt: tenant.liveAt?.toISOString() ?? null,
        hypercareUntil: tenant.hypercareUntil?.toISOString() ?? null,
      },
      onboarding,
      checklist,
      checks,
      ready: checks.filter((c) => c.blocking).every((c) => c.ok),
      live: tenant.liveAt !== null && tenant.liveAt.getTime() <= now,
      inHypercare: tenant.hypercareUntil !== null && tenant.hypercareUntil.getTime() > now,
    };
  }

  async updateChecklist(tenantId: string, checklist: LaunchChecklist) {
    const tx = this.db.current();
    const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!tenant) throw AppError.notFound('Établissement');
    await tx
      .update(tenants)
      .set({ launchChecklist: { ...checklist } })
      .where(eq(tenants.id, tenantId));
    await this.audit.record({
      action: 'tenant.launch_checklist_updated',
      entityType: 'Tenant',
      entityId: tenantId,
      tenantId,
      before: tenant.launchChecklist,
      after: checklist,
    });
    return this.readiness(tenantId);
  }

  /** Bascule en production : refuse (409) tant qu'un point bloquant manque ; la checklist fournie est enregistrée d'abord. */
  async goLive(tenantId: string, input: GoLiveInput) {
    const tx = this.db.current();
    const before = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!before) throw AppError.notFound('Établissement');
    if (before.liveAt) throw AppError.conflict('Établissement déjà en production');
    await tx
      .update(tenants)
      .set({ launchChecklist: { ...input.checklist } })
      .where(eq(tenants.id, tenantId));
    const readiness = await this.readiness(tenantId);
    if (!readiness.ready) {
      const blocking = readiness.checks.filter((c) => c.blocking && !c.ok).map((c) => c.title);
      throw AppError.conflict(`Mise en production impossible : ${blocking.join(' ; ')}`);
    }
    const now = new Date();
    const hypercareUntil = new Date(now.getTime() + input.hypercareDays * 86_400_000);
    await tx
      .update(tenants)
      .set({ plan: input.plan, liveAt: now, hypercareUntil })
      .where(eq(tenants.id, tenantId));
    if (before.status !== 'ACTIVE') await this.platform.updateStatus(tenantId, 'ACTIVE');
    await this.audit.record({
      action: 'tenant.live',
      entityType: 'Tenant',
      entityId: tenantId,
      tenantId,
      before: { status: before.status, plan: before.plan },
      after: {
        status: 'ACTIVE',
        plan: input.plan,
        liveAt: now.toISOString(),
        hypercareUntil: hypercareUntil.toISOString(),
        notes: input.notes ?? null,
      },
    });
    await this.notifyTenantAdmins(tenantId, before.name, hypercareUntil);
    return this.readiness(tenantId);
  }

  private async notifyTenantAdmins(tenantId: string, name: string, hypercareUntil: Date) {
    const tx = this.db.current();
    const admins = await tx.execute<{ email: string }>(sql`
      select distinct u.email from users u
        join memberships m on m.user_id = u.id
        join membership_roles mr on mr.membership_id = m.id
        join roles r on r.id = mr.role_id
      where m.tenant_id = ${tenantId}::uuid and m.status = 'ACTIVE' and u.status = 'ACTIVE'
        and r.system_code = 'ADMIN' and u.email is not null`);
    const until = hypercareUntil.toISOString().slice(0, 10);
    const text = `Bonjour,\n\n${name} est désormais en production sur Polaris. Pendant la période d'accompagnement renforcé (jusqu'au ${until}), l'équipe Polaris revoit chaque matin les indicateurs de votre établissement (appels, notifications, paiements, quotas SMS) et vous contacte au moindre doute.\n\nSupport : ${this.env.WEB_ORIGIN} (Sécurité du compte → session de support) — support@polaris.app\n\nL'équipe Polaris`;
    for (const a of admins.rows) {
      try {
        await this.email.send({
          to: a.email,
          subject: `[Polaris] ${name} est en production`,
          text,
          reference: 'tenant-live',
        });
      } catch (e) {
        this.logger.error({ msg: 'go-live e-mail failed', err: (e as Error).message });
      }
    }
  }
}
