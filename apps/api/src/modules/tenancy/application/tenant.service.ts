import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../database/database.service';
import { RequestContextStore } from '../../../database/request-context';
import { tenants } from '../../../database/schema';
import { AuditService } from '../../audit';

/** Paramètres modifiables par l'administrateur de l'établissement (étendus module par module). */
export const TenantSettingsSchema = z
  .object({
    attendance: z
      .object({
        lateToAbsentMinutes: z.number().int().min(1).max(240).default(30),
        correctionWindowHours: z.number().int().min(0).max(720).default(48),
        guardianJustificationsEnabled: z.boolean().default(false),
        repeatedAbsenceThreshold: z.number().int().min(1).max(50).default(3),
        repeatedAbsenceWindowDays: z.number().int().min(1).max(365).default(30),
      })
      .partial()
      .default({}),
    notifications: z
      .object({
        smsMonthlyCap: z.number().int().min(0).default(2000),
        quietHours: z.object({ from: z.string(), to: z.string() }).optional(),
      })
      .partial()
      .default({}),
    billing: z
      .object({
        graceDays: z.number().int().min(0).max(90).default(0),
        reminderDaysBefore: z.array(z.number().int().min(1).max(60)).max(5).default([7, 1]),
        overdueReminderEveryDays: z.number().int().min(1).max(90).default(14),
      })
      .partial()
      .default({}),
    payments: z
      .object({
        /** Montant minimal d'un paiement en ligne (frais fixes des providers). */
        minAmount: z.number().int().min(0).max(1_000_000).default(100),
        allowOverpayment: z.boolean().default(false),
      })
      .partial()
      .default({}),
    /** Durées de conservation (Partie 11) : anonymisation automatique par le worker. */
    privacy: z
      .object({
        /** Années après le départ d'un élève avant anonymisation (assiduité : 5 ans). */
        studentRetentionYears: z.number().int().min(1).max(15).default(5),
        /** Années d'inactivité d'un tuteur sans enfant rattaché avant anonymisation (2 ans). */
        inactiveGuardianYears: z.number().int().min(1).max(10).default(2),
        /** Désactive l'anonymisation automatique (une obligation légale particulière, par exemple). */
        automaticRetentionEnabled: z.boolean().default(true),
      })
      .partial()
      .default({}),
    onboarding: z
      .object({
        /** L'administrateur a masqué l'assistant de démarrage. */
        dismissedAt: z.string().datetime().nullable().default(null),
      })
      .partial()
      .default({}),
  })
  .partial();
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;

@Injectable()
export class TenantService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Tenant courant (lecture sous RLS : la ligne n'est visible que si c'est bien le tenant du contexte). */
  async current() {
    const tenantId = RequestContextStore.require().tenantId!;
    const row = await this.db
      .current()
      .query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!row) throw AppError.notFound('Établissement');
    return this.toDto(row);
  }

  async updateSettings(patch: TenantSettings) {
    const tx = this.db.current();
    const before = await this.current();
    // Fusion par section : un PATCH de `notifications` ne réinitialise pas `attendance` (les sections absentes
    // arrivent vides après validation, et un objet vide ne doit rien écraser).
    const current = before.settings as Record<string, Record<string, unknown> | undefined>;
    const merged: Record<string, unknown> = { ...current };
    for (const [section, value] of Object.entries(patch as Record<string, unknown>)) {
      merged[section] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? { ...(current[section] ?? {}), ...(value as Record<string, unknown>) }
          : value;
    }
    const [row] = await tx
      .update(tenants)
      .set({ settings: merged })
      .where(eq(tenants.id, before.id))
      .returning();
    await this.audit.record({
      action: 'tenant.settings_updated',
      entityType: 'Tenant',
      entityId: before.id,
      before: before.settings,
      after: merged,
    });
    return this.toDto(row!);
  }

  toDto(row: typeof tenants.$inferSelect) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      status: row.status,
      timezone: row.timezone,
      country: row.country,
      settings: row.settings,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
