/**
 * Type declarations for src/components/chat/utils/messageDedup.js
 */

export interface ChatMessage {
  type: string;
  content?: string;
  timestamp?: string | number | Date;
  reasoning?: string;
  clientRequestId?: string;
  deliveryStatus?: string;
  isToolUse?: boolean;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isThinking?: boolean;
  isTaskNotification?: boolean;
  attachments?: unknown[];
  images?: unknown[];
}

export declare function dedupeAdjacentChatMessages(messages: Array<ChatMessage>): Array<ChatMessage>;
