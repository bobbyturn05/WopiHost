import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TokensModule } from '../tokens/tokens.module';
import { InternalAuthGuard } from '../common/guards/internal-auth.guard';
import { PresignController } from './presign.controller';
import { PresignService } from './presign.service';
import { SessionRevocationController } from './session-revocation.controller';

@Module({
  imports: [StorageModule, TokensModule],
  controllers: [PresignController, SessionRevocationController],
  providers: [PresignService, InternalAuthGuard],
})
export class PresignModule {}