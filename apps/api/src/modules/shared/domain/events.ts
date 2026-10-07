/**
 * Événements métier publiés via l'outbox. Nom au passé, PascalCase ; payload sérialisable.
 * Chaque module déclare ses propres événements et les ré-exporte ici pour le worker.
 */
export interface DomainEvent<
  TType extends string = string,
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  type: TType;
  aggregateType: string;
  aggregateId?: string;
  tenantId?: string | null;
  payload: TPayload;
}

export const EventTypes = {
  TenantCreated: 'TenantCreated',
  TenantStatusChanged: 'TenantStatusChanged',
  UserInvited: 'UserInvited',
  InvitationAccepted: 'InvitationAccepted',
  RoleChanged: 'RoleChanged',
  RefreshTokenReuseDetected: 'RefreshTokenReuseDetected',
  OtpRequested: 'OtpRequested',
} as const;
export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export const tenantCreated = (p: {
  tenantId: string;
  code: string;
  name: string;
}): DomainEvent => ({
  type: EventTypes.TenantCreated,
  aggregateType: 'Tenant',
  aggregateId: p.tenantId,
  tenantId: p.tenantId,
  payload: p,
});
export const tenantStatusChanged = (p: {
  tenantId: string;
  from: string;
  to: string;
  reason?: string;
}): DomainEvent => ({
  type: EventTypes.TenantStatusChanged,
  aggregateType: 'Tenant',
  aggregateId: p.tenantId,
  tenantId: p.tenantId,
  payload: p,
});
export const userInvited = (p: {
  tenantId: string;
  email: string;
  displayName: string;
  token: string;
  expiresAt: string;
}): DomainEvent => ({
  type: EventTypes.UserInvited,
  aggregateType: 'Invitation',
  tenantId: p.tenantId,
  payload: p,
});
export const roleChanged = (p: {
  tenantId: string;
  membershipId: string;
  roleIds: string[];
}): DomainEvent => ({
  type: EventTypes.RoleChanged,
  aggregateType: 'Membership',
  aggregateId: p.membershipId,
  tenantId: p.tenantId,
  payload: p,
});
export const refreshTokenReuseDetected = (p: {
  userId: string;
  familyId: string;
  ip: string | null;
}): DomainEvent => ({
  type: EventTypes.RefreshTokenReuseDetected,
  aggregateType: 'User',
  aggregateId: p.userId,
  tenantId: null,
  payload: p,
});
export const otpRequested = (p: {
  phone: string;
  code: string;
  purpose: string;
  expiresAt: string;
}): DomainEvent => ({
  type: EventTypes.OtpRequested,
  aggregateType: 'Otp',
  tenantId: null,
  payload: p,
});
