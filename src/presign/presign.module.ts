import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TokensModule } from '../tokens/tokens.module';
import { InternalAuthGuard } from '../common/guards/internal-auth.guard';
import { PresignController } from './presign.controller';
import { PresignService } from './presign.service';

@Module({
  imports: [StorageModule, TokensModule],
  controllers: [PresignController],
  providers: [PresignService, InternalAuthGuard],
})
export class PresignModule {}