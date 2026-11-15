import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from './database/module';
import { DiscoveryModule } from './discovery/discovery.module';
import { LaunchModule } from './launch/launch.module';
import { LocksModule } from './locks/locks.module';
import { PresignModule } from './presign/presign.module';
import { StorageModule } from './storage/storage.module';
import { TokensModule } from './tokens/tokens.module';
import { WopiModule } from './wopi/wopi.module';
import { configuration } from './config/configuration';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema
    }),
    DatabaseModule,
    StorageModule,
    TokensModule,
    LocksModule,
    DiscoveryModule,
    PresignModule,
    LaunchModule,
    WopiModule,
  ],
})
export class AppModule { }