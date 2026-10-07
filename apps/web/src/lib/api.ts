'use client';
import type { LoginResponse, Me, ProblemDetails, TokenPair } from '@polaris/contracts';

/**
 * Client HTTP du web (ADR-0009, ADR-0008) :
 *  - access token en mémoire uniquement (jamais localStorage) ;
 *  - refresh token en cookie HttpOnly posé par l'API (en-tête X-Client: web/…) ;
 *  - sur 401 TOKEN_EXPIRED, un refresh est tenté une fois puis la requête rejouée.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const CLIENT = `web/${process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0'}`;

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.detail ?? problem.title);
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function hasSession() {
  return accessToken !== null;
}

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-Client', CLIENT);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(`${API_URL}/api/v1${path}`, { ...init, headers, credentials: 'include' });
}

export async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await rawFetch('/auth/refresh', { method: 'POST', body: '{}' });
      if (!res.ok) return false;
      const { data } = (await res.json()) as { data: TokenPair };
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Réponse enveloppée `{ data, meta }` (listes paginées, avertissements). */
export interface Envelope<T, M = Record<string, unknown>> {
  data: T;
  meta: M;
}
export interface PageMeta {
  nextCursor: string | null;
  limit: number;
}

/** Construit une query string en ignorant les valeurs vides. */
export function qs(params: object): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params) as [string, unknown][]) {
    if (typeof v === 'string' && v !== '') sp.set(k, v);
    else if (typeof v === 'number' || typeof v === 'boolean') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export async function apiEnvelope<T, M = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Envelope<T, M>> {
  const res = await rawFetch(path, init);
  if (res.status === 401 && retry) {
    const problem = (await res
      .clone()
      .json()
      .catch(() => null)) as ProblemDetails | null;
    if (problem?.code === 'TOKEN_EXPIRED' || !accessToken) {
      if (await refreshSession()) return apiEnvelope<T, M>(path, init, false);
    }
  }
  const body = (await res.json().catch(() => null)) as Envelope<T, M> | ProblemDetails | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body as ProblemDetails | null) ?? {
        type: 'about:blank',
        title: res.statusText,
        status: res.status,
        code: 'INTERNAL',
      },
    );
  }
  const env = body as Envelope<T, M>;
  return { data: env.data, meta: env.meta ?? ({} as M) };
}

export const json = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});
export const patch = (body: unknown): RequestInit => ({
  method: 'PATCH',
  body: JSON.stringify(body),
});
export const put = (body: unknown): RequestInit => ({
  method: 'PUT',
  body: JSON.stringify(body),
});
export const del = (body?: unknown): RequestInit => ({
  method: 'DELETE',
  body: body === undefined ? undefined : JSON.stringify(body),
});

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await rawFetch(path, init);
  if (res.status === 401 && retry) {
    const problem = (await res
      .clone()
      .json()
      .catch(() => null)) as ProblemDetails | null;
    if (problem?.code === 'TOKEN_EXPIRED' || !accessToken) {
      if (await refreshSession()) return api<T>(path, init, false);
    }
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { data?: T } | ProblemDetails | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body as ProblemDetails) ?? {
        type: 'about:blank',
        title: res.statusText,
        status: res.status,
        code: 'INTERNAL',
      },
    );
  }
  return (body as { data: T }).data;
}

/** Téléchargement binaire ou texte (PDF de reçu, export CSV) avec le jeton courant. */
export async function apiBlob(
  path: string,
  retry = true,
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await rawFetch(path);
  if (res.status === 401 && retry && (await refreshSession())) return apiBlob(path, false);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ProblemDetails | null;
    throw new ApiError(
      res.status,
      body ?? { type: 'about:blank', title: res.statusText, status: res.status, code: 'INTERNAL' },
    );
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const m = /filename="?([^";]+)"?/.exec(disposition);
  return { blob: await res.blob(), filename: m?.[1] ?? null };
}

/** Ouvre ou enregistre un fichier téléchargé via `apiBlob`. */
export async function downloadFile(path: string, fallbackName: string) {
  const { blob, filename } = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Requête publique (sans jeton ni cookie) : vérification de reçu. */
export async function apiPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, { headers: { 'X-Client': CLIENT } });
  const body = (await res.json().catch(() => null)) as { data?: T } | ProblemDetails | null;
  if (!res.ok)
    throw new ApiError(
      res.status,
      (body as ProblemDetails | null) ?? {
        type: 'about:blank',
        title: res.statusText,
        status: res.status,
        code: 'INTERNAL',
      },
    );
  return (body as { data: T }).data;
}

/** Session de support (impersonation) : le jeton plateforme d'origine est conservé en mémoire pour revenir. */
let impersonationOrigin: string | null = null;
export function startImpersonation(token: string) {
  impersonationOrigin = accessToken;
  accessToken = token;
}
export function endImpersonation() {
  accessToken = impersonationOrigin;
  impersonationOrigin = null;
}
export function isImpersonating() {
  return impersonationOrigin !== null;
}

export const auth = {
  /** Renvoie soit la session, soit un défi MFA (`mfaRequired`). */
  login: (identifier: string, password: string) =>
    api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }).then((r) => {
      if (!('mfaRequired' in r)) accessToken = r.accessToken;
      return r;
    }),
  mfaVerify: (challenge: string, factor: { code?: string; recoveryCode?: string }) =>
    api<TokenPair>('/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ challenge, ...factor }),
    }).then((pair) => {
      accessToken = pair.accessToken;
      return pair;
    }),
  switchMembership: (membershipId: string) =>
    api<TokenPair>('/auth/switch-membership', {
      method: 'POST',
      body: JSON.stringify({ membershipId }),
    }).then((pair) => {
      accessToken = pair.accessToken;
      return pair;
    }),
  acceptInvitation: (token: string, password: string, displayName?: string) =>
    api<{ userId: string }>('/auth/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token, password, displayName }),
    }),
  logout: async () => {
    await rawFetch('/auth/logout', { method: 'POST', body: '{}' });
    accessToken = null;
  },
  me: () => api<Me>('/me'),
};
