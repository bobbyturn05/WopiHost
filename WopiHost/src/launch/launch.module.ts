import { Module } from '@nestjs/common';
import { DiscoveryModule } from '../discovery/discovery.module';
import { StorageModule } from '../storage/storage.module';
import { TokensModule } from '../tokens/tokens.module';
import { LaunchController } from './launch.controller';
import { LaunchService } from './launch.service';

@Module({
  imports: [TokensModule, DiscoveryModule, StorageModule],
  controllers: [LaunchController],
  providers: [LaunchService],
})
export class LaunchModule {}
