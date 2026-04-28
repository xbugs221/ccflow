/**
 * PURPOSE: Collapse accidental adjacent duplicate transcript messages that can
 * appear when local cache and restored session history overlap during refresh.
 */

const ADJACENT_DUPLICATE_WINDOW_MS = 5000;

/**
 * Normalize freeform text so whitespace-only differences do not block deduping.
 */
function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Convert a timestamp-like value into epoch milliseconds when possible.
 */
function toTimestampMs(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Restrict deduping to plain user/assistant transcript entries.
 */
function isPlainTranscriptMessage(message) {
  if (!message || (message.type !== 'user' && message.type !== 'assistant')) {
    return false;
  }

  return !message.isToolUse
    && !message.isStreaming
    && !message.isInteractivePrompt
    && !message.isThinking
    && !message.isTaskNotification
    && !Array.isArray(message.attachments)
    && !Array.isArray(message.images);
}

/**
 * Decide whether two adjacent transcript messages represent the same payload.
 */
function isAdjacentDuplicate(previousMessage, nextMessage) {
  if (!isPlainTranscriptMessage(previousMessage) || !isPlainTranscriptMessage(nextMessage)) {
    return false;
  }

  if (
    typeof previousMessage.clientRequestId === 'string'
    && previousMessage.clientRequestId
    && previousMessage.clientRequestId === nextMessage.clientRequestId
  ) {
    return true;
  }

  if (previousMessage.type !== nextMessage.type) {
    return false;
  }

  if (normalizeText(previousMessage.content) !== normalizeText(nextMessage.content)) {
    return false;
  }

  if (normalizeText(previousMessage.reasoning) !== normalizeText(nextMessage.reasoning)) {
    return false;
  }

  const previousTimestamp = toTimestampMs(previousMessage.timestamp);
  const nextTimestamp = toTimestampMs(nextMessage.timestamp);

  if (previousTimestamp === null || nextTimestamp === null) {
    return true;
  }

  return Math.abs(nextTimestamp - previousTimestamp) <= ADJACENT_DUPLICATE_WINDOW_MS;
}

/**
 * Remove adjacent duplicate transcript entries while preserving original order.
 */
export function dedupeAdjacentChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 2) {
    return Array.isArray(messages) ? messages : [];
  }

  const dedupedMessages = [];

  for (const message of messages) {
    const previousMessage = dedupedMessages[dedupedMessages.length - 1];
    if (previousMessage && isAdjacentDuplicate(previousMessage, message)) {
      continue;
    }

    dedupedMessages.push(message);
  }

  return dedupedMessages;
}
