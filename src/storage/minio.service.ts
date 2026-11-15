import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { S3_CLIENT } from './consts';

export interface MinioObjectMetadata {
  filename: string;
  contentType: string;
  size: number;
  etag?: string;
  lastModified?: Date;
  versionId?: string;
}

@Injectable()
export class MinioService {
  constructor(
    @Inject(S3_CLIENT)
    private readonly client: S3Client,
  ) {}

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
      );

      return {
        filename: key.split('/').pop() || key,
        contentType: result.ContentType ?? 'application/octet-stream',
        size: result.ContentLength ?? 0,
        etag: result.ETag,
        lastModified: result.LastModified,
        versionId: result.VersionId,
      };
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  async getObject(
    bucket: string,
    key: string,
  ): Promise<Readable> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
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

  async putObject(
    bucket: string,
    key: string,
    content: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentLength: content.length,
        ContentType: contentType,
      }),
    );
  }

  private handleStorageError(error: unknown): never {
    const storageError = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };

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