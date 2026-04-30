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
 * Build a stable attachment identity so attachment messages only dedupe exact echoes.
 */
function getAttachmentSignature(message) {
  const attachments = [
    ...(Array.isArray(message.attachments) ? message.attachments : []),
    ...(Array.isArray(message.images) ? message.images : []),
  ];

  if (attachments.length === 0) {
    return '';
  }

  return attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== 'object') {
        return normalizeText(String(attachment));
      }
      return normalizeText(
        attachment.absolutePath
        || attachment.path
        || attachment.relativePath
        || attachment.url
        || attachment.name
        || attachment.id
        || JSON.stringify(attachment),
      );
    })
    .sort()
    .join('|');
}

/**
 * Restrict deduping to transcript entries that do not represent tool/runtime UI.
 */
function isPlainTranscriptMessage(message) {
  if (!message || (message.type !== 'user' && message.type !== 'assistant')) {
    return false;
  }

  return !message.isToolUse
    && !message.isStreaming
    && !message.isInteractivePrompt
    && !message.isThinking
    && !message.isTaskNotification;
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

  if (getAttachmentSignature(previousMessage) !== getAttachmentSignature(nextMessage)) {
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
 * Build a same-turn user key for non-adjacent realtime duplicates.
 */
function getUserTurnKey(message) {
  if (!isPlainTranscriptMessage(message) || message.type !== 'user') {
    return null;
  }

  const timestamp = toTimestampMs(message.timestamp);
  if (timestamp === null) {
    return null;
  }

  const content = normalizeText(message.content);
  if (!content) {
    return null;
  }

  const reasoning = normalizeText(message.reasoning);
  const attachmentSignature = getAttachmentSignature(message);
  return `${timestamp}:${content}:${reasoning}:${attachmentSignature}`;
}

/**
 * Rank delivery states so duplicate local rows keep the most complete status.
 */
function getDeliveryStatusRank(status) {
  switch (status) {
    case 'persisted':
      return 4;
    case 'sent':
      return 3;
    case 'pending':
      return 2;
    case 'failed':
      return 1;
    default:
      return 0;
  }
}

/**
 * Preserve the stronger user delivery status when dropping a duplicate row.
 */
function mergeDuplicateMessage(previousMessage, nextMessage) {
  if (previousMessage.type !== 'user') {
    return previousMessage;
  }

  const previousRank = getDeliveryStatusRank(previousMessage.deliveryStatus);
  const nextRank = getDeliveryStatusRank(nextMessage.deliveryStatus);
  if (previousRank > 0 && nextRank === 0 && previousMessage.deliveryStatus !== 'persisted') {
    return {
      ...previousMessage,
      deliveryStatus: 'persisted',
    };
  }

  if (nextRank <= previousRank) {
    return previousMessage;
  }

  return {
    ...previousMessage,
    deliveryStatus: nextMessage.deliveryStatus,
  };
}

/**
 * Check whether a non-adjacent user row is the same send replayed in memory.
 */
function findSeenUserTurnIndex(seenUserTurns, message) {
  if (!isPlainTranscriptMessage(message) || message.type !== 'user') {
    return -1;
  }

  const timestamp = toTimestampMs(message.timestamp);
  const content = normalizeText(message.content);
  const reasoning = normalizeText(message.reasoning);
  const attachmentSignature = getAttachmentSignature(message);
  if (timestamp === null || !content) {
    return -1;
  }

  return seenUserTurns.findIndex((seen) => (
    seen.content === content
    && seen.reasoning === reasoning
    && seen.attachmentSignature === attachmentSignature
    && Math.abs(timestamp - seen.timestamp) <= ADJACENT_DUPLICATE_WINDOW_MS
  ));
}

/**
 * Remove adjacent duplicate transcript entries while preserving original order.
 */
export function dedupeAdjacentChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 2) {
    return Array.isArray(messages) ? messages : [];
  }

  const dedupedMessages = [];
  const seenUserTurns = new Set();
  const seenUserTurnDetails = [];

  for (const message of messages) {
    const userTurnKey = getUserTurnKey(message);
    const previousMessage = dedupedMessages[dedupedMessages.length - 1];
    if (previousMessage && isAdjacentDuplicate(previousMessage, message)) {
      dedupedMessages[dedupedMessages.length - 1] = mergeDuplicateMessage(previousMessage, message);
      continue;
    }

    const seenUserTurnIndex = findSeenUserTurnIndex(seenUserTurnDetails, message);
    if (userTurnKey && (seenUserTurns.has(userTurnKey) || seenUserTurnIndex >= 0)) {
      if (seenUserTurnIndex >= 0) {
        const dedupedIndex = seenUserTurnDetails[seenUserTurnIndex].dedupedIndex;
        dedupedMessages[dedupedIndex] = mergeDuplicateMessage(dedupedMessages[dedupedIndex], message);
      }
      continue;
    }

    if (userTurnKey) {
      seenUserTurns.add(userTurnKey);
      seenUserTurnDetails.push({
        timestamp: toTimestampMs(message.timestamp),
        content: normalizeText(message.content),
        reasoning: normalizeText(message.reasoning),
        attachmentSignature: getAttachmentSignature(message),
        dedupedIndex: dedupedMessages.length,
      });
    }
    dedupedMessages.push(message);
  }

  return dedupedMessages;
}
