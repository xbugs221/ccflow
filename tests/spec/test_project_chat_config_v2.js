/**
 * PURPOSE: Acceptance tests for project-chat-config-v2 OpenSpec scenarios.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  addProjectManually,
  createManualSessionDraft,
  deleteCodexSession,
  finalizeManualSessionDraft,
  loadProjectConfig,
  saveProjectConfig,
  updateSessionModelState,
  updateSessionUiState,
} from '../../server/projects.js';
import {
  readProjectConf,
  withIsolatedProject,
} from './helpers/conf-v2-fixtures.js';

test('Scenario: 保存项目配置时写入 v2 分组结构', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await createManualSessionDraft(project.name, projectPath, 'codex', '执行会话', {
      workflowId: 'w1',
      stageKey: 'execution',
      substageKey: 'node_execution',
    });

    const persisted = await readProjectConf(projectPath);
    assert.equal(persisted.schemaVersion, 2);
    assert.ok(persisted.chat?.['1']);
    assert.ok(persisted.workflows?.['1']?.chat?.['1']);
    assert.equal('manualSessionDrafts' in persisted, false);
    assert.equal('sessionRouteIndex' in persisted, false);
    assert.equal('sessionSummaryById' in persisted, false);
    assert.equal('sessionWorkflowMetadataById' in persisted, false);
    assert.equal('sessionModelStateById' in persisted, false);
    assert.equal('sessionUiStateByPath' in persisted, false);
  });
});

test('Scenario: 重复保存相同项目配置不会刷新 conf.json', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        1: { sessionId: 'codex-terminal-1', title: '终端会话1' },
      },
    }, projectPath);

    const confPath = new URL(`file://${projectPath}/.ccflow/conf.json`);
    const firstStat = await fs.stat(confPath);
    await saveProjectConfig(await loadProjectConfig(projectPath), projectPath);
    const secondStat = await fs.stat(confPath);
    const persisted = await fs.readFile(confPath, 'utf8');

    assert.equal(persisted.endsWith('\n'), true);
    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
  });
});

test('Scenario: 单条普通会话聚合所有展示状态', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Aggregate Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await updateSessionModelState(projectPath, draft.id, {
      model: 'gpt-5.5',
      reasoningEffort: 'low',
    });
    await updateSessionUiState(project.name, draft.id, 'codex', { favorite: true });

    const persisted = await readProjectConf(projectPath);
    assert.deepEqual(persisted.chat['1'], {
      sessionId: draft.id,
      title: '会话1',
      provider: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'low',
      ui: { favorite: true },
    });
    assert.equal(Object.prototype.hasOwnProperty.call(persisted.chat, draft.id), false);
  });
});

test('Scenario: 终端会话已占用编号后新建 WebUI 草稿', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Numbering Demo');
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        18: { sessionId: 'codex-terminal-18', title: '终端会话18', ui: {} },
        19: { sessionId: 'codex-terminal-19', title: '终端会话19', ui: {} },
      },
    }, projectPath);

    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话20');
    const persisted = await readProjectConf(projectPath);
    assert.equal(draft.id, 'c20');
    assert.equal(persisted.chat['20'].sessionId, 'c20');
    assert.equal(persisted.chat['18'].sessionId, 'codex-terminal-18');
    assert.equal(persisted.chat['19'].sessionId, 'codex-terminal-19');
  });
});

test('Scenario: 删除普通会话后编号不回收', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Non-Recycle Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await createManualSessionDraft(project.name, projectPath, 'codex', '会话2');
    const config = await loadProjectConfig(projectPath);
    delete config.chat['1'];
    await saveProjectConfig(config, projectPath);

    const nextDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话3');
    const persisted = await readProjectConf(projectPath);
    assert.equal(nextDraft.id, 'c3');
    assert.equal(persisted.chat['3'].sessionId, 'c3');
    assert.equal('1' in persisted.chat, false);
  });
});

test('Scenario: WebUI 普通草稿 finalize', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Finalize Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await updateSessionModelState(projectPath, draft.id, {
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
    });

    const finalized = await finalizeManualSessionDraft(
      project.name,
      draft.id,
      'codex-real-session-1',
      'codex',
      projectPath,
    );
    const persisted = await readProjectConf(projectPath);

    assert.equal(finalized, true);
    assert.equal(persisted.chat['1'].sessionId, 'codex-real-session-1');
    assert.equal(persisted.chat['1'].title, '会话1');
    assert.equal(persisted.chat['1'].model, 'gpt-5.5');
    assert.equal(persisted.chat['1'].reasoningEffort, 'medium');
  });
});

test('Scenario: 草稿未发送真实请求', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Draft Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');

    const persisted = await readProjectConf(projectPath);
    assert.equal(persisted.chat['1'].sessionId, draft.id);
    assert.equal(persisted.chat['1'].title, '会话1');
  });
});

test('Scenario: 删除没有 JSONL 的 Codex 空会话记录', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        52: { sessionId: 'c52', title: '会话52' },
      },
    }, projectPath);

    const deleted = await deleteCodexSession('c52', projectPath);
    const persisted = await readProjectConf(projectPath);

    assert.equal(deleted, true);
    assert.equal(persisted.chat, undefined);
  });
});
