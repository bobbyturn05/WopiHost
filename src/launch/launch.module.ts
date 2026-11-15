import { Module } from '@nestjs/common';
import { TokensModule } from '../tokens/tokens.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { LaunchController } from './launch.controller';
import { LaunchService } from './launch.service';

@Module({
  imports: [TokensModule, DiscoveryModule],
  controllers: [LaunchController],
  providers: [LaunchService],
})
export class LaunchModule {}