import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { OnboardingStatus } from '@polaris/contracts';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { tenants } from '../../../database/schema';
import { AuditService } from '../../audit';

type Counts = {
  years_current: number;
  levels: number;
  groups: number;
  subjects: number;
  courses: number;
  slots: number;
  sessions_ahead: number;
  staff_active: number;
  staff_invited: number;
  students_active: number;
  guardians: number;
  guardians_invited: number;
  guardians_activated: number;
  fee_structures: number;
  student_fees: number;
  payment_active: number;
  admin_mfa: number;
  sheets_submitted: number;
};

/**
 * Assistant de démarrage d'un établissement (Phase 7, G7 : onboardé par le support en moins de 2 h sans
 * développeur). L'état est calculé depuis les données — rien à maintenir à la main — et chaque étape
 * renvoie vers l'écran qui permet de la réaliser. Lecture seule, SQL brut (le module tenancy n'importe
 * aucun module métier).
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async status(): Promise<OnboardingStatus> {
    const tx = this.db.current();
    const tenantId = RequestContextStore.require().tenantId!;
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
    const c = (
      await tx.execute<Counts>(sql`
        select
          (select count(*) from academic_years where is_current)::int as years_current,
          (select count(*) from levels where deleted_at is null)::int as levels,
          (select count(*) from groups where deleted_at is null and kind = 'CLASS')::int as groups,
          (select count(*) from subjects where deleted_at is null)::int as subjects,
          (select count(*) from course_offerings where deleted_at is null)::int as courses,
          (select count(*) from schedule_slots)::int as slots,
          (select count(*) from sessions where starts_at >= now())::int as sessions_ahead,
          (select count(*) from memberships where tenant_id = ${tenantId}::uuid and kind = 'STAFF' and status = 'ACTIVE')::int as staff_active,
          (select count(*) from tenant_invitations where accepted_at is null and expires_at > now())::int as staff_invited,
          (select count(*) from students where deleted_at is null and status = 'ACTIVE')::int as students_active,
          (select count(*) from guardians where deleted_at is null)::int as guardians,
          (select count(*) from guardians where deleted_at is null and invited_at is not null)::int as guardians_invited,
          (select count(*) from guardians where deleted_at is null and user_id is not null)::int as guardians_activated,
          (select count(*) from fee_structures where deleted_at is null)::int as fee_structures,
          (select count(*) from student_fees where status <> 'CANCELLED')::int as student_fees,
          (select count(*) from tenant_payment_configs where status = 'ACTIVE')::int as payment_active,
          (select count(*) from memberships m join users u on u.id = m.user_id
             join membership_roles mr on mr.membership_id = m.id join roles r on r.id = mr.role_id
            where m.tenant_id = ${tenantId}::uuid and m.status = 'ACTIVE' and r.system_code = 'ADMIN' and u.mfa_enabled)::int as admin_mfa,
          (select count(*) from attendance_sheets where status in ('SUBMITTED','LOCKED'))::int as sheets_submitted`)
    ).rows[0]!;
    const settings = tenant.settings as {
      attendance?: Record<string, unknown>;
      notifications?: Record<string, unknown>;
      onboarding?: { dismissedAt?: string | null };
    };
    const steps: OnboardingStatus['steps'] = [
      {
        key: 'year',
        title: 'Année scolaire courante',
        description: 'Créer l’année en cours et la marquer comme courante.',
        done: c.years_current > 0,
        optional: false,
        href: '/structure',
        permission: 'MANAGE_ACADEMIC_STRUCTURE',
        detail: c.years_current > 0 ? 'Année courante définie' : null,
      },
      {
        key: 'structure',
        title: 'Niveaux et classes',
        description: 'Programmes, niveaux et au moins une classe.',
        done: c.levels > 0 && c.groups > 0,
        optional: false,
        href: '/structure',
        permission: 'MANAGE_ACADEMIC_STRUCTURE',
        detail: `${c.levels} niveau(x), ${c.groups} classe(s)`,
      },
      {
        key: 'courses',
        title: 'Matières, cours et emplois du temps',
        description: 'Les séances sont générées automatiquement depuis les créneaux.',
        done: c.subjects > 0 && c.courses > 0 && c.slots > 0,
        optional: false,
        href: '/courses',
        permission: 'MANAGE_SCHEDULES',
        detail: `${c.courses} cours, ${c.slots} créneau(x), ${c.sessions_ahead} séance(s) à venir`,
      },
      {
        key: 'staff',
        title: 'Personnel invité',
        description: 'Inviter les enseignants, la vie scolaire, la scolarité et la finance.',
        done: c.staff_active >= 2,
        optional: false,
        href: '/staff',
        permission: 'MANAGE_USERS',
        detail: `${c.staff_active} membre(s) actif(s), ${c.staff_invited} invitation(s) en attente`,
      },
      {
        key: 'students',
        title: 'Élèves importés',
        description: 'Import CSV guidé (essai à blanc puis import réel) ou saisie manuelle.',
        done: c.students_active > 0,
        optional: false,
        href: '/imports',
        permission: 'IMPORT_STUDENTS',
        detail: `${c.students_active} élève(s) actif(s)`,
      },
      {
        key: 'guardians',
        title: 'Tuteurs rattachés et invités',
        description: 'Importer les tuteurs, vérifier les liens, envoyer les invitations par SMS.',
        done: c.guardians > 0 && c.guardians_invited > 0,
        optional: false,
        href: '/guardians',
        permission: 'MANAGE_GUARDIANS',
        detail: `${c.guardians} tuteur(s), ${c.guardians_invited} invité(s), ${c.guardians_activated} activé(s)`,
      },
      {
        key: 'attendance-settings',
        title: 'Règles d’assiduité',
        description:
          'Seuil retard → absence, fenêtre de correction, justificatifs par les parents, seuils d’alerte.',
        done: Boolean(settings.attendance && Object.keys(settings.attendance).length > 0),
        optional: true,
        href: '/settings',
        permission: 'MANAGE_TENANT_SETTINGS',
        detail: null,
      },
      {
        key: 'notifications-settings',
        title: 'Notifications et quota SMS',
        description: 'Plafond mensuel de SMS et heures de silence.',
        done: Boolean(settings.notifications && Object.keys(settings.notifications).length > 0),
        optional: true,
        href: '/settings',
        permission: 'MANAGE_TENANT_SETTINGS',
        detail: null,
      },
      {
        key: 'fees',
        title: 'Grilles de frais et affectation',
        description: 'Catalogue de frais, grilles par niveau, affectation de masse aux élèves.',
        done: c.fee_structures > 0 && c.student_fees > 0,
        optional: true,
        href: '/finance/catalog',
        permission: 'MANAGE_FEE_STRUCTURES',
        detail: `${c.fee_structures} grille(s), ${c.student_fees} créance(s)`,
      },
      {
        key: 'payments',
        title: 'Paiement en ligne',
        description: 'Clés du provider (FedaPay ou KKiaPay), test de connexion, activation.',
        done: c.payment_active > 0,
        optional: true,
        href: '/settings/payments',
        permission: 'MANAGE_PAYMENT_PROVIDER',
        detail: c.payment_active > 0 ? 'Provider actif' : 'Aucun provider actif',
      },
      {
        key: 'mfa',
        title: 'MFA de l’administrateur',
        description: 'Authentification à deux facteurs activée pour chaque compte administrateur.',
        done: c.admin_mfa > 0,
        optional: false,
        href: '/settings/security',
        permission: 'MANAGE_TENANT_SETTINGS',
        detail: `${c.admin_mfa} administrateur(s) avec MFA`,
      },
      {
        key: 'first-sheet',
        title: 'Premier appel soumis',
        description:
          'Un enseignant a fait l’appel : le circuit complet (séance → feuille → notification) fonctionne.',
        done: c.sheets_submitted > 0,
        optional: true,
        href: '/attendance/sheets',
        permission: 'VIEW_ATTENDANCE_ANY',
        detail: `${c.sheets_submitted} feuille(s) soumise(s)`,
      },
    ];
    const required = steps.filter((s) => !s.optional);
    return {
      steps,
      completed: steps.filter((s) => s.done).length,
      required: required.length,
      total: steps.length,
      ready: required.every((s) => s.done),
      dismissedAt: settings.onboarding?.dismissedAt ?? null,
    };
  }

  async dismiss(dismissed: boolean) {
    const tx = this.db.current();
    const tenantId = RequestContextStore.require().tenantId!;
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
    const settings = tenant.settings;
    const merged = {
      ...settings,
      onboarding: {
        ...(settings['onboarding'] as object | undefined),
        dismissedAt: dismissed ? new Date().toISOString() : null,
      },
    };
    await tx.update(tenants).set({ settings: merged }).where(eq(tenants.id, tenantId));
    await this.audit.record({
      action: dismissed ? 'onboarding.dismissed' : 'onboarding.reopened',
      entityType: 'Tenant',
      entityId: tenantId,
    });
    return this.status();
  }
}
