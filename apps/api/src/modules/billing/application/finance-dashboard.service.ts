import { Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../../database/database.service';
import type { Db } from '../../../database/request-context';
import { academicYears, ledgerIntegrityChecks } from '../../../database/schema';
import { GuardianService } from '../../students-guardians';
import { LedgerService } from './ledger.service';
import { UnpaidService } from './unpaid.service';

type Row = Record<string, string | number | null>;
const n = (r: Row | undefined, k: string) => Number(r?.[k] ?? 0);

/** Tableau de bord finance (sans électronique) et vue parent (frais, solde, échéances, reçus). */
@Injectable()
export class FinanceDashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly unpaid: UnpaidService,
    private readonly guardians: GuardianService,
  ) {}

  async finance() {
    const tx = this.db.current();
    const today = await this.ledger.today(tx);
    const year = await tx.query.academicYears.findFirst({
      where: eq(academicYears.isCurrent, true),
    });
    const yearRow = year
      ? (
          await tx.execute<Row>(sql`
            select coalesce(sum(greatest(0, i.amount_due + i.adjustments_total)),0) as invoiced,
                   coalesce(sum(i.amount_allocated),0) as paid,
                   coalesce(sum(case when i.status = 'OVERDUE' then greatest(0, i.amount_due + i.adjustments_total - i.amount_allocated) else 0 end),0) as overdue
            from installments i join student_fees f on f.id = i.student_fee_id where f.academic_year_id = ${year.id}::uuid`)
        ).rows[0]
      : undefined;
    const credits = (
      await tx.execute<Row>(
        sql`select coalesce(sum(remaining),0) as c from student_credits where status = 'OPEN'`,
      )
    ).rows[0];
    const todayRows = await tx.execute<Row>(sql`
      select method, coalesce(sum(amount),0) as amount, count(*)::int as count from payments
      where value_date = ${today}::date and status = 'COMPLETED' group by method order by method`);
    const cashiers = await tx.execute<Row>(sql`
      select p.recorded_by as user_id, u.display_name as name, coalesce(sum(p.amount),0) as amount, count(*)::int as count
      from payments p left join users u on u.id = p.recorded_by
      where p.value_date = ${today}::date and p.status = 'COMPLETED' group by p.recorded_by, u.display_name order by amount desc`);
    const month = (
      await tx.execute<Row>(
        sql`select coalesce(sum(amount),0) as amount, count(*)::int as count from payments where status = 'COMPLETED' and date_trunc('month', value_date) = date_trunc('month', ${today}::date)`,
      )
    ).rows[0];
    const upcoming = (
      await tx.execute<Row>(sql`
      select count(*)::int as n, coalesce(sum(greatest(0, amount_due + adjustments_total - amount_allocated)),0) as amount
      from installments where status in ('PENDING','DUE','PARTIALLY_PAID') and due_date between ${today}::date and (${today}::date + 7)`)
    ).rows[0];
    const integrity = await tx.query.ledgerIntegrityChecks.findFirst({
      orderBy: [desc(ledgerIntegrityChecks.checkedAt)],
    });
    const invoiced = n(yearRow, 'invoiced');
    const paid = n(yearRow, 'paid');
    const todayTotal = todayRows.rows.reduce((s, r) => s + n(r, 'amount'), 0);
    return {
      year: {
        invoiced,
        paid,
        outstanding: invoiced - paid,
        overdue: n(yearRow, 'overdue'),
        credits: n(credits, 'c'),
        recoveryRate: invoiced > 0 ? Math.round((paid / invoiced) * 100) : null,
      },
      today: {
        count: todayRows.rows.reduce((s, r) => s + n(r, 'count'), 0),
        amount: todayTotal,
        byMethod: todayRows.rows.map((r) => ({
          method: String(r['method']) as 'CASH',
          amount: n(r, 'amount'),
          count: n(r, 'count'),
        })),
        byCashier: cashiers.rows.map((r) => ({
          userId: (r['user_id'] as string | null) ?? null,
          name: (r['name'] as string | null) ?? null,
          amount: n(r, 'amount'),
          count: n(r, 'count'),
        })),
      },
      month: { amount: n(month, 'amount'), count: n(month, 'count') },
      upcoming7d: { installments: n(upcoming, 'n'), amount: n(upcoming, 'amount') },
      byGroup: await this.unpaid.byGroup(tx),
      integrity: {
        checkedAt: integrity?.checkedAt.toISOString() ?? null,
        mismatches: integrity?.mismatches ?? 0,
      },
      studentsWithoutFees: await this.unpaid.studentsWithoutFees(tx),
    };
  }

  /** Parent : frais, solde, prochaine échéance, paiements récents, pour chaque enfant avec le droit finance. */
  async childrenFinance() {
    const kids = (await this.guardians.myChildren()).filter((k) => k.rights.finance);
    const out = [];
    for (const k of kids) out.push(await this.childSummary(k.student.id, k.rights.pay));
    return out;
  }

  async childSummary(studentId: string, canPay: boolean) {
    const acc = await this.ledger.account(studentId);
    const open = acc.fees
      .flatMap((f) =>
        (f.installments ?? [])
          .filter((i) => i.status !== 'PAID' && i.status !== 'CANCELLED')
          .map((i) => ({ ...i, feeName: f.feeName })),
      )
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.seq - b.seq));
    return {
      student: acc.student,
      canPay,
      totals: acc.totals,
      nextInstallment: open[0] ?? null,
      openInstallments: open,
      recentPayments: acc.payments.slice(0, 10),
    };
  }

  /** Compte complet d'un enfant pour son tuteur (droit finance vérifié, 404 sinon). */
  async childAccount(studentId: string, tx: Db = this.db.current()) {
    await this.guardians.assertGuardianAccess(studentId, 'finance', tx);
    return this.ledger.account(studentId);
  }
}
