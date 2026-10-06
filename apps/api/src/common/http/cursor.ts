import { AppError } from '../errors/app-error';

/** Curseur opaque (base64url JSON) pour la pagination (ADR-0009). */
export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
export function decodeCursor<T extends Record<string, string | number>>(
  cursor: string | undefined,
): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw AppError.validation([{ path: 'cursor', message: 'Curseur invalide' }]);
  }
}
export function page<T>(
  items: T[],
  limit: number,
  cursorOf: (last: T) => Record<string, string | number>,
) {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const last = data[data.length - 1];
  return {
    data,
    meta: { nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null, limit },
  };
}
