import { Controller, Delete, Get, HttpCode, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { MeSchema, SessionSchema } from '@polaris/contracts';
import { z } from 'zod';
import { ApiDoc, CurrentActor, NoTransaction, Scope } from '../../../common/decorators';
import type { Actor } from '../../../database/request-context';
import { AuthService } from '../application/auth.service';
import { PermissionGuard } from '../infrastructure/permission.guard';
import { readRefresh } from './cookies';

@Controller('me')
@Scope('identity')
@NoTransaction()
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly permissions: PermissionGuard,
  ) {}

  @Get()
  @ApiDoc({
    summary: 'Profil, appartenances et permissions effectives',
    tags: ['me'],
    response: MeSchema,
  })
  async me(@CurrentActor() actor: Actor) {
    const perms = await this.permissions.resolve(
      actor.membershipId,
      actor.kind,
      actor.tenantId,
      actor.permissionsVersion,
    );
    return this.auth.me(actor.userId, actor.membershipId, perms);
  }

  @Get('sessions')
  @ApiDoc({
    summary: 'Sessions actives (appareils)',
    tags: ['me'],
    response: z.array(SessionSchema),
  })
  sessions(@CurrentActor() actor: Actor, @Req() req: Request) {
    return this.auth.listSessions(actor.userId, readRefresh(req));
  }

  @Delete('sessions/:familyId')
  @HttpCode(204)
  @ApiDoc({ summary: 'Révoquer une session', tags: ['me'], status: 204 })
  async revoke(@CurrentActor() actor: Actor, @Param('familyId') familyId: string) {
    await this.auth.revokeSession(actor.userId, familyId);
  }
}
