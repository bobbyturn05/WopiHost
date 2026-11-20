import { Body, BadRequestException, ConflictException, Controller, ForbiddenException, Logger, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalAuthGuard } from '../common/guards/internal-auth.guard';
import { FileIdentityMoveDto } from './file-identity-move.dto';
import { FileIdentitiesService } from './file-identities.service';
import { LocksService } from '../locks/locks.service';
import { TokensService } from '../tokens/tokens.service';
import { FileIdentityDeleteDto } from './file-identity-delete.dto';
import { WopiFileIdentity } from './schemas/file-identity.schema';

@Controller('internal/file-identities')
@UseGuards(InternalAuthGuard)
export class FileIdentityController {
  private readonly logger = new Logger(FileIdentityController.name);

  constructor(
    private readonly identities: FileIdentitiesService,
    private readonly locks: LocksService,
    private readonly tokens: TokensService,
    private readonly config: ConfigService,
  ) {}

  @Post('delete')
  async delete(@Body() dto: FileIdentityDeleteDto) {
    if (Buffer.byteLength(dto.key, 'utf8') > 1024) {
      throw new BadRequestException('S3 object key exceeds the supported length');
    }
    const allowedBuckets = this.config.getOrThrow<string[]>('minio.allowedBuckets');
    if (!allowedBuckets.includes(dto.bucket)) {
      throw new ForbiddenException('The requested bucket is not enabled for WOPI access');
    }

    let identity: WopiFileIdentity;
    try {
      identity = await this.identities.findByLocation(dto.bucket, dto.key);
    } catch (error) {
      if (error instanceof NotFoundException) return { deleted: true };
      throw error;
    }

    await this.locks.withDocumentOperation(identity.fileId, async (assertLease) => {
      await assertLease();
      const current = await this.identities.findByFileId(identity.fileId);
      if (current.bucket !== dto.bucket || current.key !== dto.key) {
        throw new ConflictException('The document location changed before deletion');
      }
      if (await this.locks.getLock(identity.fileId)) {
        throw new ConflictException('Cannot delete a document while a WOPI editing lock is active');
      }
      await this.tokens.revokeSessions(identity.fileId);
      await assertLease();
      await this.identities.deleteByFileId(identity.fileId);
      await assertLease();
    });

    this.logger.log(JSON.stringify({ event: 'wopi.file.identity_deleted', fileId: identity.fileId }));
    return { deleted: true };
  }

  @Post('move')
  async move(@Body() dto: FileIdentityMoveDto) {
    const allowedBuckets = this.config.getOrThrow<string[]>('minio.allowedBuckets');
    if (!allowedBuckets.includes(dto.sourceBucket) || !allowedBuckets.includes(dto.destinationBucket)) {
      throw new ForbiddenException('Both buckets must be enabled for WOPI access');
    }
    const identity = await this.identities.findByLocation(dto.sourceBucket, dto.sourceKey);
    const current = await this.identities.findByFileId(identity.fileId);
    if (current.bucket === dto.destinationBucket && current.key === dto.destinationKey &&
      current.previousLocations?.some((location) => location.bucket === dto.sourceBucket && location.key === dto.sourceKey)) {
      return { moved: true };
    }
    if (current.bucket !== dto.sourceBucket || current.key !== dto.sourceKey) {
      throw new ConflictException('The source location is no longer current');
    }
    await this.locks.withDocumentOperation(identity.fileId, async (assertLease) => {
      await assertLease();
      const latest = await this.identities.findByFileId(identity.fileId);
      if (latest.bucket !== dto.sourceBucket || latest.key !== dto.sourceKey) {
        if (latest.bucket === dto.destinationBucket && latest.key === dto.destinationKey) return;
        throw new ConflictException('The source location changed during the move');
      }
      if (await this.locks.getLock(identity.fileId)) {
        throw new ConflictException('Cannot move a document while a WOPI editing lock is active');
      }
      await this.identities.move(dto.sourceBucket, dto.sourceKey, dto.destinationBucket, dto.destinationKey, assertLease);
      await assertLease();
    });
    this.logger.log(JSON.stringify({ event: 'wopi.file.location_updated', fileId: identity.fileId }));
    return { moved: true };
  }
}
