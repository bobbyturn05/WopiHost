export interface CheckFileInfo {
  BaseFileName: string;
  OwnerId: string;
  Size: number;
  UserId: string;
  UserFriendlyName: string;
  Version: string;

  UserCanWrite: boolean;
  UserCanNotWriteRelative: boolean;

  SupportsLocks: boolean;
  SupportsGetLock: boolean;
  SupportsUpdate: boolean;

  ReadOnly: boolean;
  RestrictedWebViewOnly: boolean;
  UserCanRename: boolean;
  UserCanDelete: boolean;
  UserCanDownload: boolean;
}