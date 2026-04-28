/**
 * PURPOSE: Acceptance tests for importing terminal Codex sessions into conf.json v2.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCodexSessions,
  saveProjectConfig,
} from '../../server/projects.js';
import {
  createCodexTranscript,
  readProjectConf,
  withIsolatedProject,
} from './helpers/conf-v2-fixtures.js';

test('Scenario: 终端 Codex 会话使用第一条用户指令作为标题', async () => {
  await withIsolatedProject(async ({ homeDir, projectPath }) => {
    await createCodexTranscript(
      homeDir,
      projectPath,
      'codex-terminal-real-1',
      '请重构 conf.json 会话配置',
    );

    await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    const persisted = await readProjectConf(projectPath);

    assert.equal(persisted.chat['1'].sessionId, 'codex-terminal-real-1');
    assert.equal(persisted.chat['1'].title, '请重构 conf.json 会话配置');
    assert.equal(Object.hasOwn(persisted.chat['1'], 'ui'), false);
  });
});

test('Scenario: 已导入终端会话不会重复分配编号', async () => {
  await withIsolatedProject(async ({ homeDir, projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        1: {
          sessionId: 'codex-terminal-real-1',
          title: '请重构 conf.json 会话配置',
        },
      },
    }, projectPath);
    await createCodexTranscript(
      homeDir,
      projectPath,
      'codex-terminal-real-1',
      '请重构 conf.json 会话配置',
    );

    await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    const persisted = await readProjectConf(projectPath);

    assert.deepEqual(Object.keys(persisted.chat), ['1']);
    assert.equal(persisted.chat['1'].sessionId, 'codex-terminal-real-1');
  });
});

test('Scenario: 终端会话不属于工作流', async () => {
  await withIsolatedProject(async ({ homeDir, projectPath }) => {
    await createCodexTranscript(
      homeDir,
      projectPath,
      'codex-terminal-real-standalone',
      '只在终端里问一个问题',
    );

    await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    const persisted = await readProjectConf(projectPath);

    assert.equal(persisted.chat['1'].sessionId, 'codex-terminal-real-standalone');
    assert.equal(persisted.workflows, undefined);
  });
});
