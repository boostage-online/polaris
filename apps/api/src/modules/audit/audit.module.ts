import { Module } from '@nestjs/common';
import { AuditService } from './application/audit.service';
import { AuditController } from './controllers/audit.controller';

@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
