import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from '../common/guards/internal-auth.guard';
import { TokensService } from '../tokens/tokens.service';
import { SessionRevocationDto } from './session-revocation.dto';

@Controller('internal/sessions')
@UseGuards(InternalAuthGuard)
export class SessionRevocationController {
  constructor(private readonly tokensService: TokensService) {}

  @Post('revoke')
  async revoke(@Body() dto: SessionRevocationDto) {
    const revokedCount = await this.tokensService.revokeSessions(
      dto.bucket,
      dto.key,
      dto.userId,
    );

    return { revokedCount };
  }
}
