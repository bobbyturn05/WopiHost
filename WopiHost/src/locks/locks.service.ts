import { BadRequestException, ConflictException, Injectable, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WopiLock } from './schemas/lock.schema';
import { WOPI_LOCK_TTL_MS } from './consts';
import { OperationLeaseService } from './operation-lease.service';
import { FileIdentitiesService } from '../file-identities/file-identities.service';

@Injectable()
export class LocksService {
  constructor(
    @InjectModel(WopiLock.name) private readonly lockModel: Model<WopiLock>,
    @Inject(WOPI_LOCK_TTL_MS) private readonly lockTtlMs: number,
    private readonly operationLease: OperationLeaseService,
    private readonly identities: FileIdentitiesService,
  ) {}

  withDocumentOperation<T>(fileId: string, operation: (assertLease: () => Promise<void>, signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.operationLease.run(fileId, operation);
  }

  async lock(fileId: string, bucket: string, key: string, lockId: string, lockTtlMs = this.lockTtlMs): Promise<void> {
    this.assertLockId(lockId);
    await this.withDocumentOperation(fileId, async (assertLease) => {
      await this.assertIdentityLocation(fileId, bucket, key);
      const now = new Date();
      const existing = await this.lockModel.findOne({ fileId, expiresAt: { $gt: now } }).lean();
      if (existing && existing.lockId !== lockId) throw this.lockConflict('Document is locked', existing.lockId);
      await assertLease();
      await this.lockModel.updateOne(
        { fileId },
        { $set: { fileId, lockId, expiresAt: new Date(Date.now() + lockTtlMs) } },
        { upsert: true },
      );
      await assertLease();
    });
  }

  async refresh(fileId: string, bucket: string, key: string, lockId: string, lockTtlMs = this.lockTtlMs): Promise<void> {
    this.assertLockId(lockId);
    await this.withDocumentOperation(fileId, async (assertLease) => {
      await this.assertIdentityLocation(fileId, bucket, key);
      await assertLease();
      const now = new Date();
      const result = await this.lockModel.updateOne(
        { fileId, lockId, expiresAt: { $gt: now } },
        { $set: { expiresAt: new Date(Date.now() + lockTtlMs) } },
      );
      if (result.matchedCount === 0) throw this.lockConflict('Lock does not match', await this.getLock(fileId));
      await assertLease();
    });
  }

  async unlock(fileId: string, bucket: string, key: string, lockId: string): Promise<void> {
    this.assertLockId(lockId);
    await this.withDocumentOperation(fileId, async (assertLease) => {
      await this.assertIdentityLocation(fileId, bucket, key);
      await assertLease();
      const result = await this.lockModel.deleteOne({ fileId, lockId, expiresAt: { $gt: new Date() } });
      if (result.deletedCount === 0) throw this.lockConflict('Lock does not match', await this.getLock(fileId));
      await assertLease();
    });
  }

  async replaceLock(fileId: string, bucket: string, key: string, oldLockId: string, newLockId: string, lockTtlMs = this.lockTtlMs): Promise<void> {
    this.assertLockId(oldLockId);
    this.assertLockId(newLockId);
    await this.withDocumentOperation(fileId, async (assertLease) => {
      await this.assertIdentityLocation(fileId, bucket, key);
      await assertLease();
      const now = new Date();
      const result = await this.lockModel.updateOne(
        { fileId, lockId: oldLockId, expiresAt: { $gt: now } },
        { $set: { lockId: newLockId, expiresAt: new Date(Date.now() + lockTtlMs) } },
      );
      if (result.matchedCount === 0) throw this.lockConflict('Old lock does not match', await this.getLock(fileId));
      await assertLease();
    });
  }

  async assertPutFileLock(fileId: string, bucket: string, key: string, lockId: string | undefined, currentSize: number): Promise<void> {
    await this.assertIdentityLocation(fileId, bucket, key);
    if (lockId) this.assertLockId(lockId);

    const now = new Date();
    const current = await this.lockModel.findOne({ fileId, expiresAt: { $gt: now } }).lean();
    if (current) {
      if (lockId !== current.lockId) throw this.lockConflict('Lock does not match', current.lockId);
      return;
    }

    if (currentSize !== 0 || lockId !== undefined) {
      throw this.lockConflict('File is not locked', null);
    }
  }

  async getLock(fileId: string, bucket?: string, key?: string): Promise<string | null> {
    if (bucket !== undefined && key !== undefined) await this.assertIdentityLocation(fileId, bucket, key);
    const lock = await this.lockModel.findOne({ fileId, expiresAt: { $gt: new Date() } }).lean();
    return lock?.lockId ?? null;
  }

  private async assertIdentityLocation(fileId: string, bucket: string, key: string): Promise<void> {
    const identity = await this.identities.findByFileId(fileId);
    if (identity.bucket !== bucket || identity.key !== key) {
      throw new ConflictException('The document location changed; reopen the WOPI session');
    }
  }

  private assertLockId(lockId: string): void {
    if (!lockId || lockId.length > 1024 || !/^[\x20-\x7E]+$/.test(lockId)) {
      throw new BadRequestException('WOPI lock identifier must be non-empty ASCII and at most 1024 characters');
    }
  }

  private lockConflict(message: string, currentLock: string | null): ConflictException {
    return new ConflictException({ message, currentLock: currentLock ?? '' });
  }
}
