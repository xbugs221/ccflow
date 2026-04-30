/**
 * PURPOSE: Verify backend workflow automation uses unattended Codex permissions.
 */
import assert from 'assert/strict';
import test from 'node:test';

import {
  resolveProviderResumeSessionId,
  resolveWorkflowAutoRunPermissionMode,
} from '../../server/workflow-auto-runner.js';

test('workflow auto runner defaults Codex sessions to yolo permissions', () => {
  assert.equal(resolveWorkflowAutoRunPermissionMode({}), 'bypassPermissions');
});

test('workflow auto runner permission mode can be overridden by env', () => {
  assert.equal(
    resolveWorkflowAutoRunPermissionMode({ CCFLOW_WORKFLOW_AUTORUN_PERMISSION: 'acceptEdits' }),
    'acceptEdits',
  );
});

test('workflow auto runner does not resume route-only draft session ids', () => {
  assert.equal(resolveProviderResumeSessionId('c2'), undefined);
  assert.equal(resolveProviderResumeSessionId('new-session-123'), undefined);
  assert.equal(
    resolveProviderResumeSessionId('2c0e84de-dd37-4a4e-8b69-e686e22588aa'),
    '2c0e84de-dd37-4a4e-8b69-e686e22588aa',
  );
});
