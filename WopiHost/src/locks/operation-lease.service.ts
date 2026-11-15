import { randomUUID } from 'crypto';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WopiOperationLease } from './schemas/operation-lease.schema';
import { WOPI_OPERATION_LEASE_TTL_MS } from './consts';

type AssertLease = () => Promise<void>;
type DocumentOperation<T> = (assertLease: AssertLease) => Promise<T>;

@Injectable()
export class OperationLeaseService {
  constructor(
    @InjectModel(WopiOperationLease.name)
    private readonly leaseModel: Model<WopiOperationLease>,
    @Inject(WOPI_OPERATION_LEASE_TTL_MS)
    private readonly leaseTtlMs: number,
  ) {}

  async run<T>(bucket: string, key: string, operation: DocumentOperation<T>): Promise<T> {
    const ownerToken = randomUUID();
    await this.acquire(bucket, key, ownerToken);

    let heartbeatRunning = false;
    let heartbeatError: unknown;
    const heartbeat = setInterval(async () => {
      if (heartbeatRunning || heartbeatError) return;
      heartbeatRunning = true;
      try {
        const result = await this.leaseModel.updateOne(
          { bucket, key, ownerToken, expiresAt: { $gt: new Date() } },
          { $set: { expiresAt: this.expiration() } },
        );
        if (result.matchedCount !== 1) heartbeatError = new Error('Document operation lease was lost');
      } catch (error) {
        heartbeatError = error;
      } finally {
        heartbeatRunning = false;
      }
    }, Math.max(1000, Math.floor(this.leaseTtlMs / 3)));
    heartbeat.unref();

    const assertLease: AssertLease = async () => {
      if (heartbeatError) {
        throw new ServiceUnavailableException('Document operation lease could not be renewed');
      }

      const result = await this.leaseModel.updateOne(
        { bucket, key, ownerToken, expiresAt: { $gt: new Date() } },
        { $set: { expiresAt: this.expiration() } },
      );
      if (result.matchedCount !== 1) {
        throw new ServiceUnavailableException('Document is busy; retry the WOPI request');
      }
    };

    try {
      await assertLease();
      return await operation(assertLease);
    } finally {
      clearInterval(heartbeat);
      await this.leaseModel.deleteOne({ bucket, key, ownerToken }).catch(() => undefined);
    }
  }

  private async acquire(bucket: string, key: string, ownerToken: string): Promise<void> {
    const now = new Date();
    try {
      const lease = await this.leaseModel.findOneAndUpdate(
        {
          bucket,
          key,
          $or: [
            { expiresAt: { $lte: now } },
            { ownerToken },
          ],
        },
        {
          $set: {
            bucket,
            key,
            ownerToken,
            expiresAt: this.expiration(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      if (!lease || lease.ownerToken !== ownerToken) {
        throw new ServiceUnavailableException('Document is busy; retry the WOPI request');
      }
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ServiceUnavailableException('Document is busy; retry the WOPI request');
      }
      throw error;
    }
  }

  private expiration(): Date {
    return new Date(Date.now() + this.leaseTtlMs);
  }
}
