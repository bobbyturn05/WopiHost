export interface WopiAccessContext {
  fileId: string;
  bucket: string;
  key: string;
  userId: string;
  mode: 'view' | 'edit';
}
