import { TokenMode } from '../../common/consts/wopi.constants';

export interface LaunchTokenPayload {
  documentId: string;
  userId: string;
  mode: TokenMode;
}

export interface AccessTokenPayload extends LaunchTokenPayload {
  expiresAt: Date;
}