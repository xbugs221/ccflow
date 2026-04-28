/**
 * PURPOSE: Verify chat session path resolution prefers explicit paths and
 * safely falls back to project-name lookup for new session requests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveChatProjectOptions } from '../../server/chat-project-path.js';

test('resolveChatProjectOptions preserves explicit cwd/projectPath', async () => {
  const result = await resolveChatProjectOptions(
    {
      cwd: '/tmp/feature-a',
      projectPath: '/tmp/feature-a',
      projectName: 'ignored-project',
    },
    async () => '/tmp/other-project',
  );

  assert.equal(result.cwd, '/tmp/feature-a');
  assert.equal(result.projectPath, '/tmp/feature-a');
});

test('resolveChatProjectOptions fills missing path from project name', async () => {
  const result = await resolveChatProjectOptions(
    {
      projectName: 'feature-a',
      sessionId: 'session-1',
    },
    async (projectName) => `/workspace/${projectName}`,
  );

  assert.equal(result.cwd, '/workspace/feature-a');
  assert.equal(result.projectPath, '/workspace/feature-a');
  assert.equal(result.sessionId, 'session-1');
});

test('resolveChatProjectOptions keeps original payload when project lookup fails', async () => {
  const options = {
    projectName: 'missing-project',
    model: 'gpt-5',
  };

  const result = await resolveChatProjectOptions(options, async () => {
    throw new Error('missing project');
  });

  assert.deepEqual(result, options);
});
