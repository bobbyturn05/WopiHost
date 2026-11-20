import { randomBytes } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WopiFileIdentity } from './schemas/file-identity.schema';
import { MinioService } from '../storage/minio.service';

@Injectable()
export class FileIdentitiesService {
  constructor(
    @InjectModel(WopiFileIdentity.name)
    private readonly identityModel: Model<WopiFileIdentity>,
    private readonly minio: MinioService,
  ) {}

  async getOrCreate(bucket: string, key: string): Promise<WopiFileIdentity> {
    const existing = await this.identityModel.findOne({ bucket, key }).lean();
    if (existing) return existing as WopiFileIdentity;

    await this.identityModel.updateMany(
      { previousLocations: { $elemMatch: { bucket, key } } },
      { $pull: { previousLocations: { bucket, key } } },
    );

    try {
      return await this.identityModel.create({
        bucket,
        key,
        fileId: randomBytes(32).toString('hex'),
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const raced = await this.identityModel.findOne({ bucket, key }).lean();
      if (raced) return raced as WopiFileIdentity;
      throw error;
    }
  }

  async findByLocation(bucket: string, key: string): Promise<WopiFileIdentity> {
    const current = await this.identityModel.findOne({ bucket, key }).lean();
    if (current) return current as WopiFileIdentity;

    const previous = await this.identityModel.findOne({
      previousLocations: { $elemMatch: { bucket, key } },
    }).lean();
    if (!previous) throw new NotFoundException('WOPI file identity not found');
    return previous as WopiFileIdentity;
  }

  async findByFileId(fileId: string): Promise<WopiFileIdentity> {
    const identity = await this.identityModel.findOne({ fileId }).lean();
    if (!identity) throw new NotFoundException('WOPI file identity not found');
    return identity as WopiFileIdentity;
  }


  private sortedRecord(record?: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  }

  async deleteByFileId(fileId: string): Promise<void> {
    await this.identityModel.deleteOne({ fileId });
  }

  async move(
    sourceBucket: string,
    sourceKey: string,
    destinationBucket: string,
    destinationKey: string,
    assertLease?: () => Promise<void>,
  ): Promise<void> {
    if (sourceBucket === destinationBucket && sourceKey === destinationKey) {
      throw new BadRequestException('Source and destination must be different object locations');
    }
    if (Buffer.byteLength(sourceKey, 'utf8') > 1024 || Buffer.byteLength(destinationKey, 'utf8') > 1024) {
      throw new BadRequestException('S3 object key exceeds the supported length');
    }
    await this.minio.checkBucket(sourceBucket);
    await this.minio.checkBucket(destinationBucket);

    const identity = await this.identityModel.findOne({ bucket: sourceBucket, key: sourceKey }).lean();
    if (!identity) {
      const alreadyMoved = await this.identityModel.findOne({
        bucket: destinationBucket,
        key: destinationKey,
        previousLocations: { $elemMatch: { bucket: sourceBucket, key: sourceKey } },
      }).lean();
      if (alreadyMoved) return;
      throw new NotFoundException('WOPI file identity not found');
    }

    const destinationIdentity = await this.identityModel.findOne({
      $or: [
        { bucket: destinationBucket, key: destinationKey },
        { previousLocations: { $elemMatch: { bucket: destinationBucket, key: destinationKey } } },
      ],
    }).lean();
    if (destinationIdentity && destinationIdentity.fileId !== identity.fileId) {
      throw new ConflictException('A different WOPI file identity already uses the destination location');
    }

    const [sourceMetadata, destinationMetadata, sourceTags, destinationTags] = await Promise.all([
      this.minio.statObject(sourceBucket, sourceKey),
      this.minio.statObject(destinationBucket, destinationKey),
      this.minio.getObjectTags(sourceBucket, sourceKey),
      this.minio.getObjectTags(destinationBucket, destinationKey),
    ]);
    const [sourceAgain, sourceTagsAgain] = await Promise.all([
      this.minio.statObject(sourceBucket, sourceKey),
      this.minio.getObjectTags(sourceBucket, sourceKey),
    ]);
    if (
      sourceMetadata.size !== destinationMetadata.size ||
      sourceMetadata.etag !== destinationMetadata.etag ||
      sourceMetadata.contentType !== destinationMetadata.contentType ||
      JSON.stringify(this.sortedRecord(sourceMetadata.metadata)) !== JSON.stringify(this.sortedRecord(destinationMetadata.metadata)) ||
      JSON.stringify(sourceMetadata.headers) !== JSON.stringify(destinationMetadata.headers) ||
      JSON.stringify(this.sortedRecord(sourceTags)) !== JSON.stringify(this.sortedRecord(destinationTags)) ||
      sourceAgain.etag !== sourceMetadata.etag ||
      sourceAgain.versionId !== sourceMetadata.versionId ||
      JSON.stringify(this.sortedRecord(sourceTagsAgain)) !== JSON.stringify(this.sortedRecord(sourceTags))
    ) {
      throw new ConflictException('The source changed or the destination copy differs; copy the latest object and retry');
    }

    await assertLease?.();

    try {
      const result = await this.identityModel.updateOne(
        { fileId: identity.fileId, bucket: sourceBucket, key: sourceKey },
        {
          $set: { bucket: destinationBucket, key: destinationKey },
          $addToSet: { previousLocations: { bucket: sourceBucket, key: sourceKey } },
        },
      );
      if (result.modifiedCount !== 1) {
        const current = await this.identityModel.findOne({ fileId: identity.fileId }).lean();
        if (current?.bucket === destinationBucket && current?.key === destinationKey) return;
        throw new ConflictException('WOPI file identity changed during the move');
      }
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('A WOPI file identity already exists for the destination object');
      }
      throw error;
    }
  }
}
