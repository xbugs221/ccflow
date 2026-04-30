/**
 * PURPOSE: Acceptance tests for exposing workflow child-session index recovery
 * state through the project workflow control plane read model.
 * Derived from openspec/changes/27-workflow-session-index-recovery/specs/project-workflow-control-plane/spec.md.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Load the workflow control-plane API expected by this OpenSpec change.
 */
async function loadWorkflowApi() {
  return import('../../server/workflows.js');
}

/**
 * Build a minimal workflow read model with controller event state.
 */
function buildWorkflow(overrides = {}) {
  return {
    id: 'w1',
    title: '前端要整体渲染消息',
    stage: 'planning',
    childSessions: [],
    controllerEvents: [],
    stageWarnings: [],
    ...overrides,
  };
}

test('Scenario: 控制面工作流详情展示阶段与子会话入口', async () => {
  const workflows = await loadWorkflowApi();
  assert.equal(typeof workflows.buildWorkflowControlPlaneReadModel, 'function');

  const readModel = workflows.buildWorkflowControlPlaneReadModel(buildWorkflow({
    childSessions: [{ id: 'codex-session-1', stageKey: 'planning', provider: 'codex', routeIndex: 1 }],
  }));

  assert.ok(readModel.stageTree);
  assert.ok(readModel.stageTree.find((stage) => stage.key === 'planning'));
  assert.equal(readModel.stageTree.find((stage) => stage.key === 'planning').childSessionId, 'codex-session-1');
  assert.ok(readModel.stageTree.find((stage) => stage.key === 'planning').openSessionUrl);
});

test('Scenario: 控制面展示内部会话索引异常', async () => {
  const workflows = await loadWorkflowApi();
  assert.equal(typeof workflows.buildWorkflowControlPlaneReadModel, 'function');

  const readModel = workflows.buildWorkflowControlPlaneReadModel(buildWorkflow({
    controllerEvents: [
      {
        type: 'index_missing',
        stageKey: 'planning',
        provider: 'codex',
        message: 'planning child session index is missing',
        createdAt: '2026-04-30T00:00:00.000Z',
      },
    ],
  }));

  const warning = readModel.stageTree.find((stage) => stage.key === 'planning').warnings[0];
  assert.equal(warning.type, 'index_missing');
  assert.equal(warning.provider, 'codex');
  assert.notEqual(readModel.stageTree.find((stage) => stage.key === 'planning').status, 'completed');
});

test('Scenario: 控制面展示恢复后的内部会话', async () => {
  const workflows = await loadWorkflowApi();
  assert.equal(typeof workflows.buildWorkflowControlPlaneReadModel, 'function');

  const readModel = workflows.buildWorkflowControlPlaneReadModel(buildWorkflow({
    childSessions: [{ id: 'codex-recovered-1', stageKey: 'planning', provider: 'codex', routeIndex: 1 }],
    controllerEvents: [
      {
        type: 'orphan_recovered',
        stageKey: 'planning',
        provider: 'codex',
        sessionId: 'codex-recovered-1',
        message: 'orphan session recovered',
        createdAt: '2026-04-30T00:00:00.000Z',
      },
    ],
  }));

  const planning = readModel.stageTree.find((stage) => stage.key === 'planning');
  assert.equal(planning.childSessionId, 'codex-recovered-1');
  assert.equal(planning.recoveryEvents[0].type, 'orphan_recovered');
  assert.equal(planning.duplicateAutoStartAllowed, false);
});

test('Scenario: 工作流详情 API 返回索引异常和恢复事件', async () => {
  const workflows = await loadWorkflowApi();
  assert.equal(typeof workflows.getProjectWorkflow, 'function');

  const projectPath = await mkdtemp(join(tmpdir(), 'ccflow-control-plane-'));
  try {
    await mkdir(join(projectPath, '.ccflow'), { recursive: true });
    await writeFile(join(projectPath, '.ccflow', 'conf.json'), `${JSON.stringify({
      workflows: {
        1: {
          title: '恢复控制面详情',
          stage: 'planning',
          chat: {
            1: {
              sessionId: 'codex-recovered-1',
              stageKey: 'planning',
              provider: 'codex',
              title: '规划恢复会话',
            },
          },
          controllerEvents: [
            {
              type: 'index_missing',
              stageKey: 'planning',
              provider: 'codex',
              message: 'planning child session index is missing',
              createdAt: '2026-04-30T00:00:00.000Z',
            },
            {
              type: 'orphan_recovered',
              stageKey: 'planning',
              provider: 'codex',
              sessionId: 'codex-recovered-1',
              message: 'orphan session recovered',
              createdAt: '2026-04-30T00:01:00.000Z',
            },
          ],
        },
      },
    }, null, 2)}\n`, 'utf8');

    const workflow = await workflows.getProjectWorkflow({ fullPath: projectPath }, 'w1');
    const planning = workflow.stageInspections.find((stage) => stage.stageKey === 'planning');

    assert.equal(planning.warnings[0].type, 'index_missing');
    assert.equal(planning.recoveryEvents[0].type, 'orphan_recovered');
    assert.equal(workflow.controlPlaneReadModel.stageTree.find((stage) => stage.key === 'planning').childSessionId, 'codex-recovered-1');
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
