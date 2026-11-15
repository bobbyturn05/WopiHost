import {
  Injectable,
} from '@nestjs/common';

import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { WopiLock } from '../locks/schemas/lock.schema';

export interface LockResult {
  success: boolean;
  lock?: string;
}

@Injectable()
export class WopiLockService {
  private readonly durationMs = 30 * 60 * 1000;

  constructor(
    @InjectModel(WopiLock.name)
    private readonly locks: Model<WopiLock>,
  ) {}

  async get(documentId: string) {
    return this.locks.findOne({
      documentId,
      expiresAt: { $gt: new Date() },
    });
  }

  async acquire(
    documentId: string,
    lockId: string,
  ): Promise<LockResult> {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.durationMs,
    );

    const updated = await this.locks.findOneAndUpdate(
      {
        documentId,
        $or: [
          { expiresAt: { $lte: now } },
          { lockId },
        ],
      },
      {
        $set: {
          lockId,
          expiresAt,
        },
      },
      {
        new: true,
      },
    );

    if (updated) {
      return {
        success: true,
        lock: updated.lockId,
      };
    }

    try {
      const created = await this.locks.create({
        documentId,
        lockId,
        expiresAt,
      });

      return {
        success: true,
        lock: created.lockId,
      };
    } catch (error) {
      // Another instance may have created the lock first.
      if (
        (error as { code?: number }).code !== 11000
      ) {
        throw error;
      }
    }

    const current = await this.get(documentId);

    if (current?.lockId === lockId) {
      return {
        success: true,
        lock: current.lockId,
      };
    }

    return {
      success: false,
      lock: current?.lockId,
    };
  }

  async refresh(
    documentId: string,
    lockId: string,
  ): Promise<LockResult> {
    const updated = await this.locks.findOneAndUpdate(
      {
        documentId,
        lockId,
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          expiresAt: new Date(
            Date.now() + this.durationMs,
          ),
        },
      },
      {
        new: true,
      },
    );

    if (updated) {
      return {
        success: true,
        lock: updated.lockId,
      };
    }

    const current = await this.get(documentId);

    return {
      success: false,
      lock: current?.lockId,
    };
  }

  async release(
    documentId: string,
    lockId: string,
  ): Promise<LockResult> {
    const deleted = await this.locks.deleteOne({
      documentId,
      lockId,
      expiresAt: { $gt: new Date() },
    });

    if (deleted.deletedCount === 1) {
      return { success: true };
    }

    const current = await this.get(documentId);

    return {
      success: false,
      lock: current?.lockId,
    };
  }

  async replace(
    documentId: string,
    oldLockId: string,
    newLockId: string,
  ): Promise<LockResult> {
    const updated = await this.locks.findOneAndUpdate(
      {
        documentId,
        lockId: oldLockId,
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          lockId: newLockId,
          expiresAt: new Date(
            Date.now() + this.durationMs,
          ),
        },
      },
      {
        new: true,
      },
    );

    if (updated) {
      return {
        success: true,
        lock: updated.lockId,
      };
    }

    const current = await this.get(documentId);

    return {
      success: false,
      lock: current?.lockId,
    };
  }
}