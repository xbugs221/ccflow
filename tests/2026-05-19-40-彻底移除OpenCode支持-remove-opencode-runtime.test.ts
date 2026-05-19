/**
 * PURPOSE: Guard the runtime boundary after OpenCode support is removed.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { buildCoRequest, normalizeCoProviders } from '../server/co-client.ts';

const repoRoot = process.cwd();

async function readRuntimeFile(relativePath: string): Promise<string> {
  /**
   * Read a runtime source file from the repository root for static contracts.
   */
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('server runtime no longer exposes OpenCode routes, SDK, websocket commands, or provider whitelist', async () => {
  assert.equal(existsSync(path.join(repoRoot, 'server/routes/opencode.ts')), false);
  assert.equal(existsSync(path.join(repoRoot, 'server/opencode-sdk.ts')), false);

  const serverIndex = await readRuntimeFile('server/index.ts');
  assert.equal(serverIndex.includes('/api/cli/opencode'), false);
  assert.equal(serverIndex.includes('opencode-command'), false);

  const providerStatus = normalizeCoProviders({ codex: true, opencode: true, pi: true });
  assert.deepEqual(Object.keys(providerStatus).sort(), ['codex', 'pi']);
  assert.throws(
    () => buildCoRequest({
      requestId: 'r1',
      conversationId: 'c1',
      projectPath: repoRoot,
      provider: 'opencode',
      text: 'hello',
    }),
    /provider must be one of: codex, pi/,
  );
});

test('project and frontend runtime sources do not carry OpenCode provider fields', async () => {
  const runtimeFiles = [
    'server/projects.ts',
    'server/session-messages-handler.ts',
    'src/types/app.ts',
    'src/hooks/useProjectsState.ts',
    'src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx',
    'src/components/settings/constants/constants.ts',
  ];

  for (const relativePath of runtimeFiles) {
    const source = await readRuntimeFile(relativePath);
    assert.equal(source.includes('opencode'), false, `${relativePath} must not reference opencode`);
    assert.equal(source.includes('OpenCode'), false, `${relativePath} must not reference OpenCode`);
  }
});
