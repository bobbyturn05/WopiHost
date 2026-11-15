import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class WopiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (status === 409 && typeof body === 'object' && body !== null && 'currentLock' in body) {
        const currentLock = (body as { currentLock?: unknown }).currentLock;
        if (typeof currentLock === 'string') response.setHeader('X-WOPI-Lock', currentLock);
      }

      if (status === 503) response.setHeader('Retry-After', '1');
      if (status >= 500) response.setHeader('X-WOPI-ServerError', 'The WOPI host could not complete the request');
      response.status(status).json(body);
      return;
    }

    response.setHeader('X-WOPI-ServerError', 'The WOPI host could not complete the request');
    response.status(500).json({ statusCode: 500, message: 'WOPI request failed' });
  }
}
