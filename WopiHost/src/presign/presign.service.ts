import { BadRequestException, ForbiddenException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { MinioService } from '../storage/minio.service';
import { TokensService } from '../tokens/tokens.service';
import { PresignRequestDto } from './dto/presign-request.dto';

@Injectable()
export class PresignService {
  constructor(
    private readonly minioService: MinioService,
    private readonly tokensService: TokensService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: PresignRequestDto) {
    const allowedBuckets = this.config.getOrThrow<string[]>('minio.allowedBuckets');
    if (!allowedBuckets.includes(dto.bucket)) {
      throw new ForbiddenException('The requested bucket is not enabled for WOPI access');
    }

    if (Buffer.byteLength(dto.key, 'utf8') > 1024) {
      throw new BadRequestException('The requested object key exceeds the S3 key-length limit');
    }

    const metadata = await this.minioService.statObject(dto.bucket, dto.key);
    const maxFileSize = this.config.getOrThrow<number>('wopi.maxFileSizeBytes');

    if (metadata.size > maxFileSize) {
      throw new PayloadTooLargeException(`Document exceeds the configured WOPI file-size limit (${maxFileSize} bytes)`);
    }

    const fileId = createHmac('sha256', this.config.getOrThrow<string>('wopi.fileIdSecret'))
      .update(dto.bucket, 'utf8')
      .update('\0', 'utf8')
      .update(dto.key, 'utf8')
      .digest('hex');
    const expiresAt = new Date(
      Date.now() + this.config.getOrThrow<number>('tokens.launchTtlSeconds') * 1000,
    );
    const token = await this.tokensService.create({
      kind: 'launch',
      bucket: dto.bucket,
      key: dto.key,
      userId: dto.userId,
      mode: dto.mode,
      fileId,
      filename: metadata.filename,
      contentType: metadata.contentType,
      size: metadata.size,
      etag: metadata.etag,
      lastModified: metadata.lastModified,
      expiresAt,
    });

    const origin = this.config.getOrThrow<string>('app.publicWopiOrigin').replace(/\/+$/, '');
    return { launchUrl: `${origin}/launch/${token}`, expiresAt };
  }
}
