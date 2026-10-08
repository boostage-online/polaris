import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { NotificationPlanner } from '../modules/notifications';
import { EMAIL_GATEWAY, EventTypes, type EmailGateway } from '../modules/shared';

export interface QueuedEvent {
  id: string;
  type: string;
  tenantId: string | null;
  aggregateType: string;
  aggregateId: string | null;
  payload: Record<string, unknown> & { _meta?: Record<string, unknown> };
  occurredAt: string;
}

export interface EventHandler {
  /** Nom stable : clé d'idempotence dans processed_events. */
  readonly name: string;
  readonly eventTypes: readonly string[];
  handle(event: QueuedEvent): Promise<void>;
}

@Injectable()
export class InvitationEmailHandler implements EventHandler {
  readonly name = 'invitation-email';
  readonly eventTypes = [EventTypes.UserInvited];
  constructor(
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}
  async handle(event: QueuedEvent) {
    const p = event.payload as {
      email: string;
      displayName: string;
      token: string;
      expiresAt: string;
    };
    const link = `${this.env.WEB_ORIGIN}/invitation?token=${encodeURIComponent(p.token)}`;
    await this.email.send({
      to: p.email,
      subject: 'Votre accès Polaris',
      text: `Bonjour ${p.displayName},\n\nVous avez été invité·e à rejoindre votre établissement sur Polaris. Créez votre mot de passe en suivant ce lien (valable jusqu'au ${new Date(p.expiresAt).toLocaleString('fr-FR')}) :\n${link}\n`,
      reference: `invitation:${event.id}`,
    });
  }
}

@Injectable()
export class SecurityAlertHandler implements EventHandler {
  readonly name = 'security-alert';
  readonly eventTypes = [EventTypes.RefreshTokenReuseDetected];
  private readonly logger = new Logger(SecurityAlertHandler.name);
  async handle(event: QueuedEvent) {
    // Phase 1 : trace de sécurité ; la notification utilisateur arrive avec le moteur de notifications (Phase 3).
    this.logger.warn({
      msg: 'refresh token reuse detected',
      userId: event.aggregateId,
      ip: event.payload['ip'],
    });
  }
}

@Injectable()
export class TenantLifecycleHandler implements EventHandler {
  readonly name = 'tenant-lifecycle';
  readonly eventTypes = [EventTypes.TenantCreated, EventTypes.TenantStatusChanged];
  private readonly logger = new Logger(TenantLifecycleHandler.name);
  async handle(event: QueuedEvent) {
    this.logger.log({ msg: event.type, tenantId: event.tenantId, payload: event.payload });
  }
}

/** Pont vers le moteur de notifications (module `notifications`) : un handler, tous les événements d'assiduité. */
@Injectable()
export class NotificationsEventHandler implements EventHandler {
  readonly name = 'notifications';
  readonly eventTypes: readonly string[];
  constructor(private readonly planner: NotificationPlanner) {
    this.eventTypes = planner.handledTypes;
  }
  handle(event: QueuedEvent) {
    return this.planner.handle(event);
  }
}

export const EVENT_HANDLERS = Symbol('EVENT_HANDLERS');
