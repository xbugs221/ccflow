/**
 * PURPOSE: Merge persisted session transcripts with local optimistic chat
 * messages so refreshes do not hide in-flight user sends.
 */
import type { ChatMessage } from '../types/types';
import { dedupeAdjacentChatMessages } from './messageDedup';
import { getIntrinsicMessageKey } from './messageKeys';

const USER_UPLOAD_NOTE_MARKER = '[User uploaded files for this message]';

/**
 * Normalize user message text so optimistic and persisted copies can be matched
 * even when whitespace changes during provider serialization.
 */
function normalizeUserMessageText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Check whether the persisted user text confirms the optimistic send text.
 */
function isPersistedUserTextMatch(optimisticContent: string, persistedContent: string): boolean {
  if (!optimisticContent || !persistedContent) {
    return false;
  }

  if (optimisticContent === persistedContent) {
    return true;
  }

  return persistedContent.startsWith(`${optimisticContent} ${USER_UPLOAD_NOTE_MARKER}`);
}

/**
 * Match upload-only sends when the provider transcript only has the file note.
 */
function isPersistedAttachmentNoteMatch(optimisticMessage: ChatMessage, persistedContent: string): boolean {
  if (!persistedContent.includes(USER_UPLOAD_NOTE_MARKER) || !Array.isArray(optimisticMessage.attachments)) {
    return false;
  }

  const attachmentPaths = optimisticMessage.attachments
    .map((attachment) => (
      normalizeUserMessageText(attachment.absolutePath)
      || normalizeUserMessageText(attachment.relativePath)
      || normalizeUserMessageText(attachment.name)
    ))
    .filter(Boolean);

  return attachmentPaths.length > 0
    && attachmentPaths.every((attachmentPath) => persistedContent.includes(attachmentPath));
}

/**
 * Detect stale local user bubbles that contain only provider-facing upload notes.
 */
function isUploadNoteOnlyUserMessage(message: ChatMessage): boolean {
  if (message.type !== 'user') {
    return false;
  }

  const content = typeof message.content === 'string' ? message.content : '';
  const markerIndex = content.indexOf(USER_UPLOAD_NOTE_MARKER);
  if (markerIndex < 0) {
    return false;
  }

  const visibleText = content.slice(0, markerIndex).trim();
  const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
  return !visibleText && !hasAttachments;
}

/**
 * Collect stable request identities before falling back to lossy text matching.
 */
function getReliableUserMessageIdentities(message: ChatMessage): string[] {
  return [
    message.clientRequestId,
    message.requestId,
    message.messageKey,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * Decide whether reliable request identities prove same-send or different-send.
 */
function getReliableIdentityMatch(
  optimisticMessage: ChatMessage,
  persistedMessage: ChatMessage,
): boolean | null {
  const optimisticIdentities = getReliableUserMessageIdentities(optimisticMessage);
  const persistedIdentities = getReliableUserMessageIdentities(persistedMessage);
  if (optimisticIdentities.length === 0 || persistedIdentities.length === 0) {
    return null;
  }

  const persistedIdentitySet = new Set(persistedIdentities);
  return optimisticIdentities.some((identity) => persistedIdentitySet.has(identity));
}

/**
 * Check whether a persisted transcript entry confirms an optimistic user send.
 */
function isPersistedUserMessageMatch(optimisticMessage: ChatMessage, persistedMessage: ChatMessage): boolean {
  if (optimisticMessage.type !== 'user' || persistedMessage.type !== 'user') {
    return false;
  }

  const identityMatch = getReliableIdentityMatch(optimisticMessage, persistedMessage);
  if (identityMatch !== null) {
    return identityMatch;
  }

  const persistedContent = normalizeUserMessageText(persistedMessage.content);
  const optimisticContents = [
    optimisticMessage.content,
    optimisticMessage.submittedContent,
  ].map(normalizeUserMessageText).filter(Boolean);

  return optimisticContents.some((optimisticContent) => (
    isPersistedUserTextMatch(optimisticContent, persistedContent)
  )) || isPersistedAttachmentNoteMatch(optimisticMessage, persistedContent);
}

/**
 * Keep local realtime messages visible while the persisted history catches up.
 */
function shouldPreserveLocalMessage(message: ChatMessage): boolean {
  if (message.type === 'user') {
    if (isUploadNoteOnlyUserMessage(message)) {
      return false;
    }
    return Boolean(message.deliveryStatus);
  }

  return Boolean(
    message.isStreaming ||
    message.isInteractivePrompt ||
    message.source === 'codex-realtime' ||
    message.source === 'claude-realtime'
  );
}

interface MessageMergeOptions {
  preservePreviousMessages?: boolean;
}

/**
 * Merge persisted history with local in-flight messages from the same session.
 */
export function mergePersistedAndOptimisticMessages(
  persistedMessages: ChatMessage[],
  previousMessages: ChatMessage[],
  options: MessageMergeOptions = {},
): ChatMessage[] {
  const { preservePreviousMessages = true } = options;
  const mergedMessages = [...persistedMessages];
  const matchedPersistedIndexes = new Set<number>();
  const hasPersistedTranscript = persistedMessages.length > 0;

  previousMessages
    .filter((message) => message.type === 'user' && message.deliveryStatus)
    .forEach((optimisticMessage) => {
      let matchIndex = -1;
      for (let index = mergedMessages.length - 1; index >= 0; index -= 1) {
        if (
          !matchedPersistedIndexes.has(index)
          && isPersistedUserMessageMatch(optimisticMessage, mergedMessages[index])
        ) {
          matchIndex = index;
          break;
        }
      }

      if (matchIndex >= 0) {
        matchedPersistedIndexes.add(matchIndex);
        const optimisticAttachments = Array.isArray(optimisticMessage.attachments)
          && optimisticMessage.attachments.length > 0
          ? optimisticMessage.attachments
          : undefined;
        const optimisticContent = typeof optimisticMessage.submittedContent === 'string'
          ? optimisticMessage.submittedContent
          : (typeof optimisticMessage.content === 'string' ? optimisticMessage.content : '');
        mergedMessages[matchIndex] = {
          ...mergedMessages[matchIndex],
          clientRequestId: optimisticMessage.clientRequestId || mergedMessages[matchIndex].clientRequestId,
          content: optimisticContent || mergedMessages[matchIndex].content,
          submittedContent: optimisticMessage.submittedContent || mergedMessages[matchIndex].submittedContent,
          attachments: optimisticAttachments || mergedMessages[matchIndex].attachments,
          deliveryStatus: 'persisted',
        };
        return;
      }

      if (
        !preservePreviousMessages
        || isUploadNoteOnlyUserMessage(optimisticMessage)
        || (hasPersistedTranscript && optimisticMessage.deliveryStatus === 'persisted')
      ) {
        return;
      }

      mergedMessages.push(optimisticMessage);
    });

  const persistedKeys = new Set(
    persistedMessages.map((m) => getIntrinsicMessageKey(m)).filter((k): k is string => Boolean(k)),
  );

  previousMessages.forEach((message) => {
    if (message.type === 'user' && message.deliveryStatus) {
      return;
    }

    if (!preservePreviousMessages || !shouldPreserveLocalMessage(message)) {
      return;
    }

    const key = getIntrinsicMessageKey(message);
    if (key && persistedKeys.has(key)) {
      return;
    }

    mergedMessages.push(message);
  });

  return dedupeAdjacentChatMessages(mergedMessages) as ChatMessage[];
}
