import { createHash, randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, PayloadTooLargeException, PreconditionFailedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WopiAccessContext } from './interfaces/wopi-access-context.interface';
import { LocksService } from '../locks/locks.service';
import { MinioService } from '../storage/minio.service';
import type { MinioObjectMetadata } from '../storage/minio.service';
import type { CheckFileInfo } from './interfaces/check-file-info.interface';

@Injectable()
export class WopiService {
  private readonly logger = new Logger(WopiService.name);

  constructor(
    private readonly minioService: MinioService,
    private readonly locksService: LocksService,
    private readonly config: ConfigService,
  ) {}

  async checkFileInfo(access: WopiAccessContext): Promise<CheckFileInfo> {
    const metadata = await this.minioService.statObject(access.bucket, access.key);
    this.assertFileSize(metadata.size);

    return {
      BaseFileName: metadata.filename,
      OwnerId: this.toWopiIdentity(metadata.ownerId || access.fileId),
      Size: metadata.size,
      Version: this.getVersion(metadata),
      UserId: access.userId,
      ...(metadata.lastModified ? { LastModifiedTime: metadata.lastModified.toISOString() } : {}),
      UserCanWrite: access.mode === 'edit',
      ReadOnly: access.mode !== 'edit',
      SupportsLocks: true,
      SupportsGetLock: true,
      SupportsExtendedLockLength: true,
      SupportsUpdate: true,
      UserCanNotWriteRelative: true,
    };
  }

  async getFile(access: WopiAccessContext, maxExpectedSize: number) {
    const metadata = await this.minioService.statObject(access.bucket, access.key);
    this.assertFileSize(metadata.size);
    if (metadata.size > maxExpectedSize) {
      throw new PreconditionFailedException('Document exceeds X-WOPI-MaxExpectedSize');
    }
    const versionId = metadata.versionId && metadata.versionId !== 'null' ? metadata.versionId : undefined;
    const stream = await this.minioService.getObject(access.bucket, access.key, versionId, metadata.etag);
    return { stream, size: metadata.size, version: this.getVersion(metadata) };
  }

  async putFile(access: WopiAccessContext, content: Buffer, lockId?: string) {
    this.assertCanWrite(access);
    return this.locksService.withDocumentOperation(access.fileId, async (assertLease, operationSignal) => {
      const currentMetadata = await this.minioService.statObject(access.bucket, access.key);
      await assertLease();
      await this.locksService.assertPutFileLock(access.fileId, access.bucket, access.key, lockId, currentMetadata.size);
      await assertLease();

      const contentHash = createHash('sha256').update(content).digest('hex');
      if (currentMetadata.metadata?.['wopi-content-sha256'] === contentHash) {
        const version = this.getVersion(currentMetadata);
        this.logger.log(JSON.stringify({ event: 'wopi.file.save_reconciled', fileId: access.fileId, userId: access.userId, version, size: content.length }));
        return { Version: version };
      }

      const revision = randomUUID();
      const objectMetadata = {
        ...currentMetadata.metadata,
        'wopi-revision': revision,
        'wopi-content-sha256': contentHash,
      };
      const versionId = currentMetadata.versionId && currentMetadata.versionId !== 'null'
        ? currentMetadata.versionId
        : undefined;
      const tags = await this.minioService.getObjectTags(access.bucket, access.key, versionId);
      await assertLease();
      try {
        const result = await this.minioService.putObject(
          access.bucket,
          access.key,
          content,
          currentMetadata.contentType,
          objectMetadata,
          currentMetadata.headers,
          tags,
          currentMetadata.etag,
          operationSignal,
        );
        await assertLease();
        const version = result.versionId && result.versionId !== 'null' ? result.versionId : revision;
        this.logger.log(JSON.stringify({ event: 'wopi.file.saved', fileId: access.fileId, userId: access.userId, version, size: content.length }));
        return { Version: version };
      } catch (error) {
        const committed = await this.findCommittedRevision(access.bucket, access.key, revision);
        if (committed) {
          this.logger.log(JSON.stringify({ event: 'wopi.file.save_reconciled', fileId: access.fileId, userId: access.userId, version: committed, size: content.length }));
          return { Version: committed };
        }
        if (error instanceof ConflictException) {
          const currentLock = await this.locksService.getLock(access.fileId);
          throw new ConflictException({ message: 'Document changed in storage before the save could be committed', currentLock: currentLock ?? '' });
        }
        throw error;
      }
    });
  }

  async lock(access: WopiAccessContext, lockId: string, lockExpirationTimeoutSeconds?: number): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.lock(access.fileId, access.bucket, access.key, lockId, this.getLockTtlMs(lockExpirationTimeoutSeconds));
  }

  async refreshLock(access: WopiAccessContext, lockId: string, lockExpirationTimeoutSeconds?: number): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.refresh(access.fileId, access.bucket, access.key, lockId, this.getLockTtlMs(lockExpirationTimeoutSeconds));
  }

  async unlock(access: WopiAccessContext, lockId: string): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.unlock(access.fileId, access.bucket, access.key, lockId);
  }

  async getLock(access: WopiAccessContext): Promise<string | null> {
    await this.assertDocumentExists(access);
    return this.locksService.getLock(access.fileId, access.bucket, access.key);
  }

  async unlockAndRelock(access: WopiAccessContext, oldLockId: string, newLockId: string, lockExpirationTimeoutSeconds?: number): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.replaceLock(access.fileId, access.bucket, access.key, oldLockId, newLockId, this.getLockTtlMs(lockExpirationTimeoutSeconds));
  }

  private async findCommittedRevision(bucket: string, key: string, revision: string): Promise<string | undefined> {
    try {
      const metadata = await this.minioService.statObject(bucket, key);
      if (metadata.metadata?.['wopi-revision'] !== revision) return undefined;
      return (metadata.versionId && metadata.versionId !== 'null' ? metadata.versionId : undefined) ?? revision;
    } catch {
      return undefined;
    }
  }

  private async assertDocumentExists(access: WopiAccessContext): Promise<void> {
    await this.minioService.statObject(access.bucket, access.key);
  }

  private toWopiIdentity(userId: string): string {
    return createHash('sha256').update(userId, 'utf8').digest('hex');
  }

  private getVersion(metadata: MinioObjectMetadata): string {
    return (metadata.versionId && metadata.versionId !== 'null' ? metadata.versionId : undefined)
      ?? metadata.metadata?.['wopi-revision']
      ?? metadata.etag
      ?? metadata.lastModified?.toISOString()
      ?? '0';
  }

  private getLockTtlMs(lockExpirationTimeoutSeconds?: number): number {
    const seconds = lockExpirationTimeoutSeconds ?? this.config.getOrThrow<number>('wopi.lockTtlSeconds');
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600) {
      throw new BadRequestException('X-WOPI-LockExpirationTimeout must be between 60 and 3600 seconds');
    }
    return seconds * 1000;
  }

  private assertFileSize(size: number): void {
    const maxFileSize = this.config.getOrThrow<number>('wopi.maxFileSizeBytes');
    if (size > maxFileSize) {
      throw new PayloadTooLargeException('Document exceeds the configured WOPI file-size limit');
    }
  }

  private assertCanWrite(access: WopiAccessContext): void {
    if (access.mode !== 'edit') {
      throw new NotFoundException('Document not found');
    }
  }
}
