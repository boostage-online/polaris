import type { Request, Response } from 'express';
import type { Env } from '../../../config/env';

export const REFRESH_COOKIE = 'polaris_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** Mode cookie (web) si l'en-tête X-Client commence par "web" ; sinon le refresh voyage dans le corps (mobile). */
export function isWebClient(req: Request): boolean {
  const client = req.headers['x-client'];
  return typeof client === 'string' && client.toLowerCase().startsWith('web');
}

export function setRefreshCookie(res: Response, env: Env, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    domain: env.COOKIE_DOMAIN,
    expires: expiresAt,
  });
}
export function clearRefreshCookie(res: Response, env: Env) {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, domain: env.COOKIE_DOMAIN });
}
export function readRefresh(req: Request, bodyToken?: string): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return bodyToken ?? cookies?.[REFRESH_COOKIE] ?? null;
}
