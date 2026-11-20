import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from '../common/guards/internal-auth.guard';
import { TokensService } from '../tokens/tokens.service';
import { SessionRevocationDto } from './session-revocation.dto';
import { FileIdentitiesService } from '../file-identities/file-identities.service';

@Controller('internal/sessions')
@UseGuards(InternalAuthGuard)
export class SessionRevocationController {
  private readonly logger = new Logger(SessionRevocationController.name);

  constructor(
    private readonly tokensService: TokensService,
    private readonly identities: FileIdentitiesService,
  ) {}

  @Post('revoke')
  async revoke(@Body() dto: SessionRevocationDto) {
    if (Buffer.byteLength(dto.key, 'utf8') > 1024) {
      throw new BadRequestException('S3 object key exceeds the supported length');
    }
    const identity = await this.identities.findByLocation(dto.bucket, dto.key);
    const revokedCount = await this.tokensService.revokeSessions(identity.fileId, dto.userId);
    this.logger.log(JSON.stringify({ event: 'wopi.sessions.revoked', fileId: identity.fileId, userId: dto.userId ?? null, revokedCount }));
    return { revokedCount };
  }
}
