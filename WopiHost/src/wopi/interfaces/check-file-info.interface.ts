export interface CheckFileInfo {
  BaseFileName: string;
  OwnerId: string;
  Size: number;
  UserId: string;
  Version: string;
  LastModifiedTime?: string;
  UserCanWrite?: boolean;
  ReadOnly?: boolean;
  SupportsLocks?: boolean;
  SupportsGetLock?: boolean;
  SupportsExtendedLockLength?: boolean;
  SupportsUpdate?: boolean;
  UserCanNotWriteRelative?: boolean;
}
