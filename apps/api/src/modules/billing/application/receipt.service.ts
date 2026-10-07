import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../../../config/env';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore, type Db } from '../../../database/request-context';
import {
  feeStructures,
  installments,
  paymentAllocations,
  payments,
  receipts,
  studentFees,
  students,
  tenants,
  users,
} from '../../../database/schema';
import { formatXof, receiptHash, receiptNumber } from '../domain/ledger';
import { buildPdf, type PdfLine } from '../infrastructure/pdf';

export interface ReceiptSnapshot {
  tenant: { name: string; code: string };
  student: { firstName: string; lastName: string; matricule: string };
  payment: {
    id: string;
    amount: number;
    currency: string;
    method: string;
    valueDate: string;
    reference: string | null;
    payerName: string | null;
    recordedBy: string | null;
  };
  lines: { feeName: string; label: string; amount: number }[];
  credit: number;
  cancels?: string;
  reason?: string;
}

/**
 * Reçus (ADR-0005) : un par paiement (et un reçu d'annulation lié), numéro séquentiel par tenant et année sous
 * verrou consultatif, instantané figé, empreinte de vérification publique. PDF généré à la demande (texte).
 */
@Injectable()
export class ReceiptService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get tenantId() {
    return RequestContextStore.require().tenantId!;
  }

  /** Émet le reçu d'un paiement dans la transaction courante. Idempotent par (paiement, type). */
  async issue(tx: Db, paymentId: string, kind: 'PAYMENT' | 'CANCELLATION') {
    const existing = await tx.query.receipts.findFirst({
      where: and(eq(receipts.paymentId, paymentId), eq(receipts.kind, kind)),
    });
    if (existing) return existing;
    const tenant = (await tx.query.tenants.findFirst({ where: eq(tenants.id, this.tenantId) }))!;
    const p = (await tx.query.payments.findFirst({ where: eq(payments.id, paymentId) }))!;
    const s = (await tx.query.students.findFirst({ where: eq(students.id, p.studentId) }))!;
    const by = p.recordedBy
      ? await tx.query.users.findFirst({ where: eq(users.id, p.recordedBy) })
      : null;
    const allocs = await tx
      .select({
        amount: paymentAllocations.amount,
        label: installments.label,
        feeName: feeStructures.name,
        credit: paymentAllocations.creditId,
      })
      .from(paymentAllocations)
      .innerJoin(installments, eq(installments.id, paymentAllocations.installmentId))
      .innerJoin(studentFees, eq(studentFees.id, installments.studentFeeId))
      .innerJoin(feeStructures, eq(feeStructures.id, studentFees.feeStructureId))
      .where(eq(paymentAllocations.paymentId, paymentId))
      .orderBy(asc(paymentAllocations.createdAt));
    const lines = allocs
      .filter((a) => a.amount > 0 && !a.credit)
      .map((a) => ({ feeName: a.feeName, label: a.label, amount: a.amount }));
    const allocated = lines.reduce((t, l) => t + l.amount, 0);
    const year = Number(p.valueDate.slice(0, 4));
    // Numérotation sans trou : verrou consultatif (tenant, année) puis incrément atomique.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`receipts:${this.tenantId}:${year}`}))`,
    );
    const seqRow = await tx.execute<{ last_seq: number }>(sql`
      insert into receipt_sequences (tenant_id, year, last_seq) values (${this.tenantId}::uuid, ${year}, 1)
      on conflict (tenant_id, year) do update set last_seq = receipt_sequences.last_seq + 1 returning last_seq`);
    const seq = Number(seqRow.rows[0]?.last_seq ?? 1);
    const number = receiptNumber(tenant.code, year, seq);
    const snapshot: ReceiptSnapshot = {
      tenant: { name: tenant.name, code: tenant.code },
      student: { firstName: s.firstName, lastName: s.lastName, matricule: s.matricule },
      payment: {
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        method: p.method,
        valueDate: p.valueDate,
        reference: p.reference,
        payerName: p.payerName,
        recordedBy: by?.displayName ?? null,
      },
      lines,
      credit: Math.max(0, p.amount - allocated),
    };
    if (kind === 'CANCELLATION') {
      const original = await tx.query.receipts.findFirst({
        where: and(eq(receipts.paymentId, paymentId), eq(receipts.kind, 'PAYMENT')),
      });
      snapshot.cancels = original?.number;
      snapshot.reason = p.reversalReason ?? undefined;
    }
    const id = randomUUID();
    const row = {
      id,
      tenantId: this.tenantId,
      paymentId,
      kind,
      number,
      amount: p.amount,
      currency: p.currency,
      snapshot: snapshot as unknown as Record<string, unknown>,
      verifyHash: receiptHash(this.env.RECEIPT_SECRET, this.tenantId, number, p.amount),
      pdfKey: null,
      createdAt: new Date(),
    };
    await tx.insert(receipts).values(row);
    return row;
  }

  async byPayment(paymentId: string, kind: 'PAYMENT' | 'CANCELLATION' = 'PAYMENT') {
    const r = await this.db.current().query.receipts.findFirst({
      where: and(eq(receipts.paymentId, paymentId), eq(receipts.kind, kind)),
    });
    if (!r) throw AppError.notFound('Reçu');
    return this.dto(r);
  }

  async byNumber(number: string) {
    const r = await this.db
      .current()
      .query.receipts.findFirst({ where: eq(receipts.number, number) });
    if (!r) throw AppError.notFound('Reçu');
    return r;
  }

  /** Vérification publique : numéro, date, montant, établissement, état — rien d'autre (page du QR). */
  async verify(tenantCode: string, number: string, hash: string) {
    return this.db.withPlatformTx('receipt verification', async (tx) => {
      const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.code, tenantCode) });
      const r = tenant
        ? await tx.query.receipts.findFirst({
            where: and(eq(receipts.tenantId, tenant.id), eq(receipts.number, number)),
          })
        : null;
      if (!tenant || !r || r.verifyHash !== hash)
        return {
          number,
          valid: false,
          status: 'UNKNOWN' as const,
          amount: null,
          currency: null,
          issuedAt: null,
          tenantName: null,
        };
      const cancelled = await tx.query.receipts.findFirst({
        where: and(eq(receipts.paymentId, r.paymentId), eq(receipts.kind, 'CANCELLATION')),
      });
      const isCancelled = r.kind === 'CANCELLATION' || Boolean(cancelled);
      return {
        number,
        valid: !isCancelled,
        status: isCancelled ? ('CANCELLED' as const) : ('VALID' as const),
        amount: r.amount,
        currency: r.currency,
        issuedAt: r.createdAt.toISOString(),
        tenantName: tenant.name,
      };
    });
  }

  verifyUrl(r: { tenantId?: string; number: string; verifyHash: string }, tenantCode: string) {
    return `${this.env.WEB_ORIGIN}/r/${encodeURIComponent(tenantCode)}/${encodeURIComponent(r.number)}/${r.verifyHash}`;
  }

  dto(r: typeof receipts.$inferSelect) {
    const snap = r.snapshot as unknown as ReceiptSnapshot;
    return {
      id: r.id,
      number: r.number,
      kind: r.kind,
      paymentId: r.paymentId,
      amount: r.amount,
      issuedAt: r.createdAt.toISOString(),
      verifyUrl: this.verifyUrl(r, snap.tenant.code),
      snapshot: r.snapshot,
    };
  }

  /** PDF texte A5 : en-tête établissement, numéro, payeur, lignes d'allocation, mention d'encaissement, URL de vérification. */
  pdf(r: typeof receipts.$inferSelect): Buffer {
    const s = r.snapshot as unknown as ReceiptSnapshot;
    const date = new Date(r.createdAt).toLocaleString('fr-FR', { timeZone: 'Africa/Porto-Novo' });
    const lines: PdfLine[] = [
      { text: s.tenant.name, size: 14, bold: true },
      {
        text: r.kind === 'CANCELLATION' ? "REÇU D'ANNULATION" : 'REÇU DE PAIEMENT',
        size: 12,
        bold: true,
        gap: 10,
      },
      { text: `N° ${r.number}`, size: 11, bold: true },
      { text: `Émis le ${date}`, size: 9 },
      ...(s.cancels
        ? [
            {
              text: `Annule le reçu ${s.cancels}${s.reason ? ` — motif : ${s.reason}` : ''}`,
              size: 9,
            },
          ]
        : []),
      { text: ' ', gap: 6 },
      {
        text: `Élève : ${s.student.lastName} ${s.student.firstName} (${s.student.matricule})`,
        size: 10,
      },
      { text: `Payeur : ${s.payment.payerName ?? '—'}`, size: 10 },
      {
        text: `Moyen : ${s.payment.method}${s.payment.reference ? ` — réf. ${s.payment.reference}` : ''} — date de valeur ${s.payment.valueDate}`,
        size: 10,
      },
      { text: ' ', gap: 6 },
      { text: 'Imputation', size: 10, bold: true },
      ...s.lines.map((l) => ({
        text: `${l.feeName} — ${l.label} : ${formatXof(l.amount)}`,
        size: 10,
        x: 48,
      })),
      ...(s.credit > 0
        ? [
            {
              text: `Trop-perçu porté au crédit de l'élève : ${formatXof(s.credit)}`,
              size: 10,
              x: 48,
            },
          ]
        : []),
      { text: ' ', gap: 6 },
      { text: `MONTANT : ${formatXof(r.amount)}`, size: 13, bold: true },
      { text: ' ', gap: 10 },
      {
        text: `Encaissé par ${s.tenant.name}${s.payment.recordedBy ? ` — caisse : ${s.payment.recordedBy}` : ''}`,
        size: 9,
      },
      { text: 'Vérification :', size: 8, gap: 8 },
      { text: this.verifyUrl(r, s.tenant.code), size: 7 },
    ];
    return buildPdf(lines);
  }
}
