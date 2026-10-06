import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestContextStore } from '../../database/request-context';

/** Ouvre le contexte AsyncLocalStorage de la requête : request_id, trace_id, IP, user agent. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId =
      (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) ?? randomUUID();
    const traceId =
      (req.headers['traceparent'] as string | undefined)?.split('-')[1] ??
      randomUUID().replace(/-/g, '');
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Trace-Id', traceId);
    const ctx = RequestContextStore.blank({
      requestId,
      traceId,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] ?? null) as string | null,
    });
    RequestContextStore.run(ctx, () => next());
  }
}
