import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
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
    const metadata = await this.minioService.statObject(
      dto.bucket,
      dto.key,
    );

    const fileId = randomUUID();
    const expiresAt = new Date(
      Date.now() +
        this.config.get<number>('LAUNCH_TOKEN_TTL_SECONDS', 120) * 1000,
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

    const origin = this.config.getOrThrow<string>('PUBLIC_WOPI_ORIGIN');

    return {
      launchUrl: `${origin}/launch/${token}`,
      expiresAt,
    };
  }
}