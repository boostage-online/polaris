import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { AuthService } from './application/auth.service';
import { InvitationService } from './application/invitation.service';
import { LockoutService } from './application/lockout.service';
import { PasswordService } from './application/password.service';
import { RefreshTokenService } from './application/refresh-token.service';
import { RoleService } from './application/role.service';
import { SessionService } from './application/session.service';
import { TokenService } from './application/token.service';
import { AuthController } from './controllers/auth.controller';
import { MeController } from './controllers/me.controller';
import { MembersController, RolesController } from './controllers/roles.controller';
import { AuthGuard } from './infrastructure/auth.guard';
import { IdentityRepository } from './infrastructure/identity.repository';
import { PermissionCache } from './infrastructure/permission.cache';
import { PermissionGuard } from './infrastructure/permission.guard';
import { ScopeGuard } from './infrastructure/scope.guard';

@Module({
  imports: [AuditModule],
  controllers: [AuthController, MeController, RolesController, MembersController],
  providers: [
    PasswordService,
    TokenService,
    RefreshTokenService,
    LockoutService,
    SessionService,
    AuthService,
    RoleService,
    InvitationService,
    IdentityRepository,
    PermissionCache,
    AuthGuard,
    ScopeGuard,
    PermissionGuard,
  ],
  exports: [
    AuthGuard,
    ScopeGuard,
    PermissionGuard,
    RoleService,
    InvitationService,
    PasswordService,
    TokenService,
    IdentityRepository,
  ],
})
export class IdentityModule {}
