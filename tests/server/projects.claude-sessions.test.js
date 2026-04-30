/**
 * PURPOSE: Verify Claude JSONL session parsing keeps real message timestamps.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getSessionMessages, parseJsonlSessions } from '../../server/projects.js';

/**
 * Create a temporary Claude JSONL file for parser-focused tests.
 */
async function withTemporaryJsonl(content, testBody) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-claude-session-test-'));
  const filePath = path.join(tempDir, 'session.jsonl');

  try {
    await fs.writeFile(filePath, content, 'utf8');
    await testBody(filePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Run a test against an isolated HOME so Claude project files are local.
 */
async function withTemporaryHome(testBody) {
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-claude-home-test-'));

  try {
    process.env.HOME = tempHome;
    await testBody(tempHome);
  } finally {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

test('Claude session creation time uses first valid JSONL timestamp', async () => {
  const sessionId = '2450187a-d31e-41f3-9dd2-4e8d114f811b';
  const firstTimestamp = '2026-04-27T06:00:09.626Z';
  const lastTimestamp = '2026-04-27T07:34:37.745Z';
  const content = [
    JSON.stringify({
      type: 'permission-mode',
      sessionId,
    }),
    JSON.stringify({
      type: 'user',
      sessionId,
      timestamp: firstTimestamp,
      cwd: '/tmp/project',
      message: {
        role: 'user',
        content: 'Start the task',
      },
    }),
    JSON.stringify({
      type: 'assistant',
      sessionId,
      timestamp: lastTimestamp,
      cwd: '/tmp/project',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done' }],
      },
    }),
  ].join('\n') + '\n';

  await withTemporaryJsonl(content, async (filePath) => {
    const result = await parseJsonlSessions(filePath);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].createdAt.toISOString(), firstTimestamp);
    assert.equal(result.sessions[0].lastActivity.toISOString(), lastTimestamp);
  });
});

test('Claude fallback session messages keep line identities across pagination', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectName = 'fallback-project';
    const sessionId = '2450187a-d31e-41f3-9dd2-4e8d114f811b';
    const otherSessionId = '8e473608-e105-4bda-a474-b0a7e45cb26c';
    const projectDir = path.join(homeDir, '.claude', 'projects', projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const content = [
      { type: 'user', sessionId, timestamp: '2026-04-27T06:00:00.000Z', message: { role: 'user', content: 'one' } },
      { type: 'assistant', sessionId, timestamp: '2026-04-27T06:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'two' }] } },
      { type: 'user', sessionId: otherSessionId, timestamp: '2026-04-27T06:02:00.000Z', message: { role: 'user', content: 'other' } },
      { type: 'user', sessionId, timestamp: '2026-04-27T06:03:00.000Z', message: { role: 'user', content: 'three' } },
      { type: 'assistant', sessionId, timestamp: '2026-04-27T06:04:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'four' }] } },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    await fs.writeFile(path.join(projectDir, 'renamed-session-file.jsonl'), content, 'utf8');

    const latestPage = await getSessionMessages(projectName, sessionId, 2, 0);
    const olderPage = await getSessionMessages(projectName, sessionId, 2, 2);
    const afterCursor = await getSessionMessages(projectName, sessionId, null, 0, 2);

    assert.deepEqual(latestPage.messages.map((message) => message.__lineNumber), [4, 5]);
    assert.deepEqual(olderPage.messages.map((message) => message.__lineNumber), [1, 2]);
    assert.deepEqual(afterCursor.messages.map((message) => message.__lineNumber), [4, 5]);
    assert.equal(latestPage.total, 4);
    assert.equal(afterCursor.total, 4);
    assert.equal(
      new Set([...latestPage.messages, ...olderPage.messages].map((message) => message.messageKey)).size,
      4,
    );
  });
});
