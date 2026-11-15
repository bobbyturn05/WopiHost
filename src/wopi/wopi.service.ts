import {
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { MinioService } from '../storage/minio.service';
import { TokenDocument } from '../tokens/schemas/token.schema';
import { LocksService } from '../locks/locks.service';

@Injectable()
export class WopiService {
    constructor(
        private readonly minioService: MinioService,
        private readonly locksService: LocksService,
    ) { }

    async checkFileInfo(access: TokenDocument) {
        const metadata = await this.minioService.statObject(
            access.bucket,
            access.key,
        );

        return {
            BaseFileName: metadata.filename,
            OwnerId: access.userId,
            UserId: access.userId,
            Size: metadata.size,
            Version: metadata.etag ?? String(metadata.lastModified?.getTime() ?? 0),
            UserCanWrite: access.mode === 'edit',
            ReadOnly: access.mode !== 'edit',
            SupportsLocks: true,
            SupportsGetLock: true,
            SupportsUpdate: true,
            UserCanNotWriteRelative: true,
        };
    }

    async getFile(access: TokenDocument) {
        return this.minioService.getObject(access.bucket, access.key);
    }

    async putFile(
        access: TokenDocument,
        content: Buffer,
        lockId: string | undefined,
    ) {
        this.assertCanWrite(access);

        await this.locksService.assertLock(
            access.bucket,
            access.key,
            lockId,
        );

        await this.minioService.putObject(
            access.bucket,
            access.key,
            content,
            access.contentType,
        );

        const metadata = await this.minioService.statObject(
            access.bucket,
            access.key,
        );

        return {
            Version: metadata.etag ?? String(Date.now()),
        };
    }

    async lock(
        access: TokenDocument,
        lockId: string,
    ) {
        this.assertCanWrite(access);

        return this.locksService.lock(
            access.bucket,
            access.key,
            lockId,
        );
    }

    async refreshLock(
        access: TokenDocument,
        lockId: string,
    ) {
        this.assertCanWrite(access);

        return this.locksService.refresh(
            access.bucket,
            access.key,
            lockId,
        );
    }

    async unlock(
        access: TokenDocument,
        lockId: string,
    ) {
        this.assertCanWrite(access);

        return this.locksService.unlock(
            access.bucket,
            access.key,
            lockId,
        );
    }

    private assertCanWrite(access: TokenDocument) {
        if (access.mode !== 'edit') {
            throw new ForbiddenException('This WOPI session is read-only');
        }
    }

    async getLock(access: TokenDocument) {
        return this.locksService.getLock(access.bucket, access.key);
    }

    async unlockAndRelock(
        access: TokenDocument,
        oldLockId: string,
        newLockId: string,
    ) {
        this.assertCanWrite(access);

        await this.locksService.replaceLock(
            access.bucket,
            access.key,
            oldLockId,
            newLockId,
        );
    }
}