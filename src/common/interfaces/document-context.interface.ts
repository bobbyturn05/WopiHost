export interface DocumentContext {
  documentId: string;
  ownerId: string;
  filename: string;
  mimeType: string;
  size: number;
  version: number;
  etag: string;

  user: {
    id: string;
    displayName: string;
  };

  permissions: {
    view: boolean;
    edit: boolean;
    download: boolean;
  };

  storage: {
    bucket: string;
    objectKey: string;
  };
}