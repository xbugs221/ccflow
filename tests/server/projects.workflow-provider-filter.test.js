/**
 * PURPOSE: Verify provider-aware workflow child filtering for project Claude
 * sessions so Codex runner threads never hide same-id manual Claude chats.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

/**
 * Encode a project path the same way Claude stores project directories.
 */
function encodeClaudeProjectName(projectPath) {
  return projectPath.replace(/\//g, '-');
}

/**
 * Write one minimal Claude JSONL session.
 */
async function writeClaudeSession(homeDir, projectPath, sessionId, message) {
  const projectName = encodeClaudeProjectName(projectPath);
  const sessionDir = path.join(homeDir, '.claude', 'projects', projectName);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        sessionId,
        cwd: projectPath,
        timestamp: '2026-05-06T10:00:00.000Z',
        parentUuid: null,
        uuid: `${sessionId}-user-1`,
        type: 'user',
        message: { role: 'user', content: message },
      }),
      JSON.stringify({
        sessionId,
        cwd: projectPath,
        timestamp: '2026-05-06T10:00:01.000Z',
        type: 'assistant',
        message: { role: 'assistant', content: `${message} reply` },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

test('Claude manual session remains visible when only a Codex workflow child has the same id', async () => {
  const previousHome = process.env.HOME;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-provider-filter-'));
  const projectPath = path.join(tempRoot, 'workspace', 'project-a');
  const projectName = encodeClaudeProjectName(projectPath);

  process.env.HOME = tempRoot;
  try {
    await fs.mkdir(path.join(projectPath, '.ccflow'), { recursive: true });
    await writeClaudeSession(tempRoot, projectPath, 'shared-thread', 'same id manual Claude session');
    await writeClaudeSession(tempRoot, projectPath, 'claude-workflow-thread', 'workflow Claude session');
    await writeClaudeSession(tempRoot, projectPath, 'manual-thread', 'standalone manual session');
    await fs.writeFile(
      path.join(projectPath, '.ccflow', 'conf.json'),
      JSON.stringify({
        schemaVersion: 2,
        workflows: {
          1: {
            title: 'Provider filter',
            chat: {
              1: { sessionId: 'shared-thread', provider: 'codex', stageKey: 'execution' },
              2: { sessionId: 'claude-workflow-thread', provider: 'claude', stageKey: 'planning' },
            },
          },
        },
      }),
      'utf8',
    );

    const importKey = encodeURIComponent(`${tempRoot}-provider-filter`);
    const { getSessions } = await import(`../../server/projects.js?provider=${importKey}`);
    const result = await getSessions(projectName, 10, 0, {
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const sessionIds = result.sessions.map((session) => session.id);
    assert.ok(sessionIds.includes('shared-thread'));
    assert.ok(sessionIds.includes('manual-thread'));
    assert.equal(sessionIds.includes('claude-workflow-thread'), false);
  } finally {
    process.env.HOME = previousHome;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
