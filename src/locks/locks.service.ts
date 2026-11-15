import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WopiLock } from './schemas/lock.schema';

@Injectable()
export class LocksService {
    private readonly lockTtlMs = 30 * 60 * 1000;

    constructor(
        @InjectModel(WopiLock.name)
        private readonly lockModel: Model<WopiLock>,
    ) { }

    async lock(
        bucket: string,
        key: string,
        lockId: string,
    ): Promise<void> {
        const current = await this.findActive(bucket, key);

        if (current) {
            if (current.lockId !== lockId) {
                throw new ConflictException('Document is locked');
            }

            await this.refresh(bucket, key, lockId);
            return;
        }

        try {
            await this.lockModel.create({
                bucket,
                key,
                lockId,
                expiresAt: new Date(Date.now() + this.lockTtlMs),
            });
        } catch (error) {
            if (error?.code === 11000) {
                throw new ConflictException('Document is locked');
            }

            throw error;
        }
    }

    async refresh(
        bucket: string,
        key: string,
        lockId: string,
    ): Promise<void> {
        const result = await this.lockModel.updateOne(
            {
                bucket,
                key,
                lockId,
                expiresAt: { $gt: new Date() },
            },
            {
                $set: {
                    expiresAt: new Date(Date.now() + this.lockTtlMs),
                },
            },
        );

        if (result.modifiedCount === 0) {
            throw new ConflictException('Lock does not match');
        }
    }

    async unlock(
        bucket: string,
        key: string,
        lockId: string,
    ): Promise<void> {
        const result = await this.lockModel.deleteOne({
            bucket,
            key,
            lockId,
            expiresAt: { $gt: new Date() },
        });

        if (result.deletedCount === 0) {
            throw new ConflictException('Lock does not match');
        }
    }

    async replaceLock(
        bucket: string,
        key: string,
        oldLockId: string,
        newLockId: string,
    ): Promise<void> {
        const result = await this.lockModel.updateOne(
            {
                bucket,
                key,
                lockId: oldLockId,
                expiresAt: { $gt: new Date() },
            },
            {
                $set: {
                    lockId: newLockId,
                    expiresAt: new Date(Date.now() + this.lockTtlMs),
                },
            },
        );

        if (result.modifiedCount === 0) {
            throw new ConflictException('Old lock does not match');
        }
    }

    async assertLock(
        bucket: string,
        key: string,
        lockId?: string,
    ): Promise<void> {
        const current = await this.findActive(bucket, key);

        if (!current) {
            if (lockId) {
                throw new ConflictException('Document is not locked');
            }

            return;
        }

        if (!lockId || current.lockId !== lockId) {
            throw new ConflictException('Lock does not match');
        }
    }

    async getLock(
        bucket: string,
        key: string,
    ): Promise<string | null> {
        const current = await this.findActive(bucket, key);
        return current?.lockId ?? null;
    }

    private async findActive(bucket: string, key: string) {
        return this.lockModel.findOne({
            bucket,
            key,
            expiresAt: { $gt: new Date() },
        });
    }
}