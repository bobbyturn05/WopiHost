import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const endpointValue = process.env.MINIO_ENDPOINT;
const accessKeyId = process.env.MINIO_ACCESS_KEY;
const secretAccessKey = process.env.MINIO_SECRET_KEY;
const bucket = process.env.MINIO_VERSIONED_BUCKETS?.split(',').map((value) => value.trim()).find(Boolean);

if (!endpointValue || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error('MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, and MINIO_VERSIONED_BUCKETS are required');
}

const endpoint = /^https?:\/\//i.test(endpointValue)
  ? endpointValue
  : `${process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${endpointValue}${/:\d+$/.test(endpointValue) ? '' : `:${process.env.MINIO_PORT ?? 9000}`}`;
const client = new S3Client({
  endpoint,
  region: process.env.MINIO_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

const key = `wopi-conditional-write-check/${randomUUID()}.txt`;
const versions = [];
const contentMd5 = (value) => createHash('md5').update(value).digest('base64');

try {
  const firstBody = Buffer.from('wopi-conditional-write-check-1');
  const first = await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: firstBody,
    ContentMD5: contentMd5(firstBody),
  }));
  if (!first.VersionId || first.VersionId === 'null') {
    throw new Error(`Bucket ${bucket} did not return a version ID; enable versioning first`);
  }
  versions.push(first.VersionId);

  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (!head.ETag) throw new Error('MinIO did not return an ETag for the test object');

  const secondBody = Buffer.from('wopi-conditional-write-check-2');
  const second = await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: secondBody,
    ContentMD5: contentMd5(secondBody),
    IfMatch: head.ETag,
  }));
  if (!second.VersionId || second.VersionId === 'null') {
    throw new Error('Conditional PutObject did not return a version ID');
  }
  versions.push(second.VersionId);

  let staleWriteRejected = false;
  try {
    const staleBody = Buffer.from('wopi-conditional-write-check-stale');
    const stale = await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: staleBody,
      ContentMD5: contentMd5(staleBody),
      IfMatch: head.ETag,
    }));
    if (stale.VersionId && stale.VersionId !== 'null') versions.push(stale.VersionId);
  } catch (error) {
    const storageError = error;
    staleWriteRejected = storageError?.name === 'PreconditionFailed' || storageError?.$metadata?.httpStatusCode === 412;
    if (!staleWriteRejected) throw error;
  }

  if (!staleWriteRejected) {
    throw new Error('MinIO accepted a stale If-Match PutObject; conditional writes are not enforced');
  }

  process.stdout.write(`Conditional PutObject is supported by bucket ${bucket}.\n`);
} finally {
  await Promise.allSettled(versions.map((versionId) => client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
    VersionId: versionId,
  }))));
  client.destroy();
}
