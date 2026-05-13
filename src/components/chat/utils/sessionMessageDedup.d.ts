/**
 * Type declarations for src/components/chat/utils/sessionMessageDedup.js
 */

export interface SessionMessage {
  type?: string;
  messageKey?: string;
  sessionId?: string;
  __lineNumber?: number;
  __provider?: string;
  content?: unknown;
  timestamp?: unknown;
  message?: {
    role?: string;
    content?: unknown;
  };
  [key: string]: unknown;
}

export declare function getSessionMessageIdentity(message: SessionMessage | null | undefined): string | null;
export declare function dedupeSessionMessagesByIdentity(messages: Array<SessionMessage>): Array<SessionMessage>;
export declare function getUniqueIncomingSessionMessages(
  existingMessages: Array<SessionMessage>,
  incomingMessages: Array<SessionMessage>,
): Array<SessionMessage>;
