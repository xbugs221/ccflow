/**
 * PURPOSE: Acceptance tests for recovering workflow child-session indexes when
 * auto-runner memory and provider session files drift from workflow control state.
 * Derived from openspec/changes/27-workflow-session-index-recovery/specs/workflow-session-index-recovery/spec.md.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Load the workflow session recovery API expected by this OpenSpec change.
 */
async function loadRecoveryApi() {
  const autoRunner = await import('../../server/workflow-auto-runner.js');
  const workflows = await import('../../server/workflows.js');
  return { autoRunner, workflows };
}

/**
 * Build a minimal workflow read model for one stage recovery scenario.
 */
function buildWorkflow(overrides = {}) {
  return {
    id: 'w1',
    title: '前端要整体渲染消息',
    stage: 'planning',
    stageStatuses: [
      { key: 'planning', label: '规划提案', status: 'active', provider: 'codex' },
      { key: 'execution', label: '执行', status: 'pending', provider: 'claude' },
    ],
    childSessions: [],
    chat: {},
    controllerEvents: [],
    ...overrides,
  };
}

/**
 * Build the action identity used by the auto-runner.
 */
function buildAction(stage = 'planning') {
  return { stage, checkpoint: `${stage}:w1` };
}

test('Scenario: completedKey 存在但 child session 索引缺失', async () => {
  const { autoRunner } = await loadRecoveryApi();
  assert.equal(typeof autoRunner.evaluateWorkflowActionDedup, 'function');

  const result = autoRunner.evaluateWorkflowActionDedup({
    project: { fullPath: '/tmp/project-a' },
    workflow: buildWorkflow(),
    action: buildAction('planning'),
    runnerState: { completedKeys: new Set(['/tmp/project-a:w1:planning:planning:w1']), inFlightKeys: new Set() },
  });

  assert.equal(result.shouldSkip, false);
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.reason, 'index_missing');
});

test('Scenario: completedKey 存在且 child session 索引有效', async () => {
  const { autoRunner } = await loadRecoveryApi();
  assert.equal(typeof autoRunner.evaluateWorkflowActionDedup, 'function');

  const workflow = buildWorkflow({
    childSessions: [{ id: 'codex-session-1', stageKey: 'planning', provider: 'codex', routeIndex: 1 }],
    chat: { 1: { sessionId: 'codex-session-1', stageKey: 'planning', provider: 'codex' } },
  });
  const result = autoRunner.evaluateWorkflowActionDedup({
    project: { fullPath: '/tmp/project-a' },
    workflow,
    action: buildAction('planning'),
    runnerState: { completedKeys: new Set(['/tmp/project-a:w1:planning:planning:w1']), inFlightKeys: new Set() },
  });

  assert.equal(result.shouldSkip, true);
  assert.equal(result.reason, 'indexed_action_already_completed');
  assert.deepEqual(workflow.childSessions.map((session) => session.id), ['codex-session-1']);
});

test('Scenario: completedKey 存在且 chat-only child session 索引有效', async () => {
  const { autoRunner } = await loadRecoveryApi();

  const workflow = buildWorkflow({
    childSessions: [],
    chat: { 1: { sessionId: 'codex-chat-only-1', stageKey: 'planning', provider: 'codex' } },
  });
  const result = autoRunner.evaluateWorkflowActionDedup({
    project: { fullPath: '/tmp/project-a' },
    workflow,
    action: buildAction('planning'),
    runnerState: { completedKeys: new Set(['/tmp/project-a:w1:planning:planning:w1']), inFlightKeys: new Set() },
  });

  assert.equal(result.shouldSkip, true);
  assert.equal(result.reason, 'indexed_action_already_completed');
});

test('Scenario: provider orphan 扫描限定当前项目并标记登记状态', async () => {
  const { autoRunner } = await loadRecoveryApi();
  assert.equal(typeof autoRunner.scanWorkflowProviderSessions, 'function');

  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), 'ccflow-provider-scan-'));
  process.env.HOME = home;
  try {
    const sessionDir = join(home, '.codex', 'sessions', '2026', '04', '30');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'codex-orphan-1.jsonl'),
      JSON.stringify({ cwd: '/tmp/project-a', text: 'workflow w1 planning 前端要整体渲染消息' }),
    );
    await writeFile(
      join(sessionDir, 'codex-other-project.jsonl'),
      JSON.stringify({ cwd: '/tmp/project-b', text: 'workflow w1 planning 前端要整体渲染消息' }),
    );

    const sessions = await autoRunner.scanWorkflowProviderSessions(
      { fullPath: '/tmp/project-a' },
      buildWorkflow({
        childSessions: [{ id: 'codex-registered-1', stageKey: 'planning', provider: 'codex', routeIndex: 1 }],
      }),
      { ...buildAction('planning'), provider: 'codex' },
    );

    assert.deepEqual(sessions.map((session) => session.id), ['codex-orphan-1']);
    assert.equal(sessions[0].stageKey, 'planning');
    assert.equal(sessions[0].registered, false);
  } finally {
    process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});

test('Scenario: 找到唯一高置信 orphan 会话', async () => {
  const { autoRunner } = await loadRecoveryApi();
  assert.equal(typeof autoRunner.recoverWorkflowActionSessionIndex, 'function');

  const result = await autoRunner.recoverWorkflowActionSessionIndex({
    project: { fullPath: '/tmp/project-a' },
    workflow: buildWorkflow({ stage: 'execution' }),
    action: buildAction('execution'),
    providerSessions: [
      {
        id: 'claude-orphan-1',
        provider: 'claude',
        projectPath: '/tmp/project-a',
        stageKey: 'execution',
        workflowId: 'w1',
        title: '前端要整体渲染消息',
        registered: false,
      },
    ],
  });

  assert.equal(result.decision, 'recover');
  assert.equal(result.sessionId, 'claude-orphan-1');
  assert.equal(result.event.type, 'orphan_recovered');
  assert.equal(result.createNewSession, false);
});

test('Scenario: 多个可疑 orphan 会话无法唯一绑定', async () => {
  const { autoRunner } = await loadRecoveryApi();
  assert.equal(typeof autoRunner.recoverWorkflowActionSessionIndex, 'function');

  const result = await autoRunner.recoverWorkflowActionSessionIndex({
    project: { fullPath: '/tmp/project-a' },
    workflow: buildWorkflow(),
    action: buildAction('planning'),
    providerSessions: [
      { id: 'codex-orphan-1', provider: 'codex', projectPath: '/tmp/project-a', stageKey: 'planning', registered: false },
      { id: 'codex-orphan-2', provider: 'codex', projectPath: '/tmp/project-a', stageKey: 'planning', registered: false },
    ],
  });

  assert.equal(result.decision, 'ambiguous');
  assert.equal(result.event.type, 'orphan_ambiguous');
  assert.equal(result.createNewSession, false);
});

test('Scenario: 隔离未登记候选但保留已登记会话', async () => {
  const { autoRunner } = await loadRecoveryApi();
  assert.equal(typeof autoRunner.planWorkflowProviderOrphanCleanup, 'function');

  const plan = await autoRunner.planWorkflowProviderOrphanCleanup({
    project: { fullPath: '/tmp/project-a' },
    workflow: buildWorkflow(),
    action: buildAction('planning'),
    providerSessions: [
      { id: 'codex-orphan-1', provider: 'codex', projectPath: '/tmp/project-a', stageKey: 'planning', registered: false },
      { id: 'codex-registered-1', provider: 'codex', projectPath: '/tmp/project-a', stageKey: 'planning', registered: true },
    ],
    registeredSessionIds: new Set(['codex-registered-1']),
  });

  assert.deepEqual(plan.quarantineSessionIds, ['codex-orphan-1']);
  assert.deepEqual(plan.protectedSessionIds, ['codex-registered-1']);
  assert.equal(plan.manifestRequired, true);
});

test('Scenario: 没有可疑 provider 会话时直接允许重建', async () => {
  const { autoRunner } = await loadRecoveryApi();
  assert.equal(typeof autoRunner.recoverWorkflowActionSessionIndex, 'function');

  const result = await autoRunner.recoverWorkflowActionSessionIndex({
    project: { fullPath: '/tmp/project-a' },
    workflow: buildWorkflow(),
    action: buildAction('planning'),
    providerSessions: [],
  });

  assert.equal(result.decision, 'rebuild');
  assert.equal(result.clearDedupKey, true);
  assert.equal(result.event.type, 'session_rebuild_allowed');
});

test('Scenario: 索引缺失被检测到', async () => {
  const { workflows } = await loadRecoveryApi();
  assert.equal(typeof workflows.appendWorkflowControllerEvent, 'function');

  const workflow = workflows.appendWorkflowControllerEvent(buildWorkflow(), {
    type: 'index_missing',
    stageKey: 'planning',
    provider: 'codex',
    message: 'planning child session index is missing',
    createdAt: '2026-04-30T00:00:00.000Z',
  });

  assert.equal(workflow.controllerEvents.at(-1).type, 'index_missing');
  assert.equal(workflow.controllerEvents.at(-1).stageKey, 'planning');
  assert.equal(workflow.controllerEvents.at(-1).provider, 'codex');
  assert.ok(workflow.controllerEvents.at(-1).message);
  assert.ok(workflow.controllerEvents.at(-1).createdAt);
});

test('Scenario: orphan 会话被隔离后允许重建', async () => {
  const { workflows } = await loadRecoveryApi();
  assert.equal(typeof workflows.appendWorkflowControllerEvent, 'function');

  let workflow = buildWorkflow();
  workflow = workflows.appendWorkflowControllerEvent(workflow, {
    type: 'orphan_quarantined',
    stageKey: 'planning',
    provider: 'codex',
    sessionId: 'codex-orphan-1',
    message: 'orphan provider session quarantined before rebuild',
    createdAt: '2026-04-30T00:00:00.000Z',
  });
  workflow = workflows.appendWorkflowControllerEvent(workflow, {
    type: 'session_rebuilt',
    stageKey: 'planning',
    provider: 'codex',
    sessionId: 'codex-new-1',
    message: 'new workflow child session created',
    createdAt: '2026-04-30T00:00:01.000Z',
  });

  assert.deepEqual(workflow.controllerEvents.map((event) => event.type), [
    'orphan_quarantined',
    'session_rebuilt',
  ]);
  assert.equal(workflow.controllerEvents.at(-1).sessionId, 'codex-new-1');
});

test('Scenario: Claude stage 索引缺失时扫描 Claude provider 而非 Codex', async () => {
  const { autoRunner } = await loadRecoveryApi();

  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), 'ccflow-claude-scan-'));
  process.env.HOME = home;
  try {
    const claudeProjectDir = join(home, '.claude', 'projects', '-tmp-project-a');
    await mkdir(claudeProjectDir, { recursive: true });
    await writeFile(
      join(claudeProjectDir, 'claude-orphan-1.jsonl'),
      JSON.stringify({ text: 'workflow w1 execution 前端要整体渲染消息' }),
    );

    const workflow = buildWorkflow({
      stage: 'execution',
      stageStatuses: [
        { key: 'planning', label: '规划提案', status: 'completed', provider: 'codex' },
        { key: 'execution', label: '执行', status: 'active', provider: 'claude' },
      ],
      childSessions: [],
    });

    const sessions = await autoRunner.scanWorkflowProviderSessions(
      { fullPath: '/tmp/project-a' },
      workflow,
      { stage: 'execution', checkpoint: 'execution:w1' },
    );

    assert.deepEqual(sessions.map((session) => session.id), ['claude-orphan-1']);
    assert.equal(sessions[0].provider, 'claude');
  } finally {
    process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});

test('Scenario: repair_1 completed 后应返回带新 checkpoint 的 review_1', async () => {
  const { autoRunner } = await loadRecoveryApi();
  assert.equal(typeof autoRunner.evaluateWorkflowActionDedup, 'function');

  const workflow = buildWorkflow({
    stage: 'review_1',
    stageStatuses: [
      { key: 'planning', label: '规划提案', status: 'completed', provider: 'codex' },
      { key: 'execution', label: '执行', status: 'completed', provider: 'claude' },
      { key: 'review_1', label: '审核 1', status: 'completed', provider: 'codex' },
      { key: 'repair_1', label: '修复 1', status: 'completed', provider: 'codex' },
      { key: 'review_2', label: '审核 2', status: 'pending', provider: 'codex' },
    ],
    openspecTaskProgress: { totalTasks: 5, completedTasks: 5 },
    childSessions: [
      { id: 'review-1-session', stageKey: 'review_1', provider: 'codex', routeIndex: 1 },
      { id: 'repair-1-session', stageKey: 'repair_1', provider: 'codex', routeIndex: 2 },
    ],
  });

  const action = await autoRunner.resolveWorkflowAutoAction(
    { fullPath: '/tmp/project-a' },
    workflow,
  );

  assert.ok(action);
  assert.equal(action.stage, 'review_1');
  assert.equal(action.checkpoint, 'after-repair:repair-1-session');
  assert.equal(action.sessionId, undefined);
  assert.equal(action.routeIndex, undefined);

  const dedup = autoRunner.evaluateWorkflowActionDedup({
    project: { fullPath: '/tmp/project-a' },
    workflow,
    action,
    runnerState: {
      completedKeys: new Set(['/tmp/project-a:w1:review_1:review-1-session']),
      inFlightKeys: new Set(),
    },
  });
  assert.equal(dedup.shouldSkip, false);
  assert.equal(dedup.reason, 'not_started');
});

test('Scenario: 仅匹配项目路径无 workflow 标记的 Codex session 不应被恢复', async () => {
  const { autoRunner } = await loadRecoveryApi();

  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), 'ccflow-project-only-'));
  process.env.HOME = home;
  try {
    const sessionDir = join(home, '.codex', 'sessions', '2026', '04', '30');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'codex-project-only.jsonl'),
      JSON.stringify({ cwd: '/tmp/project-a', text: 'some unrelated conversation' }),
    );

    const sessions = await autoRunner.scanWorkflowProviderSessions(
      { fullPath: '/tmp/project-a' },
      buildWorkflow({
        id: 'w1',
        title: '前端要整体渲染消息',
        openspecChangeName: '27-workflow-session-index-recovery',
      }),
      { stage: 'planning', checkpoint: 'planning:w1' },
    );

    assert.deepEqual(sessions.map((session) => session.id), []);
  } finally {
    process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});
