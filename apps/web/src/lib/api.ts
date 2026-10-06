'use client';
import type { Me, ProblemDetails, TokenPair } from '@polaris/contracts';

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

export const auth = {
  login: (identifier: string, password: string) =>
    api<TokenPair>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
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
