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
          endpoint: (() => {
            const endpoint = config.getOrThrow<string>('minio.endpoint');
            if (/^https?:\/\//i.test(endpoint)) return endpoint;
            const protocol = config.get<boolean>('minio.useSSL') ? 'https' : 'http';
            const port = /:\d+$/.test(endpoint) ? '' : `:${config.get<number>('minio.port', 9000)}`;
            return `${protocol}://${endpoint.replace(/\/+$/, '')}${port}`;
          })(),
          region: config.get<string>('minio.region', 'us-east-1'),
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.getOrThrow<string>('minio.accessKey'),
            secretAccessKey: config.getOrThrow<string>('minio.secretKey'),
          },
        }),
    },
    MinioService,
  ],
  exports: [MinioService],
})
export class StorageModule {}