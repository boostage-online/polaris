import { Controller, Get } from '@nestjs/common';
import type { z } from 'zod';
import { AuditQuerySchema } from '@polaris/contracts';
import { ApiDoc, RequirePermission, ZodQuery } from '../../../common/decorators';
import { AuditService } from '../application/audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('VIEW_AUDIT_LOG')
  @ApiDoc({
    summary: "Journal d'audit de l'établissement (curseur)",
    tags: ['audit'],
    query: AuditQuerySchema,
  })
  list(@ZodQuery(AuditQuerySchema) query: z.infer<typeof AuditQuerySchema>) {
    return this.audit.list(query);
  }
}
