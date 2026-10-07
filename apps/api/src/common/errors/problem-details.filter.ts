import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCodes, type ProblemDetails } from '@polaris/contracts';
import { RequestContextStore } from '../../database/request-context';
import { AppError } from './app-error';

const TYPE_BASE = 'https://docs.polaris.app/errors/';

/** Convertit toute exception en application/problem+json (RFC 9457, ADR-0009). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const traceId =
      RequestContextStore.get()?.traceId ?? (req.headers['x-request-id'] as string | undefined);

    const problem = this.toProblem(exception, traceId);
    if (problem.status >= 500) {
      this.logger.error({ msg: 'unhandled error', err: exception, path: req.path, traceId });
    }
    if (problem.status === 429 && exception instanceof AppError) {
      const retry = exception.extra?.['retryAfterSeconds'];
      if (typeof retry === 'number') res.setHeader('Retry-After', String(retry));
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, traceId?: string): ProblemDetails {
    if (exception instanceof AppError) {
      return {
        type: `${TYPE_BASE}${exception.code.toLowerCase().replace(/_/g, '-')}`,
        title: exception.message,
        status: exception.status,
        code: exception.code,
        detail: exception.message,
        traceId,
        errors: exception.errors,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
      const code =
        status === 401
          ? ErrorCodes.UNAUTHENTICATED
          : status === 403
            ? ErrorCodes.FORBIDDEN
            : status === 404
              ? ErrorCodes.NOT_FOUND
              : status === 409
                ? ErrorCodes.CONFLICT
                : status === 400 || status === 422
                  ? ErrorCodes.VALIDATION_FAILED
                  : status === 429
                    ? ErrorCodes.RATE_LIMITED
                    : ErrorCodes.INTERNAL;
      return {
        type: `${TYPE_BASE}${code.toLowerCase().replace(/_/g, '-')}`,
        title: exception.message,
        status,
        code,
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
        traceId,
      };
    }
    return {
      type: `${TYPE_BASE}internal`,
      title: 'Erreur interne',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCodes.INTERNAL,
      detail: 'Une erreur inattendue est survenue. Communiquez le code support au service client.',
      traceId,
    };
  }
}
