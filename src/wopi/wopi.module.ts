import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TokensModule } from '../tokens/tokens.module';
import { LocksModule } from '../locks/locks.module';
import { WopiController } from './wopi.controller';
import { WopiService } from './wopi.service';
import { WopiAuthService } from './wopi-auth.service';

@Module({
  imports: [StorageModule, TokensModule, LocksModule],
  controllers: [WopiController],
  providers: [WopiService, WopiAuthService],
})
export class WopiModule {}