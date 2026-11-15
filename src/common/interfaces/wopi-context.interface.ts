export interface IWopiDocumentContext {
  documentId: string;

  filename: string;
  mimeType: string;
  size: number;

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

  version: number;
  etag?: string;
}