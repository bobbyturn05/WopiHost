import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { DiscoveryService } from './discovery.service';

@Module({
  imports: [HttpModule],
  providers: [DiscoveryService],
  exports: [DiscoveryService]
})
export class DiscoveryModule {}