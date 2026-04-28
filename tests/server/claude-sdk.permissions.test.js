/**
 * PURPOSE: Guard Claude YOLO permission behavior so bypass mode never emits approval flows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldAutoApproveClaudeTool } from '../../server/claude-sdk.js';

/**
 * Build the minimum SDK options shape used by permission decisions.
 */
function createSdkOptions(overrides = {}) {
  return {
    permissionMode: 'default',
    allowedTools: [],
    disallowedTools: [],
    ...overrides,
  };
}

test('bypassPermissions auto-approves interactive Claude tools', () => {
  const decision = shouldAutoApproveClaudeTool(
    createSdkOptions({ permissionMode: 'bypassPermissions' }),
    'AskUserQuestion',
    { question: 'Continue?' },
  );

  assert.deepEqual(decision, {
    behavior: 'allow',
    updatedInput: { question: 'Continue?' },
  });
});

test('default mode still respects explicit allow and deny rules', () => {
  const denied = shouldAutoApproveClaudeTool(
    createSdkOptions({ disallowedTools: ['Bash(git status:*)'] }),
    'Bash',
    { command: 'git status --short' },
  );
  assert.deepEqual(denied, {
    behavior: 'deny',
    message: 'Tool disallowed by settings',
  });

  const allowed = shouldAutoApproveClaudeTool(
    createSdkOptions({ allowedTools: ['Read'] }),
    'Read',
    { filePath: '/tmp/demo.txt' },
  );
  assert.deepEqual(allowed, {
    behavior: 'allow',
    updatedInput: { filePath: '/tmp/demo.txt' },
  });
});
