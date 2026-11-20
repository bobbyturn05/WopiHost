import { createHmac } from 'crypto';

export function createWopiFileId(
  bucket: string,
  key: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(bucket, 'utf8')
    .update('\0', 'utf8')
    .update(key, 'utf8')
    .digest('hex');
}
