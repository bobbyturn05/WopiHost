import { createHash, randomUUID } from 'crypto';
import { Injectable, NotFoundException, PreconditionFailedException } from '@nestjs/common';
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
  ) {}

  async checkFileInfo(access: TokenDocument): Promise<CheckFileInfo> {
    const metadata = await this.minioService.statObject(access.bucket, access.key);

    return {
      BaseFileName: metadata.filename,
      OwnerId: this.toWopiIdentity(metadata.ownerId || `${access.bucket}/${access.key}`),
      Size: metadata.size,
      Version: this.getVersion(metadata),
      UserId: this.toWopiIdentity(access.userId),
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
    if (metadata.size > maxExpectedSize) {
      throw new PreconditionFailedException('Document exceeds X-WOPI-MaxExpectedSize');
    }
    const versionId = metadata.versionId && metadata.versionId !== 'null' ? metadata.versionId : undefined;
    const stream = await this.minioService.getObject(access.bucket, access.key, versionId, metadata.etag);
    return { stream, size: metadata.size, version: this.getVersion(metadata) };
  }

  async putFile(access: TokenDocument, content: Buffer, lockId?: string) {
    this.assertCanWrite(access);
    return this.locksService.withDocumentOperation(access.bucket, access.key, async (assertLease) => {
      const currentMetadata = await this.minioService.statObject(access.bucket, access.key);
      await assertLease();
      await this.locksService.assertPutFileLock(access.bucket, access.key, lockId, currentMetadata.size);
      await assertLease();

      const revision = randomUUID();
      const objectMetadata = {
        ...currentMetadata.metadata,
        'wopi-revision': revision,
      };
      const result = await this.minioService.putObject(
        access.bucket,
        access.key,
        content,
        currentMetadata.contentType,
        objectMetadata,
      );

      return { Version: result.versionId && result.versionId !== 'null' ? result.versionId : revision };
    });
  }

  async lock(access: TokenDocument, lockId: string): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.lock(access.bucket, access.key, lockId);
  }

  async refreshLock(access: TokenDocument, lockId: string): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.refresh(access.bucket, access.key, lockId);
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

  async unlockAndRelock(access: TokenDocument, oldLockId: string, newLockId: string): Promise<void> {
    this.assertCanWrite(access);
    await this.assertDocumentExists(access);
    await this.locksService.replaceLock(access.bucket, access.key, oldLockId, newLockId);
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

  private assertCanWrite(access: TokenDocument): void {
    if (access.mode !== 'edit') {
      throw new NotFoundException('Document not found');
    }
  }
}
