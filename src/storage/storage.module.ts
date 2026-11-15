import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { S3_CLIENT } from './consts';
import { MinioService } from './minio.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new S3Client({
          endpoint: config.getOrThrow<string>('MINIO_ENDPOINT'),
          region: config.get<string>('MINIO_REGION', 'us-east-1'),
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
            secretAccessKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
          },
        }),
    },
    MinioService,
  ],
  exports: [MinioService],
})
export class StorageModule {}