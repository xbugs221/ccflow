/**
 * PURPOSE: Preserve the old Claude SDK module boundary as an unsupported
 * compatibility layer after removing the Claude provider implementation.
 */

const unsupportedClaudeSdkError = () => (
  new Error('Claude SDK provider is no longer supported')
);

/**
 * Reject attempts to start Claude SDK sessions.
 *
 * @returns {Promise<never>}
 */
async function queryClaudeSDK() {
  throw unsupportedClaudeSdkError();
}

/**
 * Report that no Claude SDK session can be aborted because the provider is gone.
 *
 * @returns {boolean}
 */
function abortClaudeSDKSession() {
  return false;
}

/**
 * Report inactive status for every Claude SDK session id.
 *
 * @returns {boolean}
 */
function isClaudeSDKSessionActive() {
  return false;
}

/**
 * Return no active Claude SDK sessions because the provider is no longer loaded.
 *
 * @returns {Array<never>}
 */
function getActiveClaudeSDKSessions() {
  return [];
}

/**
 * Keep permission-decision imports non-crashing while denying Claude tool flow.
 *
 * @returns {null}
 */
function shouldAutoApproveClaudeTool() {
  return null;
}

/**
 * Resolve no pending Claude approvals because Claude tool execution is removed.
 *
 * @returns {boolean}
 */
function resolveToolApproval() {
  return false;
}

/**
 * Test helper retained for legacy imports; it has no active session store.
 *
 * @returns {void}
 */
function __registerActiveClaudeSessionForTest() {}

/**
 * Test helper retained for legacy imports; it has no active session store.
 *
 * @returns {void}
 */
function __clearActiveClaudeSessionsForTest() {}

/**
 * Test helper retained for legacy imports; mapping Claude CLI options is gone.
 *
 * @returns {never}
 */
function __mapCliOptionsToSDKForTest() {
  throw unsupportedClaudeSdkError();
}

export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  shouldAutoApproveClaudeTool,
  __registerActiveClaudeSessionForTest,
  __clearActiveClaudeSessionsForTest,
  __mapCliOptionsToSDKForTest,
};
