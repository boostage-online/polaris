import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { ReportDefinition, ReportKey, ReportResult } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import { tenants } from '../../../database/schema';
import { addDays, localDateParts } from '../../academic';
import { toCsv, type Cell } from '../infrastructure/csv';

type Row = Record<string, Cell>;
interface Period {
  from: string;
  to: string;
  groupId?: string;
}

/** Les huit rapports MVP (document directeur, Phase 6) : figés, exportables en CSV, filtrés par période et classe. */
export const REPORTS: ReportDefinition[] = [
  {
    key: 'attendance-by-group',
    title: 'Assiduité par classe',
    description:
      'Séances tenues, appels soumis, présences, absences, retards, non justifiées et taux de présence par classe.',
    family: 'attendance',
    permission: 'VIEW_ATTENDANCE_REPORTS',
    defaultDays: 30,
    columns: [
      { key: 'groupName', label: 'Classe' },
      { key: 'levelName', label: 'Niveau' },
      { key: 'sessionsHeld', label: 'Séances tenues' },
      { key: 'sheetsMissing', label: 'Appels manquants' },
      { key: 'records', label: 'Enregistrements' },
      { key: 'present', label: 'Présents' },
      { key: 'absent', label: 'Absents' },
      { key: 'late', label: 'Retards' },
      { key: 'excused', label: 'Excusés' },
      { key: 'unjustified', label: 'Non justifiées' },
      { key: 'presenceRate', label: 'Taux de présence (%)' },
    ],
  },
  {
    key: 'students-at-risk',
    title: 'Élèves à risque',
    description:
      'Élèves dont le taux de présence est sous 80 % ou qui cumulent 3 absences non justifiées sur la période, ou qui portent une alerte ouverte.',
    family: 'attendance',
    permission: 'VIEW_ATTENDANCE_REPORTS',
    defaultDays: 30,
    columns: [
      { key: 'lastName', label: 'Nom' },
      { key: 'firstName', label: 'Prénom' },
      { key: 'matricule', label: 'Matricule' },
      { key: 'groupName', label: 'Classe' },
      { key: 'sessions', label: 'Séances' },
      { key: 'absent', label: 'Absences' },
      { key: 'unjustified', label: 'Non justifiées' },
      { key: 'late', label: 'Retards' },
      { key: 'presenceRate', label: 'Taux de présence (%)' },
      { key: 'openAlert', label: 'Alerte ouverte' },
      { key: 'guardianPhone', label: 'Tuteur principal' },
    ],
  },
  {
    key: 'missing-sheets',
    title: 'Appels non réalisés',
    description: 'Séances terminées sans appel soumis, par enseignant et par classe.',
    family: 'attendance',
    permission: 'VIEW_ATTENDANCE_REPORTS',
    defaultDays: 14,
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'startsAt', label: 'Heure' },
      { key: 'groupName', label: 'Classe' },
      { key: 'subjectName', label: 'Matière' },
      { key: 'teachers', label: 'Enseignant(s)' },
      { key: 'sheetStatus', label: 'État de la feuille' },
    ],
  },
  {
    key: 'attendance-corrections',
    title: "Corrections d'appel par utilisateur",
    description:
      "Révisions d'enregistrements d'assiduité : auteur, motif, hors fenêtre — pour repérer les corrections anormales.",
    family: 'attendance',
    permission: 'VIEW_ATTENDANCE_REPORTS',
    defaultDays: 30,
    columns: [
      { key: 'author', label: 'Auteur' },
      { key: 'corrections', label: 'Corrections' },
      { key: 'outOfWindow', label: 'Hors fenêtre' },
      { key: 'toPresent', label: 'Vers présent' },
      { key: 'toAbsent', label: 'Vers absent' },
      { key: 'students', label: 'Élèves concernés' },
      { key: 'lastAt', label: 'Dernière correction' },
    ],
  },
  {
    key: 'collections-by-channel',
    title: 'Encaissements par canal',
    description:
      'Montants encaissés et annulés par canal (caisse par moyen, en ligne par provider), frais provider.',
    family: 'finance',
    permission: 'VIEW_FINANCIAL_REPORTS',
    defaultDays: 30,
    columns: [
      { key: 'channel', label: 'Canal' },
      { key: 'kind', label: 'Type' },
      { key: 'payments', label: 'Paiements' },
      { key: 'amount', label: 'Encaissé (FCFA)' },
      { key: 'reversedCount', label: 'Annulés' },
      { key: 'reversedAmount', label: 'Montant annulé (FCFA)' },
      { key: 'fees', label: 'Frais provider (FCFA)' },
      { key: 'share', label: 'Part (%)' },
    ],
  },
  {
    key: 'recovery-by-group',
    title: 'Recouvrement par classe',
    description:
      "Facturé, encaissé, reste à recouvrer, en retard et taux de recouvrement par classe pour l'année courante.",
    family: 'finance',
    permission: 'VIEW_FINANCIAL_REPORTS',
    defaultDays: 365,
    columns: [
      { key: 'groupName', label: 'Classe' },
      { key: 'students', label: 'Élèves' },
      { key: 'due', label: 'Facturé (FCFA)' },
      { key: 'paid', label: 'Encaissé (FCFA)' },
      { key: 'balance', label: 'Reste (FCFA)' },
      { key: 'overdue', label: 'En retard (FCFA)' },
      { key: 'recoveryRate', label: 'Taux (%)' },
    ],
  },
  {
    key: 'parent-activation',
    title: 'Activation des parents',
    description:
      'Tuteurs rattachés, invités et activés par classe — le socle des notifications et du paiement en ligne.',
    family: 'adoption',
    permission: 'VIEW_REPORTS',
    defaultDays: 365,
    columns: [
      { key: 'groupName', label: 'Classe' },
      { key: 'students', label: 'Élèves' },
      { key: 'withoutGuardian', label: 'Sans tuteur' },
      { key: 'guardians', label: 'Tuteurs' },
      { key: 'invited', label: 'Invités' },
      { key: 'activated', label: 'Activés' },
      { key: 'activationRate', label: 'Taux d’activation (%)' },
    ],
  },
  {
    key: 'payment-attempts',
    title: 'Tentatives de paiement en ligne',
    description:
      'Tentatives par provider et statut, montants, délai médian de confirmation, frais.',
    family: 'finance',
    permission: 'VIEW_FINANCIAL_REPORTS',
    defaultDays: 30,
    columns: [
      { key: 'provider', label: 'Provider' },
      { key: 'status', label: 'Statut' },
      { key: 'attempts', label: 'Tentatives' },
      { key: 'amount', label: 'Montant (FCFA)' },
      { key: 'fees', label: 'Frais (FCFA)' },
      { key: 'medianConfirmSeconds', label: 'Délai médian (s)' },
    ],
  },
];

const MAX_ROWS = 5000;
const pct = (num: number, den: number) => (den > 0 ? Math.round((num * 100) / den) : null);

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  catalog(permissions: readonly string[]) {
    return REPORTS.filter((r) => permissions.includes(r.permission));
  }

  definition(key: ReportKey) {
    const d = REPORTS.find((r) => r.key === key);
    if (!d) throw AppError.notFound('Rapport');
    return d;
  }

  async period(
    tx: Db,
    key: ReportKey,
    q: { from?: string; to?: string; groupId?: string },
  ): Promise<Period> {
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
    const today = localDateParts(new Date(), tenant.timezone).date;
    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -this.definition(key).defaultDays);
    if (from > to) throw AppError.validation([{ path: 'from', message: 'Début après la fin' }]);
    return { from, to, groupId: q.groupId };
  }

  async run(
    key: ReportKey,
    q: { from?: string; to?: string; groupId?: string },
  ): Promise<ReportResult> {
    const tx = this.db.current();
    const def = this.definition(key);
    const p = await this.period(tx, key, q);
    const rows = await this.rows(tx, key, p);
    return {
      key,
      title: def.title,
      period: { from: p.from, to: p.to },
      columns: def.columns,
      rows: rows.slice(0, MAX_ROWS),
      total: rows.length,
      truncated: rows.length > MAX_ROWS,
    };
  }

  async csv(key: ReportKey, q: { from?: string; to?: string; groupId?: string }) {
    const r = await this.run(key, q);
    return {
      filename: `${key}_${r.period.from}_${r.period.to}.csv`,
      content: toCsv(r.columns, r.rows),
    };
  }

  /** Exécution hors requête HTTP (rapports planifiés) : dans une transaction tenant fournie. */
  async runIn(tx: Db, key: ReportKey, q: { from?: string; to?: string; groupId?: string }) {
    const def = this.definition(key);
    const p = await this.period(tx, key, q);
    const rows = await this.rows(tx, key, p);
    return { def, period: p, rows, csv: toCsv(def.columns, rows) };
  }

  async rows(tx: Db, key: ReportKey, p: Period): Promise<Row[]> {
    switch (key) {
      case 'attendance-by-group':
        return this.attendanceByGroup(tx, p);
      case 'students-at-risk':
        return this.studentsAtRisk(tx, p);
      case 'missing-sheets':
        return this.missingSheets(tx, p);
      case 'attendance-corrections':
        return this.corrections(tx, p);
      case 'collections-by-channel':
        return this.collectionsByChannel(tx, p);
      case 'recovery-by-group':
        return this.recoveryByGroup(tx, p);
      case 'parent-activation':
        return this.parentActivation(tx, p);
      case 'payment-attempts':
        return this.paymentAttempts(tx, p);
      default:
        throw AppError.notFound('Rapport');
    }
  }

  // ---------------------------------------------------------------- assiduité
  async attendanceByGroup(tx: Db, p: Period): Promise<Row[]> {
    const r = await tx.execute<{
      group_id: string;
      group_name: string;
      level_name: string | null;
      sessions_held: number;
      sheets_missing: number;
      records: number;
      present: number;
      absent: number;
      late: number;
      excused: number;
      unjustified: number;
    }>(sql`
      select g.id as group_id, g.name as group_name, l.name as level_name,
             coalesce(sum(d.sessions_held), 0)::int as sessions_held, coalesce(sum(d.sheets_missing), 0)::int as sheets_missing,
             coalesce(sum(d.records), 0)::int as records, coalesce(sum(d.present), 0)::int as present,
             coalesce(sum(d.absent), 0)::int as absent, coalesce(sum(d.late), 0)::int as late,
             coalesce(sum(d.excused), 0)::int as excused, coalesce(sum(d.unjustified), 0)::int as unjustified
      from groups g
      left join levels l on l.id = g.level_id
      left join report_attendance_daily d on d.group_id = g.id and d.day between ${p.from}::date and ${p.to}::date
      where g.deleted_at is null and g.kind = 'CLASS'
        ${p.groupId ? sql`and g.id = ${p.groupId}::uuid` : sql``}
      group by g.id, g.name, l.name
      order by g.name`);
    return r.rows.map((x) => ({
      groupId: x.group_id,
      groupName: x.group_name,
      levelName: x.level_name,
      sessionsHeld: x.sessions_held,
      sheetsMissing: x.sheets_missing,
      records: x.records,
      present: x.present,
      absent: x.absent,
      late: x.late,
      excused: x.excused,
      unjustified: x.unjustified,
      presenceRate: pct(x.present + x.late, x.records),
    }));
  }

  async studentsAtRisk(tx: Db, p: Period): Promise<Row[]> {
    const r = await tx.execute<{
      student_id: string;
      first_name: string;
      last_name: string;
      matricule: string;
      group_name: string | null;
      sessions: number;
      absent: number;
      unjustified: number;
      late: number;
      open_alert: boolean;
      guardian_phone: string | null;
    }>(sql`
      with cur as (
        select e.student_id, g.name as group_name
        from enrollments e join groups g on g.id = e.group_id
        join academic_years y on y.id = e.academic_year_id and y.is_current
        where e.is_primary and e.left_at is null
      ),
      st as (
        select student_id, sum(sessions)::int as sessions, sum(absent)::int as absent,
               sum(unjustified)::int as unjustified, sum(late)::int as late, sum(present)::int as present
        from attendance_daily_stats where day between ${p.from}::date and ${p.to}::date group by student_id
      )
      select s.id as student_id, s.first_name, s.last_name, s.matricule, cur.group_name,
             coalesce(st.sessions, 0) as sessions, coalesce(st.absent, 0) as absent, coalesce(st.unjustified, 0) as unjustified,
             coalesce(st.late, 0) as late,
             exists (select 1 from attendance_alerts a where a.student_id = s.id and a.resolved_at is null) as open_alert,
             (select gu.phone_e164 from student_guardians sg join guardians gu on gu.id = sg.guardian_id
                where sg.student_id = s.id and sg.unlinked_at is null order by sg.is_primary desc, sg.linked_at limit 1) as guardian_phone
      from students s
      join cur on cur.student_id = s.id
      left join st on st.student_id = s.id
      where s.status = 'ACTIVE'
        ${p.groupId ? sql`and exists (select 1 from enrollments e2 where e2.student_id = s.id and e2.group_id = ${p.groupId}::uuid and e2.left_at is null)` : sql``}
        and (
          exists (select 1 from attendance_alerts a where a.student_id = s.id and a.resolved_at is null)
          or coalesce(st.unjustified, 0) >= 3
          or (coalesce(st.sessions, 0) >= 5 and (coalesce(st.present, 0) + coalesce(st.late, 0)) * 100 < coalesce(st.sessions, 0) * 80)
        )
      order by coalesce(st.unjustified, 0) desc, s.last_name, s.first_name`);
    return r.rows.map((x) => ({
      studentId: x.student_id,
      firstName: x.first_name,
      lastName: x.last_name,
      matricule: x.matricule,
      groupName: x.group_name,
      sessions: x.sessions,
      absent: x.absent,
      unjustified: x.unjustified,
      late: x.late,
      presenceRate: pct(x.sessions - x.absent, x.sessions),
      openAlert: x.open_alert,
      guardianPhone: x.guardian_phone,
    }));
  }

  async missingSheets(tx: Db, p: Period): Promise<Row[]> {
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
    const r = await tx.execute<{
      session_id: string;
      starts_at: string;
      group_name: string;
      subject_name: string;
      teachers: string | null;
      sheet_status: string | null;
    }>(sql`
      select s.id as session_id, s.starts_at, g.name as group_name, sub.name as subject_name,
             (select string_agg(u.display_name, ', ') from course_teachers ct
                join staff_profiles sp on sp.id = ct.staff_profile_id
                join memberships m on m.id = sp.membership_id join users u on u.id = m.user_id
               where ct.course_offering_id = co.id) as teachers,
             sh.status as sheet_status
      from sessions s
      join course_offerings co on co.id = s.course_offering_id
      join groups g on g.id = co.group_id
      join subjects sub on sub.id = co.subject_id
      left join attendance_sheets sh on sh.session_id = s.id
      where s.status <> 'CANCELLED' and s.ends_at < now()
        and (s.starts_at at time zone ${tenant.timezone})::date between ${p.from}::date and ${p.to}::date
        and coalesce(sh.status, '') not in ('SUBMITTED', 'LOCKED')
        ${p.groupId ? sql`and g.id = ${p.groupId}::uuid` : sql``}
      order by s.starts_at desc
      limit ${MAX_ROWS + 1}`);
    return r.rows.map((x) => {
      const d = new Date(x.starts_at);
      return {
        sessionId: x.session_id,
        date: localDateParts(d, tenant.timezone).date,
        startsAt: d.toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: tenant.timezone,
        }),
        groupName: x.group_name,
        subjectName: x.subject_name,
        teachers: x.teachers ?? '—',
        sheetStatus: x.sheet_status === 'DRAFT' ? 'Brouillon non soumis' : 'Aucun appel',
      };
    });
  }

  async corrections(tx: Db, p: Period): Promise<Row[]> {
    const r = await tx.execute<{
      author: string | null;
      corrections: number;
      out_of_window: number;
      to_present: number;
      to_absent: number;
      students: number;
      last_at: string;
    }>(sql`
      select coalesce(u.display_name, 'système') as author,
             count(*)::int as corrections,
             count(*) filter (where rv.out_of_window)::int as out_of_window,
             count(*) filter (where rv.after_status = 'PRESENT')::int as to_present,
             count(*) filter (where rv.after_status = 'ABSENT')::int as to_absent,
             count(distinct r.student_id)::int as students,
             max(rv.created_at) as last_at
      from attendance_record_revisions rv
      join attendance_records r on r.id = rv.record_id
      left join users u on u.id = rv.author_id
      where rv.created_at >= ${p.from}::date and rv.created_at < (${p.to}::date + 1)
        ${p.groupId ? sql`and exists (select 1 from sessions s join course_offerings co on co.id = s.course_offering_id where s.id = r.session_id and co.group_id = ${p.groupId}::uuid)` : sql``}
      group by u.display_name
      order by corrections desc`);
    return r.rows.map((x) => ({
      author: x.author,
      corrections: x.corrections,
      outOfWindow: x.out_of_window,
      toPresent: x.to_present,
      toAbsent: x.to_absent,
      students: x.students,
      lastAt: new Date(x.last_at).toISOString(),
    }));
  }

  // ---------------------------------------------------------------- finance et adoption
  async collectionsByChannel(tx: Db, p: Period): Promise<Row[]> {
    const r = await tx.execute<{
      channel: string;
      payments: number;
      amount: number;
      reversed_count: number;
      reversed_amount: number;
      fees: number;
    }>(sql`
      select channel, sum(payments)::int as payments, sum(amount)::bigint as amount,
             sum(reversed_count)::int as reversed_count, sum(reversed_amount)::bigint as reversed_amount, sum(fees)::bigint as fees
      from report_finance_daily where day between ${p.from}::date and ${p.to}::date
      group by channel order by amount desc`);
    const total = r.rows.reduce((t, x) => t + Number(x.amount), 0);
    return r.rows.map((x) => ({
      channel: CHANNEL_LABELS[x.channel] ?? x.channel,
      channelCode: x.channel,
      kind: ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_MONEY_OFFLINE'].includes(x.channel)
        ? 'Caisse'
        : 'En ligne',
      payments: x.payments,
      amount: Number(x.amount),
      reversedCount: x.reversed_count,
      reversedAmount: Number(x.reversed_amount),
      fees: Number(x.fees),
      share: pct(Number(x.amount), total),
    }));
  }

  async recoveryByGroup(tx: Db, p: Period): Promise<Row[]> {
    const r = await tx.execute<{
      group_id: string;
      group_name: string;
      students: number;
      due: number;
      paid: number;
      overdue: number;
    }>(sql`
      with cur as (
        select e.student_id, g.id as group_id, g.name as group_name
        from enrollments e join groups g on g.id = e.group_id
        join academic_years y on y.id = e.academic_year_id and y.is_current
        where e.is_primary and e.left_at is null
      )
      select cur.group_id, cur.group_name, count(distinct cur.student_id)::int as students,
             coalesce(sum(greatest(0, i.amount_due + i.adjustments_total)), 0)::bigint as due,
             coalesce(sum(i.amount_allocated), 0)::bigint as paid,
             coalesce(sum(case when i.status = 'OVERDUE' then greatest(0, i.amount_due + i.adjustments_total - i.amount_allocated) else 0 end), 0)::bigint as overdue
      from cur
      left join installments i on i.student_id = cur.student_id and i.status <> 'CANCELLED'
      ${p.groupId ? sql`where cur.group_id = ${p.groupId}::uuid` : sql``}
      group by cur.group_id, cur.group_name order by cur.group_name`);
    return r.rows.map((x) => ({
      groupId: x.group_id,
      groupName: x.group_name,
      students: x.students,
      due: Number(x.due),
      paid: Number(x.paid),
      balance: Number(x.due) - Number(x.paid),
      overdue: Number(x.overdue),
      recoveryRate: pct(Number(x.paid), Number(x.due)),
    }));
  }

  async parentActivation(tx: Db, p: Period): Promise<Row[]> {
    const r = await tx.execute<{
      group_id: string;
      group_name: string;
      students: number;
      without_guardian: number;
      guardians: number;
      invited: number;
      activated: number;
    }>(sql`
      with cur as (
        select e.student_id, g.id as group_id, g.name as group_name
        from enrollments e join groups g on g.id = e.group_id
        join academic_years y on y.id = e.academic_year_id and y.is_current
        where e.is_primary and e.left_at is null
      ),
      links as (
        select cur.group_id, sg.guardian_id, gu.invited_at, gu.user_id
        from cur join student_guardians sg on sg.student_id = cur.student_id and sg.unlinked_at is null
        join guardians gu on gu.id = sg.guardian_id and gu.deleted_at is null
      )
      select cur.group_id, cur.group_name, count(distinct cur.student_id)::int as students,
             count(distinct cur.student_id) filter (where not exists (select 1 from student_guardians sg where sg.student_id = cur.student_id and sg.unlinked_at is null))::int as without_guardian,
             (select count(distinct guardian_id)::int from links l where l.group_id = cur.group_id) as guardians,
             (select count(distinct guardian_id)::int from links l where l.group_id = cur.group_id and l.invited_at is not null) as invited,
             (select count(distinct guardian_id)::int from links l where l.group_id = cur.group_id and l.user_id is not null) as activated
      from cur
      ${p.groupId ? sql`where cur.group_id = ${p.groupId}::uuid` : sql``}
      group by cur.group_id, cur.group_name order by cur.group_name`);
    return r.rows.map((x) => ({
      groupId: x.group_id,
      groupName: x.group_name,
      students: x.students,
      withoutGuardian: x.without_guardian,
      guardians: x.guardians,
      invited: x.invited,
      activated: x.activated,
      activationRate: pct(x.activated, x.guardians),
    }));
  }

  async paymentAttempts(tx: Db, p: Period): Promise<Row[]> {
    const r = await tx.execute<{
      provider: string;
      status: string;
      attempts: number;
      amount: number;
      fees: number;
      median_seconds: number | null;
    }>(sql`
      select provider, status, count(*)::int as attempts, sum(amount)::bigint as amount, coalesce(sum(fees), 0)::bigint as fees,
             percentile_cont(0.5) within group (order by extract(epoch from (completed_at - created_at))) filter (where status = 'SUCCEEDED') as median_seconds
      from payment_attempts
      where created_at >= ${p.from}::date and created_at < (${p.to}::date + 1)
      group by provider, status order by provider, status`);
    return r.rows.map((x) => ({
      provider: x.provider,
      status: x.status,
      attempts: x.attempts,
      amount: Number(x.amount),
      fees: Number(x.fees),
      medianConfirmSeconds: x.median_seconds === null ? null : Math.round(Number(x.median_seconds)),
    }));
  }
}

export const CHANNEL_LABELS: Record<string, string> = {
  CASH: 'Espèces',
  BANK_TRANSFER: 'Virement',
  CHEQUE: 'Chèque',
  MOBILE_MONEY_OFFLINE: 'Mobile money (hors ligne)',
  FEDAPAY: 'FedaPay',
  KKIAPAY: 'KKiaPay',
  FAKE: 'Provider de démonstration',
  ONLINE: 'En ligne',
};
