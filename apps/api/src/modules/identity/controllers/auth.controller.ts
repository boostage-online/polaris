import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  LoginPasswordSchema,
  LoginResponseSchema,
  MfaVerifySchema,
  RefreshSchema,
  RequestOtpSchema,
  SwitchMembershipSchema,
  TokenPairSchema,
  VerifyOtpSchema,
  type LoginPasswordInput,
  type MfaChallenge,
} from '@polaris/contracts';
import {
  ApiDoc,
  CurrentActor,
  NoTransaction,
  Public,
  RateLimit,
  Scope,
  ZodBody,
} from '../../../common/decorators';
import { ENV, type Env } from '../../../config/env';
import type { Actor } from '../../../database/request-context';
import { AuthService } from '../application/auth.service';
import { InvitationService } from '../application/invitation.service';
import { MfaService } from '../application/mfa.service';
import { TokenService } from '../application/token.service';
import type { IssuedSession } from '../application/session.service';
import { clearRefreshCookie, isWebClient, readRefresh, setRefreshCookie } from './cookies';

const AcceptInvitationSchema = z.object({
  token: z.string().min(32).max(512),
  password: z.string().min(10).max(256),
  displayName: z.string().min(2).max(120).optional(),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invitations: InvitationService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private respond(req: Request, res: Response, session: IssuedSession | MfaChallenge) {
    if ('mfaRequired' in session) return session;
    if (isWebClient(req)) {
      setRefreshCookie(res, this.env, session.refresh.token, session.refresh.expiresAt);
      return session.pair;
    }
    return { ...session.pair, refreshToken: session.refresh.token };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @RateLimit({ points: 10, duration: 60, keyBy: 'identifier', name: 'login' })
  @ApiDoc({
    summary: 'Connexion par identifiant et mot de passe (défi MFA si activée)',
    tags: ['auth'],
    body: LoginPasswordSchema,
    response: LoginResponseSchema,
  })
  async login(
    @ZodBody(LoginPasswordSchema) body: LoginPasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(req, res, await this.auth.loginWithPassword(body));
  }

  @Post('mfa/verify')
  @Public()
  @HttpCode(200)
  @RateLimit({ points: 60, duration: 60, keyBy: 'ip', name: 'mfa' })
  @ApiDoc({
    summary: 'Relever le défi MFA (code TOTP ou code de récupération) et ouvrir la session',
    tags: ['auth'],
    body: MfaVerifySchema,
    response: TokenPairSchema,
  })
  async mfaVerify(
    @ZodBody(MfaVerifySchema) body: z.infer<typeof MfaVerifySchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(req, res, await this.mfa.verifyChallenge(body));
  }

  @Post('otp/request')
  @Public()
  @HttpCode(202)
  @RateLimit({ points: 5, duration: 300, keyBy: 'identifier', name: 'otp' })
  @ApiDoc({
    summary: "Demande d'un code OTP par SMS (réponse identique que le numéro existe ou non)",
    tags: ['auth'],
    body: RequestOtpSchema,
    status: 202,
  })
  async requestOtp(@ZodBody(RequestOtpSchema) body: z.infer<typeof RequestOtpSchema>) {
    await this.auth.requestOtp(body.phone);
    return { accepted: true };
  }

  @Post('otp/verify')
  @Public()
  @HttpCode(200)
  @RateLimit({ points: 10, duration: 300, keyBy: 'identifier', name: 'otp-verify' })
  @ApiDoc({
    summary: 'Connexion par code OTP',
    tags: ['auth'],
    body: VerifyOtpSchema,
    response: TokenPairSchema,
  })
  async verifyOtp(
    @ZodBody(VerifyOtpSchema) body: z.infer<typeof VerifyOtpSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(req, res, await this.auth.verifyOtp(body));
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @RateLimit({ points: 30, duration: 60, keyBy: 'ip', name: 'refresh' })
  @ApiDoc({
    summary: 'Rotation du refresh token (cookie web ou corps mobile)',
    tags: ['auth'],
    body: RefreshSchema,
    response: TokenPairSchema,
  })
  async refresh(
    @ZodBody(RefreshSchema) body: z.infer<typeof RefreshSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = readRefresh(req, body.refreshToken);
    if (!raw) {
      clearRefreshCookie(res, this.env);
      return this.respond(req, res, await this.auth.refresh('', {}));
    }
    return this.respond(req, res, await this.auth.refresh(raw, {}));
  }

  @Post('switch-membership')
  @Scope('identity')
  @NoTransaction()
  @HttpCode(200)
  @ApiDoc({
    summary: "Changer d'établissement actif",
    tags: ['auth'],
    body: SwitchMembershipSchema,
    response: TokenPairSchema,
  })
  async switchMembership(
    @ZodBody(SwitchMembershipSchema) body: z.infer<typeof SwitchMembershipSchema>,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = readRefresh(req, (req.body as { refreshToken?: string }).refreshToken);
    return this.respond(
      req,
      res,
      await this.auth.switchMembership(
        actor.userId,
        body.membershipId,
        raw,
        {},
        actor.mfa === true,
      ),
    );
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiDoc({ summary: 'Déconnexion de cet appareil', tags: ['auth'], status: 204 })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(
      readRefresh(req, (req.body as { refreshToken?: string } | undefined)?.refreshToken),
    );
    clearRefreshCookie(res, this.env);
  }

  @Post('logout-all')
  @Scope('identity')
  @NoTransaction()
  @HttpCode(204)
  @ApiDoc({ summary: 'Déconnexion de tous les appareils', tags: ['auth'], status: 204 })
  async logoutAll(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(actor.userId);
    clearRefreshCookie(res, this.env);
  }

  @Post('invitations/accept')
  @Public()
  @HttpCode(200)
  @RateLimit({ points: 10, duration: 300, keyBy: 'ip', name: 'invitation' })
  @ApiDoc({
    summary: 'Accepter une invitation et créer son mot de passe',
    tags: ['auth'],
    body: AcceptInvitationSchema,
  })
  async acceptInvitation(
    @ZodBody(AcceptInvitationSchema) body: z.infer<typeof AcceptInvitationSchema>,
  ) {
    return this.invitations.accept(body);
  }

  @Get('.well-known/jwks.json')
  @Public()
  @ApiDoc({ summary: 'Clés publiques de vérification des JWT', tags: ['auth'] })
  jwks() {
    return this.tokens.publicJwks();
  }
}
