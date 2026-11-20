import { randomUUID } from 'crypto';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WopiOperationLease } from './schemas/operation-lease.schema';
import { WOPI_OPERATION_LEASE_TTL_MS } from './consts';

type AssertLease = () => Promise<void>;
type DocumentOperation<T> = (assertLease: AssertLease, signal: AbortSignal) => Promise<T>;

@Injectable()
export class OperationLeaseService {
  constructor(
    @InjectModel(WopiOperationLease.name)
    private readonly leaseModel: Model<WopiOperationLease>,
    @Inject(WOPI_OPERATION_LEASE_TTL_MS)
    private readonly leaseTtlMs: number,
  ) {}

  async run<T>(fileId: string, operation: DocumentOperation<T>): Promise<T> {
    const ownerToken = randomUUID();
    await this.acquire(fileId, ownerToken);

    let heartbeatRunning = false;
    let heartbeatError: unknown;
    const abortController = new AbortController();
    const heartbeat = setInterval(async () => {
      if (heartbeatRunning || heartbeatError) return;
      heartbeatRunning = true;
      try {
        const result = await this.leaseModel.updateOne(
          { fileId, ownerToken, expiresAt: { $gt: new Date() } },
          { $set: { expiresAt: this.expiration() } },
        );
        if (result.matchedCount !== 1) {
          heartbeatError = new Error('Document operation lease was lost');
          abortController.abort(heartbeatError);
        }
      } catch (error) {
        heartbeatError = error;
        abortController.abort(error);
      } finally {
        heartbeatRunning = false;
      }
    }, Math.max(1000, Math.floor(this.leaseTtlMs / 3)));
    heartbeat.unref();

    const assertLease: AssertLease = async () => {
      if (heartbeatError || abortController.signal.aborted) {
        throw new ServiceUnavailableException('Document operation lease could not be renewed');
      }

      try {
        const result = await this.leaseModel.updateOne(
          { fileId, ownerToken, expiresAt: { $gt: new Date() } },
          { $set: { expiresAt: this.expiration() } },
        );
        if (result.matchedCount !== 1) {
          const error = new Error('Document operation lease was lost');
          heartbeatError = error;
          abortController.abort(error);
          throw new ServiceUnavailableException('Document is busy; retry the WOPI request');
        }
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        heartbeatError = error;
        abortController.abort(error);
        throw new ServiceUnavailableException('Document operation lease could not be renewed');
      }
    };

    try {
      await assertLease();
      return await operation(assertLease, abortController.signal);
    } finally {
      clearInterval(heartbeat);
      await this.leaseModel.deleteOne({ fileId, ownerToken }).catch(() => undefined);
    }
  }

  private async acquire(fileId: string, ownerToken: string): Promise<void> {
    const now = new Date();
    try {
      const lease = await this.leaseModel.findOneAndUpdate(
        {
          fileId,
          $or: [
            { expiresAt: { $lte: now } },
            { ownerToken },
          ],
        },
        {
          $set: {
            fileId,
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
