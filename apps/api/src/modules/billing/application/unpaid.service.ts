import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { ExportQuerySchema, SendRemindersSchema, UnpaidQuerySchema } from '@polaris/contracts';
import { decodeCursor, page } from '../../../common/http/cursor';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  academicYears,
  enrollments,
  feeStructures,
  installments,
  paymentReminders,
  payments,
  studentFees,
  students,
  users,
} from '../../../database/schema';
import { AuditService } from '../../audit';
import { OutboxService } from '../../shared';
import { installmentsReminder, type ReminderItem } from '../domain/events';
import { reminderKindFor } from '../domain/ledger';
import { LedgerService } from './ledger.service';

type Row = Record<string, string | number | null>;

/** Impayés (listes et exports), rappels automatiques et manuels, exports comptables CSV. */
@Injectable()
export class UnpaidService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  private currentGroupSql() {
    return sql<
      string | null
    >`(select g.name from enrollments e join groups g on g.id = e.group_id join academic_years y on y.id = e.academic_year_id
      where e.student_id = ${students.id} and e.is_primary and e.left_at is null and y.is_current limit 1)`;
  }

  /** Échéances ouvertes (par élève, classe, grille), les plus anciennes d'abord. */
  async list(query: z.infer<typeof UnpaidQuerySchema>) {
    const tx = this.db.current();
    const cur = decodeCursor<{ d: string; id: string }>(query.cursor);
    const statuses =
      query.status === 'DUE'
        ? ['DUE', 'PARTIALLY_PAID']
        : query.status === 'OVERDUE'
          ? ['OVERDUE']
          : ['DUE', 'OVERDUE', 'PARTIALLY_PAID', 'PENDING'];
    const rows = await tx
      .select({
        i: installments,
        s: students,
        feeName: feeStructures.name,
        groupName: this.currentGroupSql(),
        reminders: sql<number>`(select count(*)::int from payment_reminders r where r.installment_id = ${installments.id})`,
      })
      .from(installments)
      .innerJoin(students, eq(students.id, installments.studentId))
      .innerJoin(studentFees, eq(studentFees.id, installments.studentFeeId))
      .innerJoin(feeStructures, eq(feeStructures.id, studentFees.feeStructureId))
      .where(
        and(
          inArray(
            installments.status,
            statuses as ('DUE' | 'OVERDUE' | 'PARTIALLY_PAID' | 'PENDING')[],
          ),
          query.feeStructureId ? eq(studentFees.feeStructureId, query.feeStructureId) : undefined,
          query.groupId
            ? sql`exists (select 1 from enrollments e where e.student_id = ${students.id} and e.group_id = ${query.groupId}::uuid and e.left_at is null)`
            : undefined,
          query.q
            ? or(
                sql`${students.lastName} || ' ' || ${students.firstName} ilike ${'%' + query.q + '%'}`,
                sql`${students.matricule} ilike ${'%' + query.q + '%'}`,
              )
            : undefined,
          cur
            ? sql`(${installments.dueDate}, ${installments.id}) > (${cur.d}::date, ${cur.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(installments.dueDate), asc(installments.id))
      .limit(query.limit + 1);
    return page(
      rows.map((r) => ({
        ...this.ledger.installmentDto(r.i, r.feeName),
        student: {
          id: r.s.id,
          firstName: r.s.firstName,
          lastName: r.s.lastName,
          matricule: r.s.matricule,
          groupName: r.groupName,
        },
        remindersCount: r.reminders,
      })),
      query.limit,
      (last) => ({ d: last.dueDate, id: last.id }),
    );
  }

  /** Synthèse par classe : dû, payé, solde, en retard, taux de recouvrement (année courante). */
  async byGroup(tx: Db = this.db.current()) {
    const year = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    if (!year) return [];
    const rows = await tx.execute<Row>(sql`
      select g.id as group_id, g.name as group_name,
             count(distinct e.student_id)::int as students,
             coalesce(sum(greatest(0, i.amount_due + i.adjustments_total)), 0) as due,
             coalesce(sum(i.amount_allocated), 0) as paid,
             coalesce(sum(case when i.status = 'OVERDUE' then greatest(0, i.amount_due + i.adjustments_total - i.amount_allocated) else 0 end), 0) as overdue
      from groups g
      join enrollments e on e.group_id = g.id and e.is_primary and e.left_at is null
      left join installments i on i.student_id = e.student_id
      left join student_fees f on f.id = i.student_fee_id and f.academic_year_id = ${year.id}::uuid
      where g.academic_year_id = ${year.id}::uuid and g.kind = 'CLASS' and g.deleted_at is null
      group by g.id, g.name order by g.name`);
    return rows.rows.map((r) => {
      const due = Number(r['due'] ?? 0);
      const paid = Number(r['paid'] ?? 0);
      return {
        groupId: String(r['group_id']),
        groupName: String(r['group_name']),
        students: Number(r['students'] ?? 0),
        due,
        paid,
        balance: due - paid,
        overdue: Number(r['overdue'] ?? 0),
        recoveryRate: due > 0 ? Math.round((paid / due) * 100) : null,
      };
    });
  }

  // ---------------------------------------------------------------- rappels
  /** Cron quotidien : échéances ouvertes à J−n / J+1 / toutes les n semaines → un événement agrégé par type et par jour. */
  async scheduleReminders(tx: Db) {
    const today = await this.ledger.today(tx);
    const rules = await this.ledger.rules(tx);
    const open = await tx
      .select({ i: installments, feeName: feeStructures.name })
      .from(installments)
      .innerJoin(studentFees, eq(studentFees.id, installments.studentFeeId))
      .innerJoin(feeStructures, eq(feeStructures.id, studentFees.feeStructureId))
      .where(inArray(installments.status, ['PENDING', 'DUE', 'OVERDUE', 'PARTIALLY_PAID']));
    const buckets: Record<'DUE_SOON' | 'OVERDUE', ReminderItem[]> = { DUE_SOON: [], OVERDUE: [] };
    for (const { i, feeName } of open) {
      const kind = reminderKindFor(i.dueDate, today, rules);
      if (!kind) continue;
      const inserted = await tx
        .insert(paymentReminders)
        .values({
          id: randomUUID(),
          tenantId: this.tenantId,
          installmentId: i.id,
          kind,
          scheduledFor: today,
          sentBy: null,
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: paymentReminders.id });
      if (inserted.length === 0) continue; // déjà rappelé aujourd'hui
      buckets[kind].push({
        studentId: i.studentId,
        installmentId: i.id,
        feeName,
        label: i.label,
        amount: Math.max(0, i.amountDue + i.adjustmentsTotal - i.amountAllocated),
        dueDate: i.dueDate,
      });
    }
    for (const kind of ['DUE_SOON', 'OVERDUE'] as const) {
      if (buckets[kind].length)
        await this.outbox.publish(
          installmentsReminder(kind, {
            tenantId: this.tenantId,
            date: today,
            items: buckets[kind],
          }),
        );
    }
    return { dueSoon: buckets.DUE_SOON.length, overdue: buckets.OVERDUE.length };
  }

  /** Rappel manuel par la finance sur une sélection d'échéances ouvertes. */
  async sendManual(input: z.infer<typeof SendRemindersSchema>) {
    const tx = this.db.current();
    const today = await this.ledger.today(tx);
    const rows = await tx
      .select({ i: installments, feeName: feeStructures.name })
      .from(installments)
      .innerJoin(studentFees, eq(studentFees.id, installments.studentFeeId))
      .innerJoin(feeStructures, eq(feeStructures.id, studentFees.feeStructureId))
      .where(
        and(
          inArray(installments.id, input.installmentIds),
          inArray(installments.status, ['PENDING', 'DUE', 'OVERDUE', 'PARTIALLY_PAID']),
        ),
      );
    const items: ReminderItem[] = [];
    let skipped = input.installmentIds.length - rows.length;
    for (const { i, feeName } of rows) {
      const inserted = await tx
        .insert(paymentReminders)
        .values({
          id: randomUUID(),
          tenantId: this.tenantId,
          installmentId: i.id,
          kind: 'MANUAL',
          scheduledFor: today,
          sentBy: RequestContextStore.require().actor?.userId ?? null,
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: paymentReminders.id });
      if (inserted.length === 0) {
        skipped++;
        continue;
      }
      items.push({
        studentId: i.studentId,
        installmentId: i.id,
        feeName,
        label: i.label,
        amount: Math.max(0, i.amountDue + i.adjustmentsTotal - i.amountAllocated),
        dueDate: i.dueDate,
      });
    }
    if (items.length)
      await this.outbox.publish(
        installmentsReminder('OVERDUE', {
          tenantId: this.tenantId,
          date: today,
          items,
          manual: true,
          message: input.message,
        }),
      );
    await this.audit.record({
      action: 'payment_reminders.sent',
      entityType: 'PaymentReminder',
      after: { installments: items.length, skipped, message: input.message ?? null },
    });
    return {
      installments: items.length,
      guardians: new Set(items.map((i) => i.studentId)).size,
      skipped,
    };
  }

  // ---------------------------------------------------------------- exports CSV
  async exportPaymentsCsv(query: z.infer<typeof ExportQuerySchema>) {
    const tx = this.db.current();
    const rows = await tx
      .select({
        p: payments,
        s: students,
        by: users.displayName,
        receipt: sql<
          string | null
        >`(select r.number from receipts r where r.payment_id = ${payments.id} and r.kind = 'PAYMENT')`,
        groupName: this.currentGroupSql(),
      })
      .from(payments)
      .innerJoin(students, eq(students.id, payments.studentId))
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(
        and(
          query.from ? gte(payments.valueDate, query.from) : undefined,
          query.to ? lte(payments.valueDate, query.to) : undefined,
          query.groupId
            ? sql`exists (select 1 from enrollments e where e.student_id = ${students.id} and e.group_id = ${query.groupId}::uuid and e.left_at is null)`
            : undefined,
        ),
      )
      .orderBy(asc(payments.valueDate), asc(payments.createdAt));
    const head = [
      'date_valeur',
      'recu',
      'matricule',
      'nom',
      'prenom',
      'classe',
      'montant',
      'devise',
      'moyen',
      'source',
      'statut',
      'reference',
      'payeur',
      'caissier',
      'enregistre_le',
    ];
    const lines = rows.map((r) => [
      r.p.valueDate,
      r.receipt ?? '',
      r.s.matricule,
      r.s.lastName,
      r.s.firstName,
      r.groupName ?? '',
      r.p.amount,
      r.p.currency,
      r.p.method,
      r.p.source,
      r.p.status,
      r.p.reference ?? '',
      r.p.payerName ?? '',
      r.by ?? '',
      r.p.createdAt.toISOString(),
    ]);
    return csv(head, lines);
  }

  /** Balance âgée : par élève, dû / payé / solde et retard par tranche (0–30, 31–60, 61–90, > 90 jours). */
  async exportAgedBalanceCsv(query: z.infer<typeof ExportQuerySchema>) {
    const tx = this.db.current();
    const today = await this.ledger.today(tx);
    const rows = await tx.execute<Row>(sql`
      select s.matricule, s.last_name, s.first_name,
             (select g.name from enrollments e join groups g on g.id = e.group_id where e.student_id = s.id and e.is_primary and e.left_at is null limit 1) as classe,
             coalesce(sum(greatest(0, i.amount_due + i.adjustments_total)),0) as due,
             coalesce(sum(i.amount_allocated),0) as paid,
             coalesce(sum(case when i.due_date < ${today}::date and (${today}::date - i.due_date) <= 30 then greatest(0, i.amount_due + i.adjustments_total - i.amount_allocated) else 0 end),0) as d30,
             coalesce(sum(case when (${today}::date - i.due_date) between 31 and 60 then greatest(0, i.amount_due + i.adjustments_total - i.amount_allocated) else 0 end),0) as d60,
             coalesce(sum(case when (${today}::date - i.due_date) between 61 and 90 then greatest(0, i.amount_due + i.adjustments_total - i.amount_allocated) else 0 end),0) as d90,
             coalesce(sum(case when (${today}::date - i.due_date) > 90 then greatest(0, i.amount_due + i.adjustments_total - i.amount_allocated) else 0 end),0) as d90p
      from students s
      join installments i on i.student_id = s.id
      where s.deleted_at is null
        ${query.groupId ? sql`and exists (select 1 from enrollments e where e.student_id = s.id and e.group_id = ${query.groupId}::uuid and e.left_at is null)` : sql``}
      group by s.id, s.matricule, s.last_name, s.first_name
      having coalesce(sum(greatest(0, i.amount_due + i.adjustments_total)),0) - coalesce(sum(i.amount_allocated),0) <> 0
      order by s.last_name, s.first_name`);
    const head = [
      'matricule',
      'nom',
      'prenom',
      'classe',
      'du',
      'paye',
      'solde',
      'retard_0_30',
      'retard_31_60',
      'retard_61_90',
      'retard_90_plus',
    ];
    const lines = rows.rows.map((r) => [
      r['matricule'],
      r['last_name'],
      r['first_name'],
      r['classe'] ?? '',
      Number(r['due']),
      Number(r['paid']),
      Number(r['due']) - Number(r['paid']),
      Number(r['d30']),
      Number(r['d60']),
      Number(r['d90']),
      Number(r['d90p']),
    ]);
    return csv(head, lines);
  }

  async exportUnpaidCsv(query: z.infer<typeof ExportQuerySchema>) {
    const tx = this.db.current();
    const rows = await tx
      .select({
        i: installments,
        s: students,
        feeName: feeStructures.name,
        groupName: this.currentGroupSql(),
      })
      .from(installments)
      .innerJoin(students, eq(students.id, installments.studentId))
      .innerJoin(studentFees, eq(studentFees.id, installments.studentFeeId))
      .innerJoin(feeStructures, eq(feeStructures.id, studentFees.feeStructureId))
      .where(
        and(
          inArray(installments.status, ['DUE', 'OVERDUE', 'PARTIALLY_PAID']),
          query.groupId
            ? sql`exists (select 1 from enrollments e where e.student_id = ${students.id} and e.group_id = ${query.groupId}::uuid and e.left_at is null)`
            : undefined,
          query.to ? lte(installments.dueDate, query.to) : undefined,
        ),
      )
      .orderBy(asc(installments.dueDate));
    const head = [
      'echeance',
      'statut',
      'frais',
      'libelle',
      'matricule',
      'nom',
      'prenom',
      'classe',
      'du',
      'paye',
      'reste',
    ];
    const lines = rows.map((r) => [
      r.i.dueDate,
      r.i.status,
      r.feeName,
      r.i.label,
      r.s.matricule,
      r.s.lastName,
      r.s.firstName,
      r.groupName ?? '',
      r.i.amountDue + r.i.adjustmentsTotal,
      r.i.amountAllocated,
      Math.max(0, r.i.amountDue + r.i.adjustmentsTotal - r.i.amountAllocated),
    ]);
    return csv(head, lines);
  }

  /** Exposé pour les tableaux de bord : nombre d'élèves sans aucune créance cette année (configuration incomplète). */
  async studentsWithoutFees(tx: Db) {
    const year = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    if (!year) return 0;
    const r = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.academicYearId, year.id),
          eq(enrollments.isPrimary, true),
          isNull(enrollments.leftAt),
          sql`not exists (select 1 from student_fees f where f.student_id = ${enrollments.studentId} and f.academic_year_id = ${year.id}::uuid)`,
        ),
      );
    return r[0]?.n ?? 0;
  }
}

export function csv(head: string[], lines: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[head, ...lines].map((l) => l.map(cell).join(';')).join('\n')}\n`;
}
