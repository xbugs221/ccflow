/**
 * PURPOSE: Share project home session-card activity signatures with the sidebar
 * so both surfaces agree on unread state and read receipts.
 */

export const VIEWED_SESSION_SIGNATURES_STORAGE_KEY = 'ccflow:viewed-session-signatures';

export function getViewedSessionKey(projectName, session) {
  /**
   * Build the localStorage key for a session using its owning project name.
   */
  return [projectName, session.__provider || 'claude', session.id].join(':');
}

export function getSessionProjectName(projectName, session) {
  /**
   * Prefer the session's source project so cross-project cards clear correctly.
   */
  return session.__projectName || projectName;
}

export function getSessionActivitySignature(session) {
  /**
   * Convert visible session activity into a stable read/unread comparison value.
   */
  const sessionTime =
    session.lastActivity ||
    session.updated_at ||
    session.updatedAt ||
    session.created_at ||
    session.createdAt ||
    '';
  const messageCount = Number(session.messageCount || 0);
  return `${Number.isFinite(messageCount) ? messageCount : 0}:${String(sessionTime)}`;
}

export function readViewedSessionSignature(sessionKey) {
  /**
   * Read a stored session activity signature from browser localStorage.
   */
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(VIEWED_SESSION_SIGNATURES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.[sessionKey] === 'string' ? parsed[sessionKey] : null;
  } catch {
    return null;
  }
}

export function writeViewedSessionSignature(sessionKey, signature) {
  /**
   * Persist one read receipt while preserving other session signatures.
   */
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(VIEWED_SESSION_SIGNATURES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    window.localStorage.setItem(
      VIEWED_SESSION_SIGNATURES_STORAGE_KEY,
      JSON.stringify({ ...parsed, [sessionKey]: signature }),
    );
  } catch {
    // Ignore storage errors; unread state is a convenience signal.
  }
}

export function hasUnreadSessionActivity({ isSelected, viewedSignature, activitySignature }) {
  /**
   * Match sidebar behavior: missing read receipt means current history is read.
   */
  return !isSelected && viewedSignature !== null && viewedSignature !== activitySignature;
}
