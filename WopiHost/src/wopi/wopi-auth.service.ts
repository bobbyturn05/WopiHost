import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ProofKeyService } from '../common/crypto/proof-key.service';
import { TokensService } from '../tokens/tokens.service';

@Injectable()
export class WopiAuthService {
  constructor(
    private readonly tokensService: TokensService,
    private readonly proofKeyService: ProofKeyService,
  ) {}

  async authorize(request: Request, fileId: string) {
    const token = request.query.access_token;

    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Missing WOPI access token');
    }

    const access = await this.tokensService.findAccessToken(token, fileId);
    this.proofKeyService.verifyRequest(request, token);

    return access;
  }
}
