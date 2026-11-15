import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const supplied = request.headers['x-internal-service-token'];
    const expected = this.config.getOrThrow<string>('security.internalServiceToken');

    if (typeof supplied !== 'string') throw new UnauthorizedException();

    const suppliedBuffer = Buffer.from(supplied, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
