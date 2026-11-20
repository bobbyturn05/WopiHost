import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class WopiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WopiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (status === 409) {
        const currentLock = typeof body === 'object' && body !== null && 'currentLock' in body
          ? (body as { currentLock?: unknown }).currentLock
          : '';
        response.setHeader('X-WOPI-Lock', typeof currentLock === 'string' ? currentLock : '');
      }

      if (status === 503) response.setHeader('Retry-After', '1');
      if (status >= 500) {
        response.setHeader('X-WOPI-ServerError', 'The WOPI host could not complete the request');
        this.logger.error('WOPI request failed', exception instanceof Error ? exception.stack : undefined);
      }
      response.status(status).json(status >= 500
        ? { statusCode: status, message: 'WOPI request failed' }
        : body);
      return;
    }

    response.setHeader('X-WOPI-ServerError', 'The WOPI host could not complete the request');
    this.logger.error('Unexpected WOPI request failure', exception instanceof Error ? exception.stack : String(exception));
    response.status(500).json({ statusCode: 500, message: 'WOPI request failed' });
  }
}
