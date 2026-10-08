import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { BillingModule } from '../billing';
import { StudentsGuardiansModule } from '../students-guardians';
import { FakeCheckoutService } from './application/fake-checkout.service';
import { PaymentConfigService } from './application/payment-config.service';
import { PaymentsQueue } from './application/payments.queue';
import { PaymentsService } from './application/payments.service';
import { ReconciliationService } from './application/reconciliation.service';
import { WebhookService } from './application/webhook.service';
import {
  FakeProviderController,
  MyChildrenPaymentsController,
  PaymentAttemptsController,
  PaymentConfigController,
  PaymentReconciliationController,
  PaymentWebhooksController,
} from './controllers/payments.controller';
import { ProviderRegistry } from './infrastructure/provider-registry';

@Module({
  imports: [AuditModule, BillingModule, StudentsGuardiansModule],
  controllers: [
    MyChildrenPaymentsController,
    PaymentAttemptsController,
    PaymentReconciliationController,
    PaymentConfigController,
    PaymentWebhooksController,
    FakeProviderController,
  ],
  providers: [
    ProviderRegistry,
    PaymentConfigService,
    PaymentsQueue,
    PaymentsService,
    WebhookService,
    ReconciliationService,
    FakeCheckoutService,
  ],
  exports: [
    PaymentsService,
    ReconciliationService,
    PaymentConfigService,
    ProviderRegistry,
    PaymentsQueue,
  ],
})
export class PaymentsModule {}
