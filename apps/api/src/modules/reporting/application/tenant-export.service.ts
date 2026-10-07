import { Injectable, Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { TenantExport } from '@polaris/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { tenantExports, tenants, users } from '../../../database/schema';
import { AuditService } from '../../audit';
import { toCsv, type Cell } from '../infrastructure/csv';
import { buildZip, type ZipEntry } from '../infrastructure/zip';
import { ReportsQueue } from './reports.queue';

/** Tables exportées : requête lecture seule sous RLS → un CSV par table (noms de colonnes SQL). */
const EXPORT_QUERIES: { name: string; query: string }[] = [
  {
    name: 'eleves',
    query: `select id, matricule, first_name, last_name, birth_date, gender, status, left_at, created_at from students order by last_name, first_name`,
  },
  {
    name: 'tuteurs',
    query: `select id, first_name, last_name, phone_e164, email, preferred_channel, invited_at, (user_id is not null) as activated, created_at from guardians where deleted_at is null order by last_name`,
  },
  {
    name: 'liens_eleve_tuteur',
    query: `select id, student_id, guardian_id, relationship, is_primary, can_view_attendance, can_view_finance, can_pay, can_justify, linked_at, unlinked_at from student_guardians order by linked_at`,
  },
  {
    name: 'annees',
    query: `select id, label, start_date, end_date, is_current from academic_years order by start_date`,
  },
  {
    name: 'groupes',
    query: `select g.id, g.name, g.kind, l.name as level, g.academic_year_id, g.capacity from groups g left join levels l on l.id = g.level_id where g.deleted_at is null order by g.name`,
  },
  {
    name: 'inscriptions',
    query: `select id, student_id, group_id, academic_year_id, is_primary, enrolled_at, left_at, left_reason from enrollments order by enrolled_at`,
  },
  {
    name: 'seances',
    query: `select s.id, s.starts_at, s.ends_at, s.status, s.room, co.group_id, co.subject_id from sessions s join course_offerings co on co.id = s.course_offering_id order by s.starts_at`,
  },
  {
    name: 'appels',
    query: `select id, session_id, status, version, retroactive, submitted_at, locked_at from attendance_sheets order by created_at`,
  },
  {
    name: 'presences',
    query: `select r.id, r.session_id, r.student_id, r.status, r.excuse_status, r.late_minutes, r.left_early_at, r.note, r.updated_at from attendance_records r order by r.created_at`,
  },
  {
    name: 'justificatifs',
    query: `select id, student_id, from_date, to_date, reason, status, submitted_by_kind, reviewed_at, review_comment, created_at from absence_justifications order by created_at`,
  },
  {
    name: 'grilles_de_frais',
    query: `select id, code, name, academic_year_id, total_amount, currency, status from fee_structures where deleted_at is null order by name`,
  },
  {
    name: 'creances',
    query: `select id, student_id, fee_structure_id, academic_year_id, total_amount, adjustments_total, amount_allocated, status, created_at from student_fees order by created_at`,
  },
  {
    name: 'echeances',
    query: `select id, student_fee_id, student_id, seq, label, amount_due, adjustments_total, amount_allocated, due_date, status from installments order by due_date, seq`,
  },
  {
    name: 'ajustements',
    query: `select id, student_fee_id, installment_id, amount, kind, reason, created_at from fee_adjustments order by created_at`,
  },
  {
    name: 'paiements',
    query: `select id, student_id, amount, currency, source, method, status, payer_name, value_date, reference, attempt_id, reversed_at, reversal_reason, created_at from payments order by created_at`,
  },
  {
    name: 'allocations',
    query: `select id, payment_id, installment_id, amount, refund_id, credit_id, created_at from payment_allocations order by created_at`,
  },
  {
    name: 'recus',
    query: `select id, payment_id, kind, number, amount, currency, created_at from receipts order by created_at`,
  },
  {
    name: 'tentatives_paiement',
    query: `select id, student_id, amount, provider, status, external_id, verified_amount, fees, payment_id, failure_code, created_at, completed_at from payment_attempts order by created_at`,
  },
  {
    name: 'notifications',
    query: `select id, kind, channel, status, recipient_user_id, student_id, title, created_at, sent_at, read_at, error from notifications order by created_at`,
  },
  {
    name: 'journal_audit',
    query: `select id, actor_user_id, action, entity_type, entity_id, occurred_at from audit_logs order by occurred_at`,
  },
];

/**
 * Export complet d'un établissement (sauvegarde, résiliation, RGPD) : une archive ZIP de CSV construite par le
 * worker sous RLS, stockée en base (taille des pilotes), téléchargeable par l'administrateur.
 */
@Injectable()
export class TenantExportService {
  private readonly logger = new Logger(TenantExportService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly queue: ReportsQueue,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  async request(): Promise<TenantExport> {
    const tx = this.db.current();
    const running = await tx
      .select({ id: tenantExports.id })
      .from(tenantExports)
      .where(sql`${tenantExports.status} in ('QUEUED','RUNNING')`);
    if (running.length) throw AppError.conflict('Un export est déjà en cours');
    const id = randomUUID();
    await tx.insert(tenantExports).values({
      id,
      tenantId: this.tenantId,
      status: 'QUEUED',
      requestedBy: RequestContextStore.require().actor?.userId ?? null,
      startedAt: null,
      finishedAt: null,
      sizeBytes: null,
      entries: [],
      file: null,
      error: null,
      createdAt: new Date(),
    });
    await this.audit.record({
      action: 'tenant_export.requested',
      entityType: 'TenantExport',
      entityId: id,
    });
    await this.queue.enqueue({ kind: 'tenant-export', tenantId: this.tenantId, exportId: id });
    return this.get(id);
  }

  async list(): Promise<TenantExport[]> {
    const rows = await this.db
      .current()
      .select({ e: tenantExports, by: users.displayName })
      .from(tenantExports)
      .leftJoin(users, eq(users.id, tenantExports.requestedBy))
      .orderBy(desc(tenantExports.createdAt))
      .limit(20);
    return rows.map((r) => this.dto(r.e, r.by));
  }

  async get(id: string): Promise<TenantExport> {
    const r = (
      await this.db
        .current()
        .select({ e: tenantExports, by: users.displayName })
        .from(tenantExports)
        .leftJoin(users, eq(users.id, tenantExports.requestedBy))
        .where(eq(tenantExports.id, id))
    )[0];
    if (!r) throw AppError.notFound('Export');
    return this.dto(r.e, r.by);
  }

  async file(id: string) {
    const tx = this.db.current();
    const r = await tx.query.tenantExports.findFirst({ where: eq(tenantExports.id, id) });
    if (!r) throw AppError.notFound('Export');
    if (r.status !== 'DONE' || !r.file) throw AppError.conflict("L'export n'est pas encore prêt");
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
    await this.audit.record({
      action: 'tenant_export.downloaded',
      entityType: 'TenantExport',
      entityId: id,
    });
    return {
      filename: `polaris-${tenant.code}-${r.createdAt.toISOString().slice(0, 10)}.zip`,
      file: r.file,
    };
  }

  /** Construction (worker) : chaque table en CSV sous RLS du tenant, archive ZIP stockée sur la ligne d'export. */
  async build(tenantId: string, exportId: string) {
    return this.db.withTenantTx(tenantId, async (tx) => {
      const row = await tx.query.tenantExports.findFirst({ where: eq(tenantExports.id, exportId) });
      if (!row || row.status === 'DONE') return row;
      await tx
        .update(tenantExports)
        .set({ status: 'RUNNING', startedAt: new Date() })
        .where(eq(tenantExports.id, exportId));
      try {
        const entries: ZipEntry[] = [];
        const manifest: { name: string; rows: number }[] = [];
        for (const q of EXPORT_QUERIES) {
          const res = await tx.execute<Record<string, Cell>>(sql.raw(q.query));
          const columns = res.fields.map((f) => ({ key: f.name, label: f.name }));
          const rows = res.rows.map((r) =>
            Object.fromEntries(
              Object.entries(r).map(([k, v]) => [
                k,
                v instanceof Date ? v.toISOString() : (v as Cell),
              ]),
            ),
          );
          entries.push({ name: `${q.name}.csv`, data: toCsv(columns, rows) });
          manifest.push({ name: q.name, rows: rows.length });
        }
        entries.push({
          name: 'README.txt',
          data: `Export Polaris — établissement ${tenantId}\nGénéré le ${new Date().toISOString()}\n\n${manifest.map((m) => `${m.name}.csv : ${m.rows} ligne(s)`).join('\n')}\n\nCSV ; séparateur point-virgule, UTF-8 avec BOM. Montants en FCFA entiers. Dates ISO 8601 (UTC).\n`,
        });
        const zip = buildZip(entries);
        await tx
          .update(tenantExports)
          .set({
            status: 'DONE',
            finishedAt: new Date(),
            sizeBytes: zip.length,
            entries: manifest,
            file: zip,
          })
          .where(eq(tenantExports.id, exportId));
        this.logger.log({ msg: 'tenant export built', tenantId, exportId, bytes: zip.length });
      } catch (e) {
        await tx
          .update(tenantExports)
          .set({ status: 'FAILED', finishedAt: new Date(), error: (e as Error).message })
          .where(eq(tenantExports.id, exportId));
        this.logger.error({
          msg: 'tenant export failed',
          tenantId,
          exportId,
          err: (e as Error).message,
        });
      }
      return tx.query.tenantExports.findFirst({ where: eq(tenantExports.id, exportId) });
    });
  }

  private dto(e: typeof tenantExports.$inferSelect, by: string | null): TenantExport {
    return {
      id: e.id,
      status: e.status,
      requestedByName: by,
      startedAt: e.startedAt?.toISOString() ?? null,
      finishedAt: e.finishedAt?.toISOString() ?? null,
      sizeBytes: e.sizeBytes,
      entries: e.entries,
      error: e.error,
      createdAt: e.createdAt.toISOString(),
    };
  }
}
