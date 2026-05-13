/**
 * Type declarations for src/components/main-content/view/subcomponents/sessionActivityState.js
 */

export interface Session {
  id: string;
  __provider?: string;
  provider?: string;
  __projectName?: string;
  lastActivity?: string;
  updated_at?: string;
  updatedAt?: string;
  created_at?: string;
  createdAt?: string;
  messageCount?: number;
  [key: string]: unknown;
}

export interface UnreadCheckParams {
  isSelected: boolean;
  viewedSignature: string | null;
  activitySignature: string;
}

export declare const VIEWED_SESSION_SIGNATURES_STORAGE_KEY: string;
export declare function getViewedSessionKey(projectName: string, session: Session): string;
export declare function getSessionProjectName(projectName: string, session: Session): string;
export declare function getSessionActivitySignature(session: Session): string;
export declare function readViewedSessionSignature(sessionKey: string): string | null;
export declare function writeViewedSessionSignature(sessionKey: string, signature: string): void;
export declare function hasUnreadSessionActivity(params: UnreadCheckParams): boolean;
