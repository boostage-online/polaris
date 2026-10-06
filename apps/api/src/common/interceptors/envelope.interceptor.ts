import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

export const RAW_RESPONSE = Symbol('RAW_RESPONSE');
export interface RawResponse {
  [RAW_RESPONSE]: true;
  body: unknown;
}
export const raw = (body: unknown): RawResponse => ({ [RAW_RESPONSE]: true, body });

/** Enveloppe `{ data, meta }` (ADR-0009). Un handler peut renvoyer `{ data, meta }` lui-même ou `raw()`. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        if (value === undefined || value === null) return value;
        if (typeof value === 'object' && RAW_RESPONSE in (value as object))
          return (value as RawResponse).body;
        if (typeof value === 'object' && 'data' in (value as object) && 'meta' in (value as object))
          return value;
        return { data: value };
      }),
    );
  }
}
