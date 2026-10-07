import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { AnonymizationResult, PersonalDataExport, PrivacyRequest } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import { guardians, privacyRequests, students, tenants, users } from '../../../database/schema';
import { AuditService } from '../../audit';

type Row = Record<string, unknown>;
const MAX_ROWS = 5000;

/**
 * Données personnelles (Partie 11, loi 2017-20 / RGPD) :
 *  - export des données d'une personne (élève ou tuteur) en sections lisibles ;
 *  - anonymisation = effacement des champs identifiants, conservation des agrégats et des pièces financières
 *    (append-only, obligation comptable 10 ans) ; les notes libres et justificatifs sont vidés ;
 *  - rétention automatique : élèves partis depuis N ans (5 par défaut), tuteurs sans enfant depuis M ans (2).
 * Chaque opération est journalisée dans `privacy_requests` et dans l'audit.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  // ------------------------------------------------------------------ export

  async exportStudent(studentId: string, source: 'MANUAL' | 'SELF_SERVICE' = 'MANUAL') {
    const tx = this.db.current();
    const s = await tx.query.students.findFirst({
      where: and(eq(students.id, studentId), isNull(students.deletedAt)),
    });
    if (!s) throw AppError.notFound('Élève');
    const q = async (label: string, query: ReturnType<typeof sql>) =>
      [label, (await tx.execute<Row>(query)).rows] as const;
    const sections = Object.fromEntries(
      await Promise.all([
        q(
          'identite',
          sql`select matricule, first_name, last_name, birth_date::text, gender, status, left_at::text, notes, created_at
              from students where id = ${studentId}`,
        ),
        q(
          'inscriptions',
          sql`select g.name as groupe, y.label as annee, e.is_primary, e.enrolled_at::text, e.left_at::text
              from enrollments e join groups g on g.id = e.group_id join academic_years y on y.id = e.academic_year_id
              where e.student_id = ${studentId} order by e.enrolled_at`,
        ),
        q(
          'tuteurs',
          sql`select gu.first_name, gu.last_name, gu.phone_e164, gu.email, l.relationship, l.is_primary,
                     l.can_view_attendance, l.can_view_finance, l.can_pay, l.can_justify, l.linked_at as lie_le, l.unlinked_at as delie_le
              from student_guardians l join guardians gu on gu.id = l.guardian_id where l.student_id = ${studentId}`,
        ),
        q(
          'assiduite',
          sql`select (se.starts_at at time zone 'UTC')::text as seance, sub.name as matière, r.status, r.excuse_status, r.late_minutes, r.note
              from attendance_records r join sessions se on se.id = r.session_id
              join course_offerings co on co.id = se.course_offering_id join subjects sub on sub.id = co.subject_id
              where r.student_id = ${studentId} order by se.starts_at desc limit ${MAX_ROWS}`,
        ),
        q(
          'justificatifs',
          sql`select from_date::text, to_date::text, reason, status, document_key, submitted_by_kind, review_comment, created_at
              from absence_justifications where student_id = ${studentId} order by created_at desc`,
        ),
        q(
          'alertes',
          sql`select kind, window_from::text, window_to::text, count, created_at, resolved_at from attendance_alerts where student_id = ${studentId}`,
        ),
        q(
          'creances',
          sql`select f.total_amount, f.adjustments_total, f.amount_allocated, f.status, f.created_at
              from student_fees f where f.student_id = ${studentId} order by f.created_at`,
        ),
        q(
          'paiements',
          sql`select p.amount, p.method, p.source, p.status, p.value_date::text, p.reference, p.payer_name, p.created_at
              from payments p where p.student_id = ${studentId} order by p.created_at desc limit ${MAX_ROWS}`,
        ),
        q(
          'recus',
          sql`select r.number, r.kind, r.created_at from receipts r join payments p on p.id = r.payment_id where p.student_id = ${studentId} order by r.created_at desc limit ${MAX_ROWS}`,
        ),
        q(
          'tentatives_paiement',
          sql`select provider, amount, status, created_at, completed_at from payment_attempts where student_id = ${studentId} order by created_at desc limit ${MAX_ROWS}`,
        ),
        q(
          'notifications',
          sql`select kind, channel, status, title, created_at, sent_at from notifications where student_id = ${studentId} order by created_at desc limit ${MAX_ROWS}`,
        ),
        q(
          'journal_audit',
          sql`select action, occurred_at, actor_user_id from audit_logs where entity_type = 'Student' and entity_id = ${studentId} order by occurred_at desc limit ${MAX_ROWS}`,
        ),
      ]),
    );
    return this.finishExport(tx, 'STUDENT', studentId, sections, source);
  }

  async exportGuardian(guardianId: string, source: 'MANUAL' | 'SELF_SERVICE' = 'MANUAL') {
    const tx = this.db.current();
    const g = await tx.query.guardians.findFirst({
      where: and(eq(guardians.id, guardianId), isNull(guardians.deletedAt)),
    });
    if (!g) throw AppError.notFound('Tuteur');
    const q = async (label: string, query: ReturnType<typeof sql>) =>
      [label, (await tx.execute<Row>(query)).rows] as const;
    const uid = g.userId;
    const sections = Object.fromEntries(
      await Promise.all([
        q(
          'identite',
          sql`select first_name, last_name, phone_e164, email, preferred_channel, locale, invited_at, created_at from guardians where id = ${guardianId}`,
        ),
        q(
          'compte',
          uid
            ? sql`select email, phone_e164, display_name, mfa_enabled, last_login_at, created_at from users where id = ${uid}`
            : sql`select null::text as email where false`,
        ),
        q(
          'enfants',
          sql`select s.first_name, s.last_name, s.matricule, l.relationship, l.is_primary, l.linked_at as lie_le, l.unlinked_at as delie_le
              from student_guardians l join students s on s.id = l.student_id where l.guardian_id = ${guardianId}`,
        ),
        q(
          'paiements_effectues',
          uid
            ? sql`select p.amount, p.method, p.source, p.status, p.value_date::text, p.reference, p.created_at from payments p where p.payer_user_id = ${uid} order by p.created_at desc limit ${MAX_ROWS}`
            : sql`select null::text as amount where false`,
        ),
        q(
          'notifications',
          uid
            ? sql`select kind, channel, status, title, created_at, sent_at, read_at from notifications where recipient_user_id = ${uid} order by created_at desc limit ${MAX_ROWS}`
            : sql`select null::text as kind where false`,
        ),
        q(
          'preferences_notifications',
          uid
            ? sql`select kind, channels, updated_at from notification_preferences where user_id = ${uid}`
            : sql`select null::text as kind where false`,
        ),
        q(
          'journal_audit',
          sql`select action, occurred_at, actor_user_id from audit_logs where entity_type = 'Guardian' and entity_id = ${guardianId} order by occurred_at desc limit ${MAX_ROWS}`,
        ),
      ]),
    );
    return this.finishExport(tx, 'GUARDIAN', guardianId, sections, source);
  }

  private async finishExport(
    tx: Db,
    subjectType: 'STUDENT' | 'GUARDIAN',
    subjectId: string,
    sections: Record<string, Row[]>,
    source: 'MANUAL' | 'SELF_SERVICE',
  ): Promise<PersonalDataExport> {
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
    const counts = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length]));
    await this.logRequest(tx, { kind: 'EXPORT', subjectType, subjectId, source, summary: counts });
    await this.audit.record({
      action: 'privacy.export',
      entityType: subjectType === 'STUDENT' ? 'Student' : 'Guardian',
      entityId: subjectId,
      metadata: { counts, source },
    });
    return {
      generatedAt: new Date().toISOString(),
      subject: { type: subjectType, id: subjectId },
      tenant: { id: tenant.id, code: tenant.code, name: tenant.name },
      sections: sections as PersonalDataExport['sections'],
      counts,
    };
  }

  // ------------------------------------------------------------------ anonymisation

  /**
   * Élève : refusé s'il est encore actif ou si le délai de conservation n'est pas écoulé, sauf `force`
   * (demande explicite documentée). Identité, notes, justificatifs et notifications sont effacés ; les
   * enregistrements de présence, créances, paiements et reçus sont conservés (sans nom hors des pièces comptables).
   */
  async anonymizeStudent(
    studentId: string,
    input: { reason: string; force?: boolean },
    source: 'MANUAL' | 'RETENTION' = 'MANUAL',
  ): Promise<AnonymizationResult> {
    const tx = this.db.current();
    const s = await tx.query.students.findFirst({
      where: and(eq(students.id, studentId), isNull(students.deletedAt)),
    });
    if (!s) throw AppError.notFound('Élève');
    if (s.anonymizedAt) throw AppError.conflict('Élève déjà anonymisé');
    if (s.status === 'ACTIVE')
      throw AppError.conflict(
        "Un élève actif ne peut pas être anonymisé : marquez d'abord son départ",
      );
    const years = await this.retentionYears(tx, 'studentRetentionYears', 5);
    const since = s.leftAt ? new Date(s.leftAt) : s.updatedAt;
    const eligibleAt = new Date(since);
    eligibleAt.setFullYear(eligibleAt.getFullYear() + years);
    if (!input.force && eligibleAt.getTime() > Date.now())
      throw AppError.conflict(
        `Délai de conservation non écoulé (anonymisation automatique le ${eligibleAt.toISOString().slice(0, 10)}) ; utilisez « force » pour une demande explicite`,
      );
    const tag = this.tag(studentId);
    const touched: Record<string, number> = {};
    const run = async (label: string, query: ReturnType<typeof sql>) => {
      touched[label] = (await tx.execute(query)).rowCount ?? 0;
    };
    await run(
      'students',
      sql`update students set first_name = 'Élève', last_name = ${'ANONYMISÉ-' + tag}, birth_date = null, gender = null,
            photo_key = null, notes = null, matricule = ${'ANON-' + tag}, anonymized_at = now() where id = ${studentId}`,
    );
    await run(
      'attendance_records',
      sql`update attendance_records set note = null where student_id = ${studentId} and note is not null`,
    );
    await run(
      'absence_justifications',
      sql`update absence_justifications set reason = '[anonymisé]', document_key = null, review_comment = null where student_id = ${studentId}`,
    );
    await run(
      'notifications',
      sql`update notifications set title = '[anonymisé]', body = '[anonymisé]' where student_id = ${studentId}`,
    );
    await run(
      'student_guardians',
      sql`update student_guardians set unlinked_at = coalesce(unlinked_at, now()) where student_id = ${studentId}`,
    );
    await this.logRequest(tx, {
      kind: 'ERASURE',
      subjectType: 'STUDENT',
      subjectId: studentId,
      source,
      reason: input.reason,
      summary: touched,
    });
    await this.audit.record({
      action: 'privacy.anonymize_student',
      entityType: 'Student',
      entityId: studentId,
      metadata: { reason: input.reason, source, force: input.force === true, touched },
    });
    return {
      subjectType: 'STUDENT',
      subjectId: studentId,
      anonymizedAt: new Date().toISOString(),
      touched,
    };
  }

  /** Tuteur : refusé tant qu'un enfant lui est rattaché. Le compte utilisateur est désactivé s'il n'a plus d'autre appartenance. */
  async anonymizeGuardian(
    guardianId: string,
    input: { reason: string; force?: boolean },
    source: 'MANUAL' | 'RETENTION' = 'MANUAL',
  ): Promise<AnonymizationResult> {
    const tx = this.db.current();
    const g = await tx.query.guardians.findFirst({
      where: and(eq(guardians.id, guardianId), isNull(guardians.deletedAt)),
    });
    if (!g) throw AppError.notFound('Tuteur');
    if (g.anonymizedAt) throw AppError.conflict('Tuteur déjà anonymisé');
    const links = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from student_guardians where guardian_id = ${guardianId} and unlinked_at is null`,
    );
    if ((links.rows[0]?.n ?? 0) > 0)
      throw AppError.conflict("Ce tuteur a encore un enfant rattaché : déliez d'abord");
    const tag = this.tag(guardianId);
    // Numéro de substitution valide au sens du CHECK E.164 et unique par tenant (préfixe réservé +99).
    const phone = `+99${String(parseInt(tag, 16)).padStart(10, '0').slice(0, 10)}`;
    const touched: Record<string, number> = {};
    const run = async (label: string, query: ReturnType<typeof sql>) => {
      touched[label] = (await tx.execute(query)).rowCount ?? 0;
    };
    await run(
      'guardians',
      sql`update guardians set first_name = 'Tuteur', last_name = ${'ANONYMISÉ-' + tag}, phone_e164 = ${phone},
            email = null, user_id = null, anonymized_at = now() where id = ${guardianId}`,
    );
    if (g.userId) {
      const others = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from memberships where user_id = ${g.userId} and status = 'ACTIVE' and tenant_id <> ${this.tenantId}`,
      );
      await run(
        'memberships',
        sql`update memberships set status = 'DISABLED' where user_id = ${g.userId} and tenant_id = ${this.tenantId}`,
      );
      await run(
        'notifications',
        sql`update notifications set title = '[anonymisé]', body = '[anonymisé]' where recipient_user_id = ${g.userId} and tenant_id = ${this.tenantId}`,
      );
      if ((others.rows[0]?.n ?? 0) === 0) {
        await run(
          'users',
          sql`update users set email = ${'anon-' + tag.toLowerCase() + '@anonymise.invalid'}, phone_e164 = null, display_name = 'Compte anonymisé',
                password_hash = null, status = 'DISABLED', token_version = token_version + 1, anonymized_at = now() where id = ${g.userId}`,
        );
        await run(
          'refresh_tokens',
          sql`update refresh_tokens set revoked_at = now(), revoked_reason = 'anonymized' where user_id = ${g.userId} and revoked_at is null`,
        );
      }
    }
    await this.logRequest(tx, {
      kind: 'ERASURE',
      subjectType: 'GUARDIAN',
      subjectId: guardianId,
      source,
      reason: input.reason,
      summary: touched,
    });
    await this.audit.record({
      action: 'privacy.anonymize_guardian',
      entityType: 'Guardian',
      entityId: guardianId,
      metadata: { reason: input.reason, source, touched },
    });
    return {
      subjectType: 'GUARDIAN',
      subjectId: guardianId,
      anonymizedAt: new Date().toISOString(),
      touched,
    };
  }

  // ------------------------------------------------------------------ rétention automatique

  /** Worker (quotidien) : applique les durées de conservation du tenant. */
  async retention(tenantId: string) {
    return this.db.withTenantTx(tenantId, async (tx) => {
      const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
      const privacy = (tenant.settings as { privacy?: Record<string, unknown> }).privacy ?? {};
      if (privacy['automaticRetentionEnabled'] === false)
        return {
          ranAt: new Date().toISOString(),
          studentsAnonymized: 0,
          guardiansAnonymized: 0,
          skipped: true,
        };
      const years = Number(privacy['studentRetentionYears'] ?? 5);
      const gYears = Number(privacy['inactiveGuardianYears'] ?? 2);
      const dueStudents = await tx.execute<{ id: string }>(sql`
        select id from students where deleted_at is null and anonymized_at is null and status in ('LEFT','GRADUATED')
          and coalesce(left_at::timestamptz, updated_at) < now() - make_interval(years => ${years}::int) limit 200`);
      let studentsAnonymized = 0;
      for (const r of dueStudents.rows) {
        await this.anonymizeStudent(
          r.id,
          { reason: `Rétention : ${years} ans après le départ`, force: true },
          'RETENTION',
        );
        studentsAnonymized++;
      }
      const dueGuardians = await tx.execute<{ id: string }>(sql`
        select g.id from guardians g
        left join users u on u.id = g.user_id
        where g.deleted_at is null and g.anonymized_at is null
          and not exists (select 1 from student_guardians l where l.guardian_id = g.id and l.unlinked_at is null)
          and coalesce(u.last_login_at, g.updated_at) < now() - make_interval(years => ${gYears}::int)
        limit 200`);
      let guardiansAnonymized = 0;
      for (const r of dueGuardians.rows) {
        await this.anonymizeGuardian(
          r.id,
          { reason: `Rétention : ${gYears} ans sans enfant rattaché` },
          'RETENTION',
        );
        guardiansAnonymized++;
      }
      if (studentsAnonymized || guardiansAnonymized)
        this.logger.log({
          msg: 'privacy retention applied',
          tenantId,
          studentsAnonymized,
          guardiansAnonymized,
        });
      return {
        ranAt: new Date().toISOString(),
        studentsAnonymized,
        guardiansAnonymized,
        skipped: false,
      };
    });
  }

  async requests(limit = 100): Promise<PrivacyRequest[]> {
    const tx = this.db.current();
    const rows = await tx
      .select({ r: privacyRequests, by: users.displayName })
      .from(privacyRequests)
      .leftJoin(users, eq(users.id, privacyRequests.requestedBy))
      .orderBy(desc(privacyRequests.createdAt))
      .limit(limit);
    return rows.map((x) => ({
      id: x.r.id,
      kind: x.r.kind,
      subjectType: x.r.subjectType,
      subjectId: x.r.subjectId,
      requestedByName: x.by,
      reason: x.r.reason,
      source: x.r.source,
      summary: x.r.summary,
      createdAt: x.r.createdAt.toISOString(),
    }));
  }

  // ------------------------------------------------------------------ interne

  private async retentionYears(tx: Db, key: string, fallback: number) {
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
    const privacy = (tenant.settings as { privacy?: Record<string, unknown> }).privacy ?? {};
    return Number(privacy[key] ?? fallback);
  }

  private tag(id: string) {
    return createHash('sha256').update(id).digest('hex').slice(0, 8).toUpperCase();
  }

  private async logRequest(
    tx: Db,
    r: {
      kind: 'EXPORT' | 'ERASURE';
      subjectType: 'STUDENT' | 'GUARDIAN';
      subjectId: string;
      source: 'MANUAL' | 'RETENTION' | 'SELF_SERVICE';
      reason?: string;
      summary: Record<string, unknown>;
    },
  ) {
    await tx.insert(privacyRequests).values({
      id: randomUUID(),
      tenantId: this.tenantId,
      kind: r.kind,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      requestedBy: RequestContextStore.get()?.actor?.userId ?? null,
      reason: r.reason ?? null,
      source: r.source,
      summary: r.summary,
      createdAt: new Date(),
    });
  }
}
