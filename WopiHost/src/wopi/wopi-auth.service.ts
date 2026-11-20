import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { FileIdentitiesService } from '../file-identities/file-identities.service';
import { ProofKeyService } from '../common/crypto/proof-key.service';
import { TokensService } from '../tokens/tokens.service';
import { WopiAccessContext } from './interfaces/wopi-access-context.interface';

@Injectable()
export class WopiAuthService {
  constructor(
    private readonly tokensService: TokensService,
    private readonly proofKeyService: ProofKeyService,
    private readonly identities: FileIdentitiesService,
  ) {}

  async authorize(request: Request, fileId: string): Promise<WopiAccessContext> {
    if (!/^[a-f0-9]{64}$/.test(fileId)) {
      throw new UnauthorizedException('Invalid WOPI file ID');
    }

    const token = request.query.access_token;

    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Missing WOPI access token');
    }

    const access = await this.tokensService.findAccessToken(token);
    if (access.fileId !== fileId) {
      throw new UnauthorizedException('Invalid WOPI file ID');
    }

    const identity = await this.identities.findByFileId(fileId);
    this.proofKeyService.verifyRequest(request, token);
    return {
      fileId: access.fileId,
      userId: access.userId,
      mode: access.mode,
      bucket: identity.bucket,
      key: identity.key,
    };
  }
}
