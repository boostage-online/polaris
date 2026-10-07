import { createHash, randomBytes } from 'node:crypto';

export interface AccessTokenClaims {
  sub: string;
  mid: string | null;
  tid: string | null;
  kind: 'STAFF' | 'GUARDIAN' | 'PLATFORM' | null;
  pv: number;
  tv: number;
}

/** Refresh token opaque : 256 bits aléatoires, stocké haché (ADR-0008). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function generateOtpCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}
