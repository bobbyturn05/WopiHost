import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const supplied = request.headers['x-internal-service-token'];
    const expected = this.config.getOrThrow<string>(
      'INTERNAL_SERVICE_TOKEN',
    );

    if (
      typeof supplied !== 'string' ||
      supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      throw new UnauthorizedException();
    }

    return true;
  }
}