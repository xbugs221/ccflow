/**
 * PURPOSE: Verify Claude JSONL session parsing keeps real message timestamps.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseJsonlSessions } from '../../server/projects.js';

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
