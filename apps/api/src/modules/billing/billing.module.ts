import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic';
import { AuditModule } from '../audit';
import { StudentsGuardiansModule } from '../students-guardians';
import { CatalogService } from './application/catalog.service';
import { FinanceDashboardService } from './application/finance-dashboard.service';
import { LedgerService } from './application/ledger.service';
import { ReceiptService } from './application/receipt.service';
import { UnpaidService } from './application/unpaid.service';
import {
  ExportsController,
  FeeCategoriesController,
  FeeStructuresController,
  FeesController,
  FinanceDashboardController,
  MyChildrenFinanceController,
  PaymentsController,
  ReceiptVerificationController,
  StudentBillingController,
  UnpaidController,
} from './controllers/billing.controller';

@Module({
  imports: [AuditModule, AcademicModule, StudentsGuardiansModule],
  controllers: [
    FeeCategoriesController,
    FeeStructuresController,
    FeesController,
    StudentBillingController,
    PaymentsController,
    ReceiptVerificationController,
    UnpaidController,
    ExportsController,
    FinanceDashboardController,
    MyChildrenFinanceController,
  ],
  providers: [
    CatalogService,
    ReceiptService,
    LedgerService,
    UnpaidService,
    FinanceDashboardService,
  ],
  exports: [LedgerService, UnpaidService, ReceiptService],
})
export class BillingModule {}
