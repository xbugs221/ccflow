/**
 * PURPOSE: Acceptance tests for project-chat-config-v2 OpenSpec scenarios.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  addProjectManually,
  createManualSessionDraft,
  deleteCodexSession,
  finalizeManualSessionDraft,
  getSessions,
  loadProjectConfig,
  saveProjectConfig,
  updateSessionModelState,
  updateSessionUiState,
} from '../../server/projects.js';
import {
  readProjectConf,
  withIsolatedProject,
  writeActiveOpenSpecChange,
} from './helpers/conf-v2-fixtures.js';
import {
  advanceWorkflow,
  buildWorkflowLauncherConfig,
  createProjectWorkflow,
} from '../../server/workflows.js';

test('Scenario: 保存项目配置时写入 v2 分组结构', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await createManualSessionDraft(project.name, projectPath, 'codex', '执行会话', {
      workflowId: 'w1',
      stageKey: 'execution',
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

test('Scenario: 保存普通会话配置不会清空已有 workflow 配置', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      workflows: {
        1: {
          title: '清理技术债',
          stage: 'execution',
          runState: 'running',
          providers: {
            planning: 'claude',
            execution: 'claude',
          },
          chat: {
            1: {
              sessionId: 'workflow-execution-session',
              title: '执行阶段',
            },
          },
        },
      },
    }, projectPath);

    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        1: {
          sessionId: 'codex-terminal-1',
          title: '普通会话',
        },
      },
    }, projectPath);

    const persisted = await readProjectConf(projectPath);

    assert.ok(persisted.workflows?.['1']);
    assert.equal(persisted.workflows['1'].title, '清理技术债');
    assert.deepEqual(persisted.workflows['1'].providers, {
      planning: 'claude',
      execution: 'claude',
    });
    assert.equal(persisted.workflows['1'].chat['1'].sessionId, 'workflow-execution-session');
    assert.equal(persisted.chat['1'].sessionId, 'codex-terminal-1');
  });
});

test('Scenario: workflow 归一化精简派生字段', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      workflows: {
        2: {
          title: '清理技术债',
          legacyWorkflowId: 'w2',
          routeIndex: 2,
          openspecChangePrefix: '1',
          openspecChangeName: '1-clean-debt',
          stage: 'archive',
          openspecChangeDetected: true,
          openspecTaskProgress: { completedTasks: 1, totalTasks: 1 },
          stageStatuses: [
            { key: 'planning', label: '规划提案', status: 'completed', provider: 'codex' },
            { key: 'execution', label: '执行', status: 'completed', provider: 'claude' },
            { key: 'review_1', label: '初审', status: 'completed', provider: 'codex' },
            { key: 'repair_1', label: '初修', status: 'completed', provider: 'codex' },
            { key: 'review_2', label: '再审', status: 'completed', provider: 'codex' },
            { key: 'repair_2', label: '再修', status: 'completed', provider: 'codex' },
            { key: 'review_3', label: '三审', status: 'completed', provider: 'codex' },
            { key: 'repair_3', label: '三修', status: 'pending', provider: 'codex' },
            { key: 'archive', label: '归档', status: 'active', provider: 'claude' },
          ],
          chat: {
            1: {
              sessionId: 'c1',
              title: '提案落地：清理技术债',
              summary: '提案落地：清理技术债',
              provider: 'claude',
              stageKey: 'execution',
            },
          },
        },
      },
    }, projectPath);

    const confPath = new URL(`file://${projectPath}/.ccflow/conf.json`);
    const firstStat = await fs.stat(confPath);
    await saveProjectConfig(await loadProjectConfig(projectPath), projectPath);
    const secondStat = await fs.stat(confPath);
    const persisted = await readProjectConf(projectPath);

    assert.equal('legacyWorkflowId' in persisted.workflows['2'], false);
    assert.equal('routeIndex' in persisted.workflows['2'], false);
    assert.equal('stageStatuses' in persisted.workflows['2'], false);
    assert.equal('openspecChangeDetected' in persisted.workflows['2'], false);
    assert.equal('openspecTaskProgress' in persisted.workflows['2'], false);
    assert.equal('openspecChangePrefix' in persisted.workflows['2'], false);
    assert.deepEqual(persisted.workflows['2'].providers, {
      execution: 'claude',
      archive: 'claude',
    });
    assert.deepEqual(persisted.workflows['2'].stageState, {
      repair_3: 'pending',
    });
    assert.equal('summary' in persisted.workflows['2'].chat['1'], false);
    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
  });
});

test('Scenario: Go-backed workflow 推进时固定 Codex provider', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Workflow Provider Demo');
    const changeName = await writeActiveOpenSpecChange(projectPath, 'provider-fixed-codex');
    const workflow = await createProjectWorkflow(project, {
      title: '多 Claude 阶段',
      objective: '验证 Go runner 自动阶段不会使用旧 provider 覆盖',
      openspecChangeName: changeName,
      stageProviders: {
        planning: 'claude',
        execution: 'claude',
        archive: 'claude',
      },
    });

    const advanced = await advanceWorkflow(project, workflow.id);
    const persisted = await readProjectConf(projectPath);

    assert.equal(advanced.stageStatuses.find((stage) => stage.key === 'execution').provider, 'codex');
    assert.equal('providers' in persisted.workflows['1'], false);
    assert.equal(persisted.workflows['1'].runner, 'go');
    assert.equal(persisted.workflows['1'].runnerProvider, 'codex');
  });
});

test('Scenario: workflow 归档启动提示词要求 delivery summary', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Archive Prompt Demo');
    await saveProjectConfig({
      schemaVersion: 2,
      workflows: {
        1: {
          title: '清理技术债',
          openspecChangeName: '1-clean-debt',
          stage: 'archive',
        },
      },
    }, projectPath);

    const launcher = await buildWorkflowLauncherConfig(project, 'w1', 'archive');

    assert.equal(launcher.workflowStageKey, 'archive');
    assert.match(launcher.autoPrompt, /delivery-summary\.md/);
    assert.match(launcher.autoPrompt, /必须生成或更新/);
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

test('Scenario: v2 会话 UI 状态按 provider 和项目路径写入并回读', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Session UI Provider Demo');
    const codexDraft = await createManualSessionDraft(project.name, projectPath, 'codex', 'Codex 会话');
    const claudeDraft = await createManualSessionDraft(project.name, projectPath, 'claude', 'Claude 会话');

    await updateSessionUiState(project.name, codexDraft.id, 'codex', { favorite: true, hidden: true });
    await updateSessionUiState(project.name, claudeDraft.id, 'claude', { pending: true });

    const persisted = await readProjectConf(projectPath);
    assert.deepEqual(persisted.chat['1'].ui, { favorite: true, hidden: true });
    assert.equal(persisted.chat['1'].provider, 'codex');
    assert.deepEqual(persisted.chat['2'].ui, { pending: true });
    assert.equal(persisted.chat['2'].provider, 'claude');
    assert.equal('sessionUiStateByPath' in persisted, false);
  });
});

test('Scenario: provider 缺省的 v2 Claude chat ui 仍能回填到会话', async () => {
  await withIsolatedProject(async ({ homeDir, projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Providerless Claude UI Demo');
    const sessionId = 'providerless-claude-ui-session';
    const projectDir = path.join(homeDir, '.claude', 'projects', project.name);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          sessionId,
          cwd: projectPath,
          timestamp: '2026-05-06T01:00:00.000Z',
          type: 'user',
          message: {
            role: 'user',
            content: 'Providerless Claude UI state regression',
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    );
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        1: {
          sessionId,
          title: 'Providerless Claude UI state regression',
          ui: {
            favorite: true,
            hidden: true,
          },
        },
      },
    }, projectPath);

    const result = await getSessions(project.name, 10, 0, { includeHidden: true });
    const session = result.sessions.find((candidate) => candidate.id === sessionId);

    assert.equal(session?.favorite, true);
    assert.equal(session?.hidden, true);
  });
});

test('Scenario: legacy sessionUiStateByPath 归一化保存时合并到 v2 chat ui', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        1: {
          sessionId: 'legacy-codex-session',
          title: 'Legacy Codex 会话',
          provider: 'codex',
        },
      },
      sessionUiStateByPath: {
        [`codex:${projectPath}:legacy-codex-session`]: {
          favorite: true,
          hidden: true,
        },
      },
    }, projectPath);

    const persisted = await readProjectConf(projectPath);
    assert.deepEqual(persisted.chat['1'].ui, { favorite: true, hidden: true });
    assert.equal('sessionUiStateByPath' in persisted, false);
  });
});

test('Scenario: Claude 兼容思考深度随会话状态写入项目配置', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Claude Thinking Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'claude', 'Kimi 会话1');
    await updateSessionModelState(projectPath, draft.id, {
      model: 'kimi-k2',
      thinkingMode: 'high',
    });

    const persisted = await readProjectConf(projectPath);
    assert.equal(persisted.chat['1'].provider, 'claude');
    assert.equal(persisted.chat['1'].model, 'kimi-k2');
    assert.equal(persisted.chat['1'].thinkingMode, 'high');
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

test('Scenario: WebUI 草稿不会 finalize 到自身路由 id', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Self Finalize Guard Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');

    const finalized = await finalizeManualSessionDraft(
      project.name,
      draft.id,
      draft.id,
      'codex',
      projectPath,
    );
    const persisted = await readProjectConf(projectPath);

    assert.equal(finalized, false);
    assert.equal(persisted.chat['1'].sessionId, draft.id);
    assert.equal(persisted.chat['1'].title, '会话1');
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
