export interface StoredObject {
  bucket: string;
  objectKey: string;
  size: number;
  contentType: string;
  etag?: string;
}