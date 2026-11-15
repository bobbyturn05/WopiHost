export const WOPI_HEADERS = {
  accessToken: 'x-wopi-access-token',
  proof: 'x-wopi-proof',
  proofOld: 'x-wopi-proofold',
  timestamp: 'x-wopi-timestamp',
  override: 'x-wopi-override',
  lock: 'x-wopi-lock',
  oldLock: 'x-wopi-oldlock',
  itemVersion: 'x-wopi-itemversion',
  lockFailureReason: 'x-wopi-lockfailure-reason'
} as const;

export const WOPI_OVERRIDES = {
  lock: 'LOCK',
  unlock: 'UNLOCK',
  refreshLock: 'REFRESH_LOCK',
  getLock: 'GET_LOCK',
  unlockAndRelock: 'UNLOCK_AND_RELOCK',
  put: 'PUT'
} as const;

export const TOKEN_MODES = {
  view: 'view',
  edit: 'edit'
} as const;

export type TokenMode = (typeof TOKEN_MODES)[keyof typeof TOKEN_MODES];