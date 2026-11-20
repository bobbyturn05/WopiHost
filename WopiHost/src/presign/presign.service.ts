import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinioService } from '../storage/minio.service';
import { TokensService } from '../tokens/tokens.service';
import { PresignRequestDto } from './dto/presign-request.dto';
import { FileIdentitiesService } from '../file-identities/file-identities.service';

@Injectable()
export class PresignService {
  private readonly logger = new Logger(PresignService.name);

  constructor(
    private readonly minioService: MinioService,
    private readonly tokensService: TokensService,
    private readonly identities: FileIdentitiesService,
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

    await this.minioService.checkBucket(dto.bucket);
    const metadata = await this.minioService.statObject(dto.bucket, dto.key);
    const maxFileSize = this.config.getOrThrow<number>('wopi.maxFileSizeBytes');

    if (metadata.size > maxFileSize) {
      throw new PayloadTooLargeException(
        `Document exceeds the configured WOPI file-size limit (${maxFileSize} bytes)`,
      );
    }

    const identity = await this.identities.getOrCreate(dto.bucket, dto.key);
    const expiresAt = new Date(
      Date.now() + this.config.getOrThrow<number>('tokens.launchTtlSeconds') * 1000,
    );
    const token = await this.tokensService.create({
      kind: 'launch',
      fileId: identity.fileId,
      userId: dto.userId,
      mode: dto.mode,
      expiresAt,
    });

    const origin = this.config.getOrThrow<string>('app.publicWopiOrigin').replace(/\/+$/, '');
    this.logger.log(JSON.stringify({ event: 'wopi.launch.issued', fileId: identity.fileId, userId: dto.userId, mode: dto.mode }));
    return { launchUrl: `${origin}/launch/${token}`, expiresAt };
  }
}
