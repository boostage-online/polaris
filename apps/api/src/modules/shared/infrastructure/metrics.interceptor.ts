import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap, type Observable } from 'rxjs';
import { RequestContextStore } from '../../../database/request-context';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const end = this.metrics.httpDuration.startTimer({ method: req.method, route });
    const finish = () => {
      end({ status: String(res.statusCode) });
      if (res.statusCode >= 500) {
        this.metrics.httpErrors.inc({
          route,
          tenant: RequestContextStore.get()?.tenantId ?? 'none',
        });
      }
    };
    return next.handle().pipe(tap({ next: finish, error: finish }));
  }
}
