/**
 * PURPOSE: Verify retired Claude SDK exports cannot start sessions or approvals.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  abortClaudeSDKSession,
  getActiveClaudeSDKSessions,
  isClaudeSDKSessionActive,
  queryClaudeSDK,
  resolveToolApproval,
  shouldAutoApproveClaudeTool,
} from '../../server/claude-sdk.js';

test('Claude SDK compatibility layer rejects runtime use', async () => {
  await assert.rejects(
    () => queryClaudeSDK('hello'),
    /Claude SDK provider is no longer supported/,
  );

  assert.equal(abortClaudeSDKSession('missing-session'), false);
  assert.equal(isClaudeSDKSessionActive('missing-session'), false);
  assert.deepEqual(getActiveClaudeSDKSessions(), []);
  assert.equal(resolveToolApproval('missing-request'), false);
  assert.equal(shouldAutoApproveClaudeTool({}, 'Read', {}), null);
});
