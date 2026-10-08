import { HttpStatus } from '@nestjs/common';
import { ErrorCodes, type ErrorCode } from '@polaris/contracts';

export interface FieldError {
  path: string;
  message: string;
  code?: string;
}

/**
 * Erreur applicative typée, convertie en RFC 9457 par ProblemDetailsFilter.
 * Les erreurs attendues (4xx) ne sont pas remontées à Sentry.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly errors?: FieldError[],
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(errors: FieldError[], message = 'Données invalides') {
    return new AppError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCodes.VALIDATION_FAILED,
      message,
      errors,
    );
  }
  static unauthenticated(
    message = 'Authentification requise',
    code: ErrorCode = ErrorCodes.UNAUTHENTICATED,
  ) {
    return new AppError(HttpStatus.UNAUTHORIZED, code, message);
  }
  static forbidden(message = 'Action non autorisée', code: ErrorCode = ErrorCodes.FORBIDDEN) {
    return new AppError(HttpStatus.FORBIDDEN, code, message);
  }
  /** 404 pour une ressource inexistante OU appartenant à un autre tenant (jamais 403). */
  static notFound(entity = 'Ressource') {
    return new AppError(HttpStatus.NOT_FOUND, ErrorCodes.NOT_FOUND, `${entity} introuvable`);
  }
  static conflict(
    message: string,
    code: ErrorCode = ErrorCodes.CONFLICT,
    extra?: Record<string, unknown>,
  ) {
    return new AppError(HttpStatus.CONFLICT, code, message, undefined, extra);
  }
  static rateLimited(retryAfterSeconds: number, message = 'Trop de requêtes', scope?: string) {
    return new AppError(HttpStatus.TOO_MANY_REQUESTS, ErrorCodes.RATE_LIMITED, message, undefined, {
      retryAfterSeconds,
      scope,
    });
  }
}
