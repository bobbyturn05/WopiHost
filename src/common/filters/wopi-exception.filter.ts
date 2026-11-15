import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class WopiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ConflictException) {
      const body = exception.getResponse();

      if (
        typeof body === 'object' &&
        body !== null &&
        'currentLock' in body &&
        typeof body.currentLock === 'string'
      ) {
        response.setHeader('X-WOPI-Lock', body.currentLock);
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(exception.getResponse());
      return;
    }

    response.status(500).json({
      statusCode: 500,
      message: 'WOPI request failed'
    });
  }
}