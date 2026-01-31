import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const { method, url, ip } = request;
    const userAgent = request.get('user-agent') || '';

    const now = Date.now();

    this.logger.log(`→ ${method} ${url} - ${ip} - ${userAgent}`);

    return next.handle().pipe(
      tap({
        next: () => {
          const { statusCode } = response;
          const duration = Date.now() - now;
          this.logger.log(`← ${method} ${url} ${statusCode} - ${duration}ms`);
        },
        error: (error: unknown) => {
          const duration = Date.now() - now;
          const err = error as { status?: number; message?: string };
          const statusCode = err.status || 500;
          this.logger.error(
            `← ${method} ${url} ${statusCode} - ${duration}ms - ${err.message || 'Unknown error'}`,
          );
        },
      }),
    );
  }
}
