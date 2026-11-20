import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TokensModule } from '../tokens/tokens.module';
import { InternalAuthGuard } from '../common/guards/internal-auth.guard';
import { PresignController } from './presign.controller';
import { PresignService } from './presign.service';
import { SessionRevocationController } from './session-revocation.controller';
import { FileIdentitiesModule } from '../file-identities/file-identities.module';
import { FileIdentityController } from '../file-identities/file-identity.controller';
import { LocksModule } from '../locks/locks.module';

@Module({
  imports: [StorageModule, TokensModule, FileIdentitiesModule, LocksModule],
  controllers: [PresignController, SessionRevocationController, FileIdentityController],
  providers: [PresignService, InternalAuthGuard],
})
export class PresignModule {}