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

test('Scenario: 同一个 workflow 已有 action 运行时跳过后续 action', async () => {
  const { autoRunner } = await loadRecoveryApi();

  const result = autoRunner.evaluateWorkflowActionDedup({
    project: { fullPath: '/tmp/project-a' },
    workflow: buildWorkflow(),
    action: buildAction('execution'),
    runnerState: {
      completedKeys: new Set(),
      inFlightKeys: new Set(),
      inFlightWorkflowKeys: new Set(['/tmp/project-a:w1']),
    },
  });

  assert.equal(result.shouldSkip, true);
  assert.equal(result.reason, 'workflow_in_flight');

  const otherWorkflow = autoRunner.evaluateWorkflowActionDedup({
    project: { fullPath: '/tmp/project-a' },
    workflow: buildWorkflow({ id: 'w2' }),
    action: buildAction('planning'),
    runnerState: {
      completedKeys: new Set(),
      inFlightKeys: new Set(),
      inFlightWorkflowKeys: new Set(['/tmp/project-a:w1']),
    },
  });

  assert.equal(otherWorkflow.shouldSkip, false);
  assert.equal(otherWorkflow.reason, 'not_started');
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
      JSON.stringify({ cwd: '/tmp/project-a', text: '当前工作流上下文 workflow w1 planning 前端要整体渲染消息' }),
    );
    await writeFile(
      join(sessionDir, 'codex-other-project.jsonl'),
      JSON.stringify({ cwd: '/tmp/project-b', text: '当前工作流上下文 workflow w1 planning 前端要整体渲染消息' }),
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

test('Scenario: 发起新 action 前恢复未索引 Claude 修复会话', async () => {
  const { autoRunner, workflows } = await loadRecoveryApi();
  assert.equal(typeof autoRunner.recoverUnindexedWorkflowActionSession, 'function');

  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), 'ccflow-claude-repair-recovery-'));
  process.env.HOME = home;
  try {
    const projectPath = join(home, 'workspace', 'project');
    await mkdir(projectPath, { recursive: true });
    const project = { name: 'project', path: projectPath, fullPath: projectPath };
    const workflow = await workflows.createProjectWorkflow(project, {
      title: '更新',
      objective: '验证 Claude repair 会话索引恢复',
    });
    const encodedProjectPath = String(projectPath).replace(/\//g, '-');
    const claudeProjectDir = join(home, '.claude', 'projects', encodedProjectPath);
    await mkdir(claudeProjectDir, { recursive: true });
    await writeFile(
      join(claudeProjectDir, 'claude-repair-2.jsonl'),
      JSON.stringify({
        sessionId: 'claude-repair-2',
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '## Repair Target',
                '本轮不是首次落地，而是修复第 2 轮审核发现的问题。',
                '必须先阅读 .ccflow/1/review-2.json，把其中仍然有效的 findings 逐项关闭后再结束本轮。',
                '## Completion Rule',
                '完成修复后必须生成或更新 .ccflow/1/repair-2-summary.md，作为 repair_2 的完成产物。',
              ].join('\n'),
            },
          ],
        },
        type: 'user',
      }),
      'utf8',
    );

    const recovery = await autoRunner.recoverUnindexedWorkflowActionSession({
      project,
      workflow: {
        ...workflow,
        id: 'w1',
        title: '更新',
        openspecChangeName: '29-merge-upstream-critical-fixes',
        stageStatuses: [
          { key: 'repair_2', label: '再修', status: 'pending', provider: 'claude' },
        ],
        childSessions: [],
      },
      action: { stage: 'repair_2', provider: 'claude', checkpoint: 'after-review:review-2' },
      logger: { info() {}, warn() {} },
    });

    assert.equal(recovery.recovered, true);
    assert.equal(recovery.sessionId, 'claude-repair-2');

    const recoveredWorkflow = await workflows.getProjectWorkflow(project, 'w1');
    assert.equal(
      recoveredWorkflow.childSessions.some((session) => (
        session.id === 'claude-repair-2'
        && session.stageKey === 'repair_2'
        && session.provider === 'claude'
      )),
      true,
    );
  } finally {
    process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});

test('Scenario: Codex 恢复只使用首个用户 prompt，忽略后续 transcript workflow 输出', async () => {
  const { autoRunner } = await loadRecoveryApi();

  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), 'ccflow-codex-first-prompt-'));
  process.env.HOME = home;
  try {
    const sessionDir = join(home, '.codex', 'sessions', '2026', '05', '03');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'rollout-2026-05-03T00-00-00-false-review.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: 'false-review', cwd: '/tmp/project-a' },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'http://localhost:3001/Documents/ccflow/w1 检查这个工作流状态',
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            output: '当前工作流上下文 w1 review_3 前端要整体渲染消息 把审核结果写入 .ccflow/1/review-3.json 输出格式 findings',
          },
        }),
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(sessionDir, 'rollout-2026-05-03T00-00-01-real-review.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: 'real-review', cwd: '/tmp/project-a' },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: [
              '聚焦当前角度，尽可能严格地找出最近变更中需要改进的地方。',
              '',
              '把审核结果写入 .ccflow/1/review-3.json。',
              '输出格式：',
              '{"findings":[]}',
            ].join('\n'),
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const sessions = await autoRunner.scanWorkflowProviderSessions(
      { fullPath: '/tmp/project-a' },
      buildWorkflow({
        id: 'w1',
        routeIndex: 1,
        title: '前端要整体渲染消息',
        openspecChangeName: '27-workflow-session-index-recovery',
      }),
      { stage: 'review_3', checkpoint: 'pending-review:3', provider: 'codex' },
    );

    assert.deepEqual(sessions.map((session) => session.id), ['real-review']);
  } finally {
    process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
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
      JSON.stringify({ text: '当前工作流上下文 workflow w1 execution 前端要整体渲染消息' }),
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

test('Scenario: repair_1 completed 后应进入下一轮 review_2', async () => {
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
  assert.equal(action.stage, 'review_2');
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
