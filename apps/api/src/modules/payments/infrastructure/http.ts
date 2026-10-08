import { ProviderError } from '../domain/provider';

/**
 * Appels HTTP sortants vers les providers : délai borné, erreurs réseau → `ProviderError('UNAVAILABLE'|'TIMEOUT')`,
 * 401/403 → `AUTH`, autres 4xx → `REJECTED` (le corps est conservé dans `detail` pour la chronologie, jamais logué brut).
 */
export interface HttpJson {
  status: number;
  body: unknown;
}

export async function fetchJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs: number },
): Promise<HttpJson> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'TimeoutError' || name === 'AbortError')
      throw new ProviderError(
        'TIMEOUT',
        `Délai dépassé (${init.timeoutMs} ms) vers ${new URL(url).host}`,
      );
    throw new ProviderError('UNAVAILABLE', `Provider injoignable : ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = { raw: text.slice(0, 2000) };
  }
  if (res.status >= 500)
    throw new ProviderError('UNAVAILABLE', `Erreur provider ${res.status}`, body);
  if (res.status === 401 || res.status === 403)
    throw new ProviderError('AUTH', 'Clés provider refusées', body);
  return { status: res.status, body };
}

export const pick = (o: unknown, path: string[]): unknown =>
  path.reduce<unknown>(
    (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
    o,
  );
export const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return null;
};
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
