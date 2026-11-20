import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { StorageModule } from '../storage/storage.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, DiscoveryModule, StorageModule],
  controllers: [HealthController],
})
export class HealthModule {}
