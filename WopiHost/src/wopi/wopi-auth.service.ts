import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createWopiFileId } from '../common/crypto/file-id.util';
import { ProofKeyService } from '../common/crypto/proof-key.service';
import { TokensService } from '../tokens/tokens.service';

@Injectable()
export class WopiAuthService {
  constructor(
    private readonly tokensService: TokensService,
    private readonly proofKeyService: ProofKeyService,
    private readonly config: ConfigService,
  ) {}

  async authorize(request: Request, fileId: string) {
    if (!/^[a-f0-9]{64}$/.test(fileId)) {
      throw new UnauthorizedException('Invalid WOPI file ID');
    }

    const token = request.query.access_token;

    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Missing WOPI access token');
    }

    const access = await this.tokensService.findAccessToken(token);
    const expectedFileId = createWopiFileId(
      access.bucket,
      access.key,
      this.config.getOrThrow<string>('wopi.fileIdSecret'),
    );

    if (expectedFileId !== fileId) {
      throw new UnauthorizedException('Invalid WOPI file ID');
    }

    this.proofKeyService.verifyRequest(request, token);
    return access;
  }
}
