import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from './database/module';
import { LaunchModule } from './launch/launch.module';
import { PresignModule } from './presign/presign.module';
import { WopiModule } from './wopi/wopi.module';
import { configuration } from './config/configuration';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    DatabaseModule,
    PresignModule,
    LaunchModule,
    WopiModule,
  ],
})
export class AppModule {}