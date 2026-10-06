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
    const merged = { ...before.settings, ...patch } as Record<string, unknown>;
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
