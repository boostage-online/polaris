import { Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  MeSchema,
  MfaDisableSchema,
  MfaEnableResponseSchema,
  MfaEnableSchema,
  MfaSetupResponseSchema,
  MfaStatusSchema,
  SessionSchema,
} from '@polaris/contracts';
import { z } from 'zod';
import {
  ApiDoc,
  CurrentActor,
  NoTransaction,
  RateLimit,
  Scope,
  ZodBody,
} from '../../../common/decorators';
import type { Actor } from '../../../database/request-context';
import { AuthService } from '../application/auth.service';
import { MfaService } from '../application/mfa.service';
import { PermissionGuard } from '../infrastructure/permission.guard';
import { readRefresh } from './cookies';

@Controller('me')
@Scope('identity')
@NoTransaction()
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly permissions: PermissionGuard,
    private readonly mfa: MfaService,
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
    return this.auth.me(actor.userId, actor.membershipId, perms, {
      mfa: actor.mfa === true,
      impersonationSessionId: actor.impersonationSessionId ?? null,
    });
  }

  // ------------------------------------------------------------------ MFA TOTP

  @Get('mfa')
  @ApiDoc({
    summary: 'État de la MFA du compte et de la session',
    tags: ['me'],
    response: MfaStatusSchema,
  })
  async mfaStatus(@CurrentActor() actor: Actor) {
    const perms = await this.permissions.resolve(
      actor.membershipId,
      actor.kind,
      actor.tenantId,
      actor.permissionsVersion,
    );
    return this.mfa.status(actor.userId, actor.kind, perms, actor.mfa === true);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @RateLimit({ points: 5, duration: 60, keyBy: 'user', name: 'mfa-setup' })
  @ApiDoc({
    summary: 'Démarrer l’enrôlement MFA : secret provisoire (10 min) et URL otpauth',
    tags: ['me'],
    response: MfaSetupResponseSchema,
  })
  mfaSetup(@CurrentActor() actor: Actor) {
    return this.mfa.setup(actor.userId);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @RateLimit({ points: 10, duration: 60, keyBy: 'user', name: 'mfa-enable' })
  @ApiDoc({
    summary:
      'Activer la MFA avec un premier code valide ; renvoie les codes de récupération (une seule fois)',
    tags: ['me'],
    body: MfaEnableSchema,
    response: MfaEnableResponseSchema,
  })
  mfaEnable(
    @ZodBody(MfaEnableSchema) b: z.infer<typeof MfaEnableSchema>,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ) {
    return this.mfa.enable(actor.userId, b.code, readRefresh(req));
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @RateLimit({ points: 10, duration: 60, keyBy: 'user', name: 'mfa-disable' })
  @ApiDoc({
    summary: 'Désactiver la MFA (preuve par code TOTP ou code de récupération)',
    tags: ['me'],
    body: MfaDisableSchema,
  })
  mfaDisable(
    @ZodBody(MfaDisableSchema) b: z.infer<typeof MfaDisableSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.mfa.disable(actor.userId, b);
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @RateLimit({ points: 5, duration: 60, keyBy: 'user', name: 'mfa-recovery' })
  @ApiDoc({
    summary: 'Régénérer les codes de récupération (les anciens sont invalidés)',
    tags: ['me'],
    body: MfaDisableSchema,
  })
  mfaRecovery(
    @ZodBody(MfaDisableSchema) b: z.infer<typeof MfaDisableSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.mfa.regenerateRecoveryCodes(actor.userId, b);
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
