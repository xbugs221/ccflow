// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify destructive project deletion is guarded by active provider sessions.
 * These tests cover Codex/OpenCode sessions and manual drafts before config removal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addProjectManually,
  clearProjectDirectoryCache,
  createManualSessionDraft,
  deleteProject,
  isProjectEmpty,
  loadProjectConfig,
} from '../../server/projects.ts';

let homeIsolationQueue = Promise.resolve();

/**
 * Execute test logic under an isolated HOME and fake OpenCode CLI.
 */
async function withTemporaryHome(testBody) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    const originalOpenCodeCliPath = process.env.OPENCODE_CLI_PATH;
    const originalOpenCodeSessions = process.env.CCFLOW_OPENCODE_SESSIONS;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cbw-project-delete-test-'));
    const binDir = path.join(tempHome, 'bin');

    await writeFakeOpenCodeCli(binDir);
    process.env.HOME = tempHome;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
    process.env.OPENCODE_CLI_PATH = path.join(binDir, 'opencode');
    process.env.CCFLOW_OPENCODE_SESSIONS = '[]';
    clearProjectDirectoryCache();

    try {
      await testBody(tempHome);
    } finally {
      clearProjectDirectoryCache();
      process.env.PATH = originalPath || '';
      restoreEnvValue('HOME', originalHome);
      restoreEnvValue('OPENCODE_CLI_PATH', originalOpenCodeCliPath);
      restoreEnvValue('CCFLOW_OPENCODE_SESSIONS', originalOpenCodeSessions);
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  };

  const runPromise = homeIsolationQueue.then(run, run);
  homeIsolationQueue = runPromise.catch(() => {});
  return runPromise;
}

/**
 * Restore an environment variable to its prior process value.
 */
function restoreEnvValue(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

/**
 * Write a minimal OpenCode executable that returns JSON session fixtures.
 */
async function writeFakeOpenCodeCli(binDir) {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'opencode'),
    [
      '#!/usr/bin/env node',
      "process.stdout.write(process.env.CCFLOW_OPENCODE_SESSIONS || '[]');",
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/**
 * Create a minimal Codex session JSONL file bound to a project path.
 */
async function createCodexSessionFile(homeDir, projectPath, sessionId) {
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '03', '05');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-03-05T08:00:00.000Z',
        payload: {
          id: sessionId,
          cwd: projectPath,
          model: 'gpt-5',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-03-05T08:01:00.000Z',
        payload: {
          type: 'user_message',
          message: 'hello',
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );

  return sessionPath;
}

/**
 * Assert delete guard errors without printing expected rejection logs.
 */
async function assertDeleteWithoutForceRejects(projectName) {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      () => deleteProject(projectName, false),
      /Cannot delete project with existing sessions/,
    );
  } finally {
    console.error = originalConsoleError;
  }
}

test('Codex-only project cannot be deleted without force', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-delete-guard');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Delete Guard');
    const sessionPath = await createCodexSessionFile(tempHome, projectPath, 'codex-delete-guard-session');

    assert.equal(await isProjectEmpty(project.name), false);
    await assertDeleteWithoutForceRejects(project.name);

    const config = await loadProjectConfig();
    assert.ok(config[project.name]);
    await assert.doesNotReject(fs.access(sessionPath));
  });
});

test('OpenCode-only project cannot be deleted without force', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'opencode-delete-guard');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'OpenCode Delete Guard');
    process.env.CCFLOW_OPENCODE_SESSIONS = JSON.stringify([
      {
        id: 'opencode-delete-guard-session',
        title: 'OpenCode active session',
        directory: projectPath,
        created: '2026-03-05T08:00:00.000Z',
        updated: '2026-03-05T08:01:00.000Z',
      },
    ]);

    assert.equal(await isProjectEmpty(project.name), false);
    await assertDeleteWithoutForceRejects(project.name);

    const config = await loadProjectConfig();
    assert.ok(config[project.name]);
  });
});

test('project with manual OpenCode draft cannot be deleted without force', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'manual-draft-delete-guard');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Manual Draft Delete Guard');
    await createManualSessionDraft(project.name, projectPath, 'opencode', '会话1');

    assert.equal(await isProjectEmpty(project.name), false);
    await assertDeleteWithoutForceRejects(project.name);

    const config = await loadProjectConfig();
    assert.ok(config[project.name]);
  });
});
