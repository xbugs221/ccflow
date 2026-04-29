/**
 * PURPOSE: Acceptance tests for workflow-owned chat records in conf.json v2.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  addProjectManually,
  createManualSessionDraft,
  finalizeManualSessionDraft,
  loadProjectConfig,
  saveProjectConfig,
} from '../../server/projects.js';
import {
  createProjectWorkflow,
  deleteWorkflow,
} from '../../server/workflows.js';
import {
  readProjectConf,
  withIsolatedProject,
} from './helpers/conf-v2-fixtures.js';

test('Scenario: 新建工作流时使用数字 key 推导 wN', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Workflow Conf V2 Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '规划会话', {
      workflowId: 'w1',
      stageKey: 'planning',
    });

    const persisted = await readProjectConf(projectPath);
    assert.ok(persisted.workflows['1']);
    assert.equal('workflowId' in persisted.workflows['1'], false);
    assert.equal(persisted.workflows['1'].title, '工作流1');
  });
});

test('Scenario: 工作流内部会话按流程顺序编号', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Workflow Internal Ordering Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '规划会话', {
      workflowId: 'w1',
      stageKey: 'planning',
    });
    await createManualSessionDraft(project.name, projectPath, 'codex', '执行会话', {
      workflowId: 'w1',
      stageKey: 'execution',
    });
    await createManualSessionDraft(project.name, projectPath, 'claude', '审核1', {
      workflowId: 'w1',
      stageKey: 'review_1',
    });

    const workflowChat = (await readProjectConf(projectPath)).workflows['1'].chat;
    assert.equal(workflowChat['1'].title, '规划会话');
    assert.equal(workflowChat['2'].title, '执行会话');
    assert.equal(workflowChat['3'].title, '审核1');
    assert.equal(workflowChat['1'].sessionId.startsWith('c'), true);
    assert.equal(workflowChat['2'].sessionId.startsWith('c'), true);
    assert.equal(workflowChat['3'].sessionId.startsWith('c'), true);
  });
});

test('Scenario: 工作流内部草稿 finalize', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Workflow Draft Finalize Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '执行会话', {
      workflowId: 'w1',
      stageKey: 'execution',
    });

    await finalizeManualSessionDraft(project.name, draft.id, 'workflow-child-real-1', 'codex', projectPath);
    const persisted = await readProjectConf(projectPath);

    assert.equal(persisted.workflows['1'].chat['1'].sessionId, 'workflow-child-real-1');
    assert.equal(persisted.workflows['1'].chat['1'].title, '执行会话');
    assert.equal(persisted.chat?.['1'], undefined);
  });
});

test('Scenario: 工作流内部会话不推进手动会话编号', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Workflow Does Not Consume Chat Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '执行会话', {
      workflowId: 'w1',
      stageKey: 'execution',
    });
    await createManualSessionDraft(project.name, projectPath, 'claude', '审核1', {
      workflowId: 'w1',
      stageKey: 'review_1',
    });

    const manualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    const persisted = await readProjectConf(projectPath);
    assert.equal(manualDraft.id, 'c1');
    assert.equal(persisted.chat['1'].sessionId, 'c1');
    assert.equal(Object.keys(persisted.workflows['1'].chat).length, 2);
  });
});

test('Scenario: 工作流写入后项目配置保存不刷新 conf.json', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        1: { sessionId: 'codex-terminal-1', title: '终端会话1' },
      },
    }, projectPath);

    await createProjectWorkflow({ fullPath: projectPath }, { title: '需求1', objective: '需求1' });
    const confPath = path.join(projectPath, '.ccflow', 'conf.json');
    const firstStat = await fs.stat(confPath);

    await saveProjectConfig(await loadProjectConfig(projectPath), projectPath);
    const secondStat = await fs.stat(confPath);

    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
  });
});

test('Scenario: 删除工作流时同步删除该工作流产物目录', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Workflow Artifact Cleanup Demo');
    const workflow = await createProjectWorkflow(project, {
      title: '清理旧产物',
      objective: '删除工作流后不能复用旧审核产物',
    });
    const artifactDir = path.join(projectPath, '.ccflow', '1');

    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(path.join(artifactDir, 'review-1.json'), '{"decision":"pass"}\n', 'utf8');

    assert.equal(await deleteWorkflow(project, workflow.id), true);
    await assert.rejects(fs.stat(artifactDir), { code: 'ENOENT' });
  });
});
