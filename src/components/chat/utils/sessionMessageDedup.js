/**
 * PURPOSE: Deduplicate raw session transcript rows by backend JSONL identity.
 */

/**
 * Build the stable transcript identity used by pagination and refresh merges.
 * @param {Record<string, unknown> | null | undefined} message - Raw session message.
 * @returns {string | null} Stable identity, or null when the backend gave no cursor.
 */
export function getSessionMessageIdentity(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  if (typeof message.messageKey === 'string' && message.messageKey) {
    return message.messageKey;
  }

  if (Number.isFinite(Number(message.__lineNumber))) {
    const provider = typeof message.__provider === 'string' ? message.__provider : 'session';
    const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
    return `${provider}:${sessionId}:line:${Number(message.__lineNumber)}`;
  }

  return null;
}

/**
 * Build a same-turn user key for Codex records that echo one prompt twice.
 * @param {Record<string, unknown> | null | undefined} message - Raw session message.
 * @returns {string | null} Same-turn user key.
 */
function getUserTurnParts(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const isUserMessage = message.type === 'user' || message.message?.role === 'user';
  if (!isUserMessage) {
    return null;
  }

  let rawContent = message.content;
  if (typeof message.message?.content === 'string') {
    rawContent = message.message.content;
  } else if (Array.isArray(message.message?.content)) {
    rawContent = message.message.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
  }

  if (typeof rawContent !== 'string') {
    return null;
  }

  const normalizedContent = rawContent.replace(/\s+/g, ' ').trim();
  if (!normalizedContent) {
    return null;
  }

  const timestamp = new Date(message.timestamp).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return { normalizedContent, timestamp };
}

/**
 * Build a same-turn user key for Codex records that echo one prompt twice.
 * @param {Record<string, unknown> | null | undefined} message - Raw session message.
 * @returns {string | null} Same-turn user key.
 */
function getUserTurnKey(message) {
  const userTurn = getUserTurnParts(message);
  if (!userTurn) {
    return null;
  }
  return `${userTurn.timestamp}:${userTurn.normalizedContent}`;
}

/**
 * Detect Codex duplicate prompt echoes whose JSONL timestamps differ slightly.
 * @param {{ normalizedContent: string, timestamp: number } | null} userTurn - User turn parts.
 * @param {Map<string, number>} recentUserTurnTimestamps - Last timestamp per prompt text.
 * @returns {boolean} True when the message is a near-duplicate user echo.
 */
function isRecentDuplicateUserTurn(userTurn, recentUserTurnTimestamps) {
  if (!userTurn) {
    return false;
  }

  const recentTimestamp = recentUserTurnTimestamps.get(userTurn.normalizedContent);
  return Number.isFinite(recentTimestamp)
    && Math.abs(userTurn.timestamp - recentTimestamp) <= 1000;
}

/**
 * Remember the latest timestamp for a normalized user turn text.
 * @param {{ normalizedContent: string, timestamp: number } | null} userTurn - User turn parts.
 * @param {Map<string, number>} recentUserTurnTimestamps - Last timestamp per prompt text.
 */
function rememberUserTurn(userTurn, recentUserTurnTimestamps) {
  if (userTurn) {
    recentUserTurnTimestamps.set(userTurn.normalizedContent, userTurn.timestamp);
  }
}

/**
 * Remove repeated raw transcript rows before conversion into UI messages.
 * @param {Array<Record<string, unknown>>} messages - Raw transcript rows.
 * @returns {Array<Record<string, unknown>>} Rows with duplicate identities removed.
 */
export function dedupeSessionMessagesByIdentity(messages) {
  const seen = new Set();
  const seenUserTurns = new Set();
  const recentUserTurnTimestamps = new Map();
  const dedupedMessages = [];

  (Array.isArray(messages) ? messages : []).forEach((message) => {
    const identity = getSessionMessageIdentity(message);
    const userTurn = getUserTurnParts(message);
    const userTurnKey = getUserTurnKey(message);
    if (identity) {
      if (seen.has(identity)) {
        return;
      }
      seen.add(identity);
    }
    if (userTurnKey) {
      if (seenUserTurns.has(userTurnKey)) {
        return;
      }
      seenUserTurns.add(userTurnKey);
    }
    if (isRecentDuplicateUserTurn(userTurn, recentUserTurnTimestamps)) {
      return;
    }
    rememberUserTurn(userTurn, recentUserTurnTimestamps);

    dedupedMessages.push(message);
  });

  return dedupedMessages;
}

/**
 * Keep only incoming raw transcript rows that are not already loaded.
 * @param {Array<Record<string, unknown>>} existingMessages - Current raw transcript rows.
 * @param {Array<Record<string, unknown>>} incomingMessages - Newly fetched transcript rows.
 * @returns {Array<Record<string, unknown>>} New rows not already represented.
 */
export function getUniqueIncomingSessionMessages(existingMessages, incomingMessages) {
  const existingRows = Array.isArray(existingMessages) ? existingMessages : [];
  const existingIdentities = new Set(existingRows.map(getSessionMessageIdentity).filter(Boolean));
  const existingUserTurns = new Set(existingRows.map(getUserTurnKey).filter(Boolean));
  const recentUserTurnTimestamps = new Map();
  existingRows.map(getUserTurnParts).filter(Boolean).forEach((userTurn) => {
    rememberUserTurn(userTurn, recentUserTurnTimestamps);
  });

  return (Array.isArray(incomingMessages) ? incomingMessages : []).filter((message) => {
    const identity = getSessionMessageIdentity(message);
    const userTurn = getUserTurnParts(message);
    const userTurnKey = getUserTurnKey(message);
    if (
      (identity && existingIdentities.has(identity))
      || (userTurnKey && existingUserTurns.has(userTurnKey))
      || isRecentDuplicateUserTurn(userTurn, recentUserTurnTimestamps)
    ) {
      return false;
    }
    if (identity) existingIdentities.add(identity);
    if (userTurnKey) existingUserTurns.add(userTurnKey);
    rememberUserTurn(userTurn, recentUserTurnTimestamps);
    return true;
  });
}
