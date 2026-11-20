import { createHash } from 'crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  GetObjectTaggingCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Inject,
  Injectable,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { S3_CLIENT } from './consts';

export interface MinioObjectHeaders {
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  expires?: Date;
  websiteRedirectLocation?: string;
}

export interface MinioWriteResult {
  versionId?: string;
  etag?: string;
}

export interface MinioObjectMetadata {
  filename: string;
  contentType: string;
  size: number;
  etag?: string;
  lastModified?: Date;
  versionId?: string;
  ownerId?: string;
  metadata?: Record<string, string>;
  headers: MinioObjectHeaders;
}

@Injectable()
export class MinioService implements OnModuleDestroy {
  constructor(
    @Inject(S3_CLIENT)
    private readonly client: S3Client,
  ) {}

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async checkBucket(bucket: string): Promise<void> {
    await this.client.send(
      new HeadBucketCommand({ Bucket: bucket }),
      { abortSignal: AbortSignal.timeout(5000) },
    );

    const versioning = await this.client.send(
      new GetBucketVersioningCommand({ Bucket: bucket }),
      { abortSignal: AbortSignal.timeout(5000) },
    );

    if (versioning.Status !== 'Enabled') {
      throw new Error(`MinIO bucket ${bucket} must have versioning enabled`);
    }
  }

  async statObject(
    bucket: string,
    key: string,
  ): Promise<MinioObjectMetadata> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );

      if (typeof result.ContentLength !== 'number' || !result.ETag) {
        throw new Error('MinIO returned incomplete object metadata');
      }

      return {
        filename: key.split('/').pop() || key,
        contentType: result.ContentType ?? 'application/octet-stream',
        size: result.ContentLength ?? 0,
        etag: result.ETag,
        lastModified: result.LastModified,
        versionId: result.VersionId,
        ownerId: result.Metadata?.ownerid,
        metadata: result.Metadata,
        headers: {
          cacheControl: result.CacheControl,
          contentDisposition: result.ContentDisposition,
          contentEncoding: result.ContentEncoding,
          contentLanguage: result.ContentLanguage,
          expires: result.Expires,
          websiteRedirectLocation: result.WebsiteRedirectLocation,
        },
      };
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  async getObject(
    bucket: string,
    key: string,
    versionId?: string,
    etag?: string,
  ): Promise<Readable> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
          ...(!versionId && etag ? { IfMatch: etag } : {}),
        }),
        { abortSignal: AbortSignal.timeout(120000) },
      );

      if (!result.Body) {
        throw new Error('MinIO returned an empty object body');
      }

      return Readable.from(
        result.Body as AsyncIterable<Uint8Array>,
      );
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  async getObjectTags(bucket: string, key: string, versionId?: string): Promise<Record<string, string>> {
    try {
      const result = await this.client.send(
        new GetObjectTaggingCommand({
          Bucket: bucket,
          Key: key,
          ...(versionId && versionId !== 'null' ? { VersionId: versionId } : {}),
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );

      return Object.fromEntries((result.TagSet ?? []).map((tag) => [tag.Key, tag.Value ?? '']));
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  async putObject(
    bucket: string,
    key: string,
    content: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
    headers: MinioObjectHeaders = {},
    tags: Record<string, string> = {},
    ifMatch?: string,
    operationSignal?: AbortSignal,
  ): Promise<MinioWriteResult> {
    await this.checkBucket(bucket);

    try {
      const result = await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: content,
          ContentLength: content.length,
          ContentMD5: createHash('md5').update(content).digest('base64'),
          ContentType: contentType,
          ...(ifMatch ? { IfMatch: ifMatch } : {}),
          ...(metadata ? { Metadata: metadata } : {}),
          ...(headers.cacheControl ? { CacheControl: headers.cacheControl } : {}),
          ...(headers.contentDisposition ? { ContentDisposition: headers.contentDisposition } : {}),
          ...(headers.contentEncoding ? { ContentEncoding: headers.contentEncoding } : {}),
          ...(headers.contentLanguage ? { ContentLanguage: headers.contentLanguage } : {}),
          ...(headers.expires ? { Expires: headers.expires } : {}),
          ...(headers.websiteRedirectLocation ? { WebsiteRedirectLocation: headers.websiteRedirectLocation } : {}),
          ...(Object.keys(tags).length ? { Tagging: new URLSearchParams(tags).toString() } : {}),
        }),
        { abortSignal: operationSignal
          ? AbortSignal.any([operationSignal, AbortSignal.timeout(120_000)])
          : AbortSignal.timeout(120_000) },
      );

      if (!result.VersionId || result.VersionId === 'null') {
        throw new InternalServerErrorException('MinIO did not create a new object version; verify bucket versioning');
      }
      return { versionId: result.VersionId, etag: result.ETag };
    } catch (error) {
      if (operationSignal?.aborted) {
        throw new ServiceUnavailableException('Document operation lease was lost during the save');
      }
      const storageError = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (
        storageError.name === 'PreconditionFailed' ||
        storageError.name === 'ConditionalRequestConflict' ||
        storageError.$metadata?.httpStatusCode === 412 ||
        storageError.$metadata?.httpStatusCode === 409
      ) {
        throw new ConflictException('Document changed in storage before the save could be committed');
      }
      this.handleStorageError(error);
    }
  }

  private handleStorageError(error: unknown): never {
    const storageError = error as {
      name?: string;
      code?: string;
      $metadata?: { httpStatusCode?: number };
    };

    if (
      storageError.name === 'TimeoutError' ||
      storageError.name === 'AbortError' ||
      storageError.name === 'RequestTimeout' ||
      ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EHOSTUNREACH'].includes(storageError.code ?? '') ||
      (storageError.$metadata?.httpStatusCode ?? 0) >= 500
    ) {
      throw new ServiceUnavailableException('MinIO is temporarily unavailable');
    }

    if (
      storageError.name === 'PreconditionFailed' ||
      storageError.$metadata?.httpStatusCode === 412
    ) {
      throw new ConflictException('Document changed in storage during the WOPI operation');
    }

    if (
      storageError.name === 'NoSuchKey' ||
      storageError.name === 'NotFound' ||
      storageError.$metadata?.httpStatusCode === 404
    ) {
      throw new NotFoundException('Document not found in MinIO');
    }

    throw error;
  }
}