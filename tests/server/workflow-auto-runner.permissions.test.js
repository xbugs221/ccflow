/**
 * PURPOSE: Verify backend workflow automation uses unattended Codex permissions.
 */
import assert from 'assert/strict';
import test from 'node:test';

import { resolveWorkflowAutoRunPermissionMode } from '../../server/workflow-auto-runner.js';

test('workflow auto runner defaults Codex sessions to yolo permissions', () => {
  assert.equal(resolveWorkflowAutoRunPermissionMode({}), 'bypassPermissions');
});

test('workflow auto runner permission mode can be overridden by env', () => {
  assert.equal(
    resolveWorkflowAutoRunPermissionMode({ CCFLOW_WORKFLOW_AUTORUN_PERMISSION: 'acceptEdits' }),
    'acceptEdits',
  );
});
