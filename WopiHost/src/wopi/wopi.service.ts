import { createHash, randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException, PreconditionFailedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TokenDocument } from '../tokens/schemas/token.schema';
import { LocksService } from '../locks/locks.service';
import { MinioService } from '../storage/minio.service';
import type { MinioObjectMetadata } from '../storage/minio.service';
import type { CheckFileInfo } from './interfaces/check-file-info.interface';

@Injectable()
export class WopiService {
  constructor(
    private readonly minioService: MinioService,
    private readonly locksService: LocksService,
    private readonly config: ConfigService,
  ) {}

  async checkFileInfo(access: TokenDocument): Promise<CheckFileInfo> {
    const metadata = await this.minioService.statObject(access.bucket, access.key);
    this.assertFileSize(metadata.size);

    return {
      BaseFileName: metadata.filename,
      OwnerId: this.toWopiIdentity(metadata.ownerId || `${access.bucket}/${access.key}`),
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

  async getFile(access: TokenDocument, maxExpectedSize: number) {
    const metadata = await this.minioService.statObject(access.bucket, access.key);
    this.assertFileSize(metadata.size);
    if (metadata.size > maxExpectedSize) {
      throw new PreconditionFailedException('Document exceeds X-WOPI-MaxExpectedSize');
    }
    const versionId = metadata.versionId && metadata.versionId !== 'null' ? metadata.versionId : undefined;
    const stream = await this.minioService.getObject(access.bucket, access.key, versionId, metadata.etag);
    return { stream, size: metadata.size, version: this.getVersion(metadata) };
  }

  async putFile(access: TokenDocument, content: Buffer, lockId?: string) {
    this.assertCanWrite(access);
    return this.locksService.withDocumentOperation(access.bucket, access.key, async (assertLease, operationSignal) => {
      const currentMetadata = await this.minioService.statObject(access.bucket, access.key);
      await assertLease();
      await this.locksService.assertPutFileLock(access.bucket, access.key, lockId, currentMetadata.size);
      await assertLease();

      const revision = randomUUID();
      const objectMetadata = {
        ...currentMetadata.metadata,
        'wopi-revision': revision,
      };
      const versionId = currentMetadata.versionId && currentMetadata.versionId !== 'null'
        ? currentMetadata.versionId
        : undefined;
      const tags = await this.minioService.getObjectTags(access.bucket, access.key, versionId);
      await assertLease();
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

      return { Version: result.versionId && result.versionId !== 'null' ? result.versionId : revision };
    });
  }

  async lock(access: TokenDocument, lockId: string, lockExpirationTimeoutSeconds?: number): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.lock(access.bucket, access.key, lockId, this.getLockTtlMs(lockExpirationTimeoutSeconds));
  }

  async refreshLock(access: TokenDocument, lockId: string, lockExpirationTimeoutSeconds?: number): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.refresh(access.bucket, access.key, lockId, this.getLockTtlMs(lockExpirationTimeoutSeconds));
  }

  async unlock(access: TokenDocument, lockId: string): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.unlock(access.bucket, access.key, lockId);
  }

  async getLock(access: TokenDocument): Promise<string | null> {
    await this.assertDocumentExists(access);
    return this.locksService.getLock(access.bucket, access.key);
  }

  async unlockAndRelock(access: TokenDocument, oldLockId: string, newLockId: string, lockExpirationTimeoutSeconds?: number): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.replaceLock(access.bucket, access.key, oldLockId, newLockId, this.getLockTtlMs(lockExpirationTimeoutSeconds));
  }

  private async assertDocumentExists(access: TokenDocument): Promise<void> {
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

  private assertCanWrite(access: TokenDocument): void {
    if (access.mode !== 'edit') {
      throw new NotFoundException('Document not found');
    }
  }
}
