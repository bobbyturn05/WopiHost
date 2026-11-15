import { BadRequestException, ConflictException, Injectable, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WopiLock } from './schemas/lock.schema';
import { WOPI_LOCK_TTL_MS } from './consts';
import { OperationLeaseService } from './operation-lease.service';

@Injectable()
export class LocksService {
  constructor(
    @InjectModel(WopiLock.name) private readonly lockModel: Model<WopiLock>,
    @Inject(WOPI_LOCK_TTL_MS) private readonly lockTtlMs: number,
    private readonly operationLease: OperationLeaseService,
  ) {}

  withDocumentOperation<T>(bucket: string, key: string, operation: (assertLease: () => Promise<void>) => Promise<T>): Promise<T> {
    return this.operationLease.run(bucket, key, operation);
  }

  async lock(bucket: string, key: string, lockId: string): Promise<void> {
    this.assertLockId(lockId);
    await this.withDocumentOperation(bucket, key, async (assertLease) => {
      const now = new Date();
      const existing = await this.lockModel.findOne({ bucket, key, expiresAt: { $gt: now } }).lean();
      if (existing && existing.lockId !== lockId) throw this.lockConflict('Document is locked', existing.lockId);
      await assertLease();
      await this.lockModel.updateOne(
        { bucket, key },
        { $set: { bucket, key, lockId, expiresAt: new Date(Date.now() + this.lockTtlMs) } },
        { upsert: true },
      );
    });
  }

  async refresh(bucket: string, key: string, lockId: string): Promise<void> {
    this.assertLockId(lockId);
    await this.withDocumentOperation(bucket, key, async (assertLease) => {
      await assertLease();
      const now = new Date();
      const result = await this.lockModel.updateOne(
        { bucket, key, lockId, expiresAt: { $gt: now } },
        { $set: { expiresAt: new Date(Date.now() + this.lockTtlMs) } },
      );
      if (result.matchedCount === 0) throw this.lockConflict('Lock does not match', await this.getLock(bucket, key));
    });
  }

  async unlock(bucket: string, key: string, lockId: string): Promise<void> {
    this.assertLockId(lockId);
    await this.withDocumentOperation(bucket, key, async (assertLease) => {
      await assertLease();
      const result = await this.lockModel.deleteOne({ bucket, key, lockId, expiresAt: { $gt: new Date() } });
      if (result.deletedCount === 0) throw this.lockConflict('Lock does not match', await this.getLock(bucket, key));
    });
  }

  async replaceLock(bucket: string, key: string, oldLockId: string, newLockId: string): Promise<void> {
    this.assertLockId(oldLockId);
    this.assertLockId(newLockId);
    await this.withDocumentOperation(bucket, key, async (assertLease) => {
      await assertLease();
      const now = new Date();
      const result = await this.lockModel.updateOne(
        { bucket, key, lockId: oldLockId, expiresAt: { $gt: now } },
        { $set: { lockId: newLockId, expiresAt: new Date(Date.now() + this.lockTtlMs) } },
      );
      if (result.matchedCount === 0) throw this.lockConflict('Old lock does not match', await this.getLock(bucket, key));
    });
  }

  async assertPutFileLock(bucket: string, key: string, lockId: string | undefined, currentSize: number): Promise<void> {
    if (lockId) this.assertLockId(lockId);

    const now = new Date();
    const current = await this.lockModel.findOne({ bucket, key, expiresAt: { $gt: now } }).lean();
    if (current) {
      if (lockId !== current.lockId) throw this.lockConflict('Lock does not match', current.lockId);
      const refreshed = await this.lockModel.updateOne(
        { bucket, key, lockId: current.lockId, expiresAt: { $gt: new Date() } },
        { $set: { expiresAt: new Date(Date.now() + this.lockTtlMs) } },
      );
      if (refreshed.matchedCount !== 1) throw this.lockConflict('Lock does not match', await this.getLock(bucket, key));
      return;
    }

    if (currentSize !== 0) throw this.lockConflict('File is not locked', null);
  }

  async getLock(bucket: string, key: string): Promise<string | null> {
    const lock = await this.lockModel.findOne({ bucket, key, expiresAt: { $gt: new Date() } }).lean();
    return lock?.lockId ?? null;
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
