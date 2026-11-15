import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TokensService } from '../tokens/tokens.service';

@Injectable()
export class WopiAuthService {
  constructor(
    private readonly tokensService: TokensService,
  ) {}

  async authorize(
    request: Request,
    fileId: string,
  ) {
    const token =
      request.query.access_token ??
      request.body?.access_token;

    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Missing WOPI access token');
    }

    const access = await this.tokensService.findAccessToken(
      token,
      fileId,
    );

    return access;
  }
}