import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  InboxQuerySchema,
  NotificationPreferencesSchema,
  NotificationSchema,
  NotificationUsageSchema,
  NotificationsQuerySchema,
} from '@polaris/contracts';
import {
  ApiDoc,
  NoTransaction,
  RequirePermission,
  ZodBody,
  ZodParams,
  ZodQuery,
} from '../../../common/decorators';
import { NotificationService } from '../application/notification.service';

const Id = z.object({ id: z.string().uuid() });
type IdP = z.infer<typeof Id>;

@Controller('me/notifications')
export class MyNotificationsController {
  constructor(private readonly svc: NotificationService) {}

  @Get()
  @ApiDoc({
    summary: 'Mes notifications (in-app) avec le nombre de non lues',
    tags: ['notifications'],
    query: InboxQuerySchema,
  })
  inbox(@ZodQuery(InboxQuerySchema) q: z.infer<typeof InboxQuerySchema>) {
    return this.svc.inbox(q);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiDoc({ summary: 'Tout marquer comme lu', tags: ['notifications'] })
  readAll() {
    return this.svc.markRead('all');
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiDoc({ summary: 'Marquer une notification comme lue', tags: ['notifications'], params: Id })
  read(@ZodParams(Id) p: IdP) {
    return this.svc.markRead(p.id);
  }

  @Get('preferences')
  @ApiDoc({
    summary: 'Mes canaux par type de notification',
    tags: ['notifications'],
    response: NotificationPreferencesSchema,
  })
  preferences() {
    return this.svc.preferences();
  }

  @Put('preferences')
  @ApiDoc({
    summary: 'Modifier mes canaux par type de notification',
    tags: ['notifications'],
    body: NotificationPreferencesSchema,
    response: NotificationPreferencesSchema,
  })
  setPreferences(
    @ZodBody(NotificationPreferencesSchema) b: z.infer<typeof NotificationPreferencesSchema>,
  ) {
    return this.svc.setPreferences(b);
  }
}

@Controller('notifications')
export class NotificationsAdminController {
  constructor(private readonly svc: NotificationService) {}

  @Get()
  @RequirePermission('MANAGE_TENANT_SETTINGS', 'VIEW_AUDIT_LOG')
  @ApiDoc({
    summary: 'Journal des notifications (par élève, destinataire, canal, statut)',
    tags: ['notifications'],
    query: NotificationsQuerySchema,
  })
  journal(@ZodQuery(NotificationsQuerySchema) q: z.infer<typeof NotificationsQuerySchema>) {
    return this.svc.journal(q);
  }

  @Get('usage')
  @RequirePermission('MANAGE_TENANT_SETTINGS', 'VIEW_AUDIT_LOG')
  @ApiDoc({
    summary: 'Consommation SMS du mois et plafond',
    tags: ['notifications'],
    response: NotificationUsageSchema,
  })
  usage() {
    return this.svc.usage();
  }

  @Post(':id/resend')
  @HttpCode(200)
  @NoTransaction()
  @RequirePermission('MANAGE_TENANT_SETTINGS')
  @ApiDoc({
    summary: 'Renvoyer une notification échouée ou suspendue',
    tags: ['notifications'],
    params: Id,
    response: NotificationSchema,
  })
  resend(@ZodParams(Id) p: IdP) {
    return this.svc.resend(p.id);
  }
}
