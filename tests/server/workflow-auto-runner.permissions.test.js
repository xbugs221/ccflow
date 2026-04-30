/**
 * PURPOSE: Verify backend workflow automation uses unattended Codex permissions.
 */
import assert from 'assert/strict';
import test from 'node:test';

import {
  evaluateWorkflowActionDedup,
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

test('workflow auto runner resumes an indexed active stage instead of treating it as done', () => {
  const project = { path: '/tmp/matx' };
  const workflow = {
    id: 'w1',
    chat: {
      2: {
        sessionId: 'execution-session',
        stageKey: 'execution',
      },
    },
  };
  const action = {
    stage: 'execution',
    sessionId: 'execution-session',
    routeIndex: 2,
    checkpoint: 'execution-session',
  };
  const actionKey = [
    project.path,
    workflow.id,
    action.stage,
    action.checkpoint,
  ].join(':');
  const runnerState = {
    inFlightWorkflowKeys: new Set(),
    inFlightKeys: new Set(),
    completedKeys: new Set([actionKey]),
  };

  assert.deepEqual(
    evaluateWorkflowActionDedup({ project, workflow, action, runnerState }),
    { shouldSkip: false, reason: 'resume_existing_session' },
  );
});

test('workflow auto runner requires a post-repair review session for after-repair checkpoints', () => {
  const project = { path: '/tmp/matx' };
  const workflow = {
    id: 'w2',
    chat: {
      2: {
        sessionId: 'review-before-repair',
        stageKey: 'review_1',
      },
      3: {
        sessionId: 'repair-session',
        stageKey: 'repair_1',
      },
    },
  };
  const action = {
    stage: 'review_1',
    checkpoint: 'after-repair:repair-session',
  };
  const actionKey = [
    project.path,
    workflow.id,
    action.stage,
    action.checkpoint,
  ].join(':');
  const runnerState = {
    inFlightWorkflowKeys: new Set(),
    inFlightKeys: new Set(),
    completedKeys: new Set([actionKey]),
  };

  assert.deepEqual(
    evaluateWorkflowActionDedup({ project, workflow, action, runnerState }),
    { shouldSkip: false, recoveryRequired: true, reason: 'index_missing' },
  );

  const workflowWithRecoveredReview = {
    ...workflow,
    chat: {
      ...workflow.chat,
      4: {
        sessionId: 'review-after-repair',
        stageKey: 'review_1',
      },
    },
  };

  assert.deepEqual(
    evaluateWorkflowActionDedup({
      project,
      workflow: workflowWithRecoveredReview,
      action,
      runnerState,
    }),
    { shouldSkip: true, reason: 'indexed_action_already_completed' },
  );
});
