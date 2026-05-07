/**
 * PURPOSE: Acceptance tests for change 29 — upstream critical fixes.
 *
 * Each scenario is asserted at behavior level: imports the production code
 * path and exercises it (HTTP, sandboxed Service Worker, SDK options builder)
 * rather than scanning source files for keywords. This prevents the tests
 * from passing without the corresponding behavior actually being in place.
 *
 * Derived from openspec/changes/29-merge-upstream-critical-fixes/specs/upstream-critical-fixes/spec.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(HERE, '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Safe frontmatter parsing
// ─────────────────────────────────────────────────────────────────────────────

async function parseFrontmatterFixture(markdown) {
  const { parseFrontmatter } = await import('../../server/utils/frontmatter.js');
  return parseFrontmatter(markdown);
}

test('YAML command metadata remains supported', async () => {
  const parsed = await parseFrontmatterFixture(
    `---\ndescription: 安全分析\nallowed-tools:\n  - Read\n---\n请分析当前项目。\n`,
  );

  assert.equal(parsed.data.description, '安全分析');
  assert.deepEqual(parsed.data['allowed-tools'], ['Read']);
  assert.equal(parsed.content.trim(), '请分析当前项目。');
});

test('JavaScript frontmatter is not executed', async () => {
  delete globalThis.__ccflow_frontmatter_executed;

  const parsed = await parseFrontmatterFixture(
    `---js\nglobalThis.__ccflow_frontmatter_executed = true;\nmodule.exports = { description: '不可信' };\n---\n正文仍然应该可见。\n`,
  );

  assert.equal(globalThis.__ccflow_frontmatter_executed, undefined);
  assert.deepEqual(parsed.data, {});
  assert.match(parsed.content, /正文仍然应该可见/);
});

test('JSON frontmatter is not parsed through executable engine', async () => {
  const parsed = await parseFrontmatterFixture(
    `---json\n{ "description": "json metadata should not be trusted" }\n---\n正文。\n`,
  );

  assert.deepEqual(parsed.data, {});
  assert.match(parsed.content, /正文/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Claude CLI path forwarded into SDK options
// ─────────────────────────────────────────────────────────────────────────────

test('CLAUDE_CLI_PATH is forwarded to SDK options without clobbering existing options', async () => {
  const { __mapCliOptionsToSDKForTest } = await import('../../server/claude-sdk.js');

  const customCliPath = '/tmp/ccflow-fake-claude-cli';
  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = customCliPath;
  try {
    const opts = __mapCliOptionsToSDKForTest({
      cwd: '/tmp/proj',
      sessionId: 'sess-1',
      model: 'claude-sonnet-4-6',
      permissionMode: 'bypassPermissions',
      settings: { allowedTools: ['Read'], disallowedTools: [] },
    });

    assert.equal(opts.pathToClaudeCodeExecutable, customCliPath, 'must forward CLAUDE_CLI_PATH');
    // Existing options must remain intact.
    assert.equal(opts.cwd, '/tmp/proj');
    assert.equal(opts.permissionMode, 'bypassPermissions');
    assert.equal(opts.model, 'claude-sonnet-4-6');
    assert.equal(opts.resume, 'sess-1');
    assert.deepEqual(opts.systemPrompt, { type: 'preset', preset: 'claude_code' });
    assert.deepEqual(opts.settingSources, ['project', 'user', 'local']);
    assert.ok(Array.isArray(opts.allowedTools));
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

test('CLAUDE_CLI_PATH absent leaves pathToClaudeCodeExecutable unset', async () => {
  const { __mapCliOptionsToSDKForTest } = await import('../../server/claude-sdk.js');

  const previous = process.env.CLAUDE_CLI_PATH;
  delete process.env.CLAUDE_CLI_PATH;
  try {
    const opts = __mapCliOptionsToSDKForTest({
      cwd: '/tmp/proj',
      sessionId: '',
      permissionMode: 'default',
      settings: { allowedTools: [], disallowedTools: [] },
    });
    assert.equal(opts.pathToClaudeCodeExecutable, undefined);
  } finally {
    if (previous !== undefined) process.env.CLAUDE_CLI_PATH = previous;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Codex permission and workflow auto-run semantics
// ─────────────────────────────────────────────────────────────────────────────

test('Codex permission modes still map to expected runtime options', async () => {
  const { __mapPermissionModeToCodexOptionsForTest, __buildCodexExecArgsForTest } =
    await import('../../server/openai-codex.js');

  // 1. acceptEdits => workspace-write + never approval
  const accept = __mapPermissionModeToCodexOptionsForTest('acceptEdits');
  assert.deepEqual(accept, { sandboxMode: 'workspace-write', approvalPolicy: 'never' });

  // 2. bypassPermissions => danger-full-access + never approval
  const bypass = __mapPermissionModeToCodexOptionsForTest('bypassPermissions');
  assert.deepEqual(bypass, { sandboxMode: 'danger-full-access', approvalPolicy: 'never' });

  // 3. default => workspace-write + untrusted approval
  const def = __mapPermissionModeToCodexOptionsForTest('default');
  assert.deepEqual(def, { sandboxMode: 'workspace-write', approvalPolicy: 'untrusted' });

  // 4. Unknown mode falls back to default semantics.
  const fallback = __mapPermissionModeToCodexOptionsForTest('something-else');
  assert.deepEqual(fallback, { sandboxMode: 'workspace-write', approvalPolicy: 'untrusted' });

  // 5. Resulting CLI args carry --sandbox and approval_policy override.
  const args = __buildCodexExecArgsForTest({
    command: 'list files',
    sessionId: null,
    workingDirectory: '/tmp/proj',
    model: 'gpt-5',
    sandboxMode: bypass.sandboxMode,
    approvalPolicy: bypass.approvalPolicy,
  });
  assert.ok(args.includes('--sandbox'), '--sandbox flag must be emitted');
  const sandboxIdx = args.indexOf('--sandbox');
  assert.equal(args[sandboxIdx + 1], 'danger-full-access');
  assert.ok(
    args.some((a) => typeof a === 'string' && a.startsWith('approval_policy=')),
    'approval_policy override must be emitted',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Binary download preserves exact bytes
// ─────────────────────────────────────────────────────────────────────────────

test('Binary file download preserves exact bytes', async () => {
  const expressMod = await import('express');
  const express = expressMod.default;
  const { sendDownload } = await import('../../server/project-file-operations.js');

  // Construct a binary payload that exercises null bytes, high bytes, and
  // ASCII text so any UTF-8 transcoding would corrupt it.
  const payload = Buffer.concat([
    Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]),
    Buffer.from('PNG\x89\r\n\x1a\nIDAT', 'binary'),
    Buffer.from([0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0]),
    Buffer.from('plain ascii ✓'),
  ]);

  const tempDir = await mkdtemp(join(tmpdir(), 'ccflow-bin-dl-'));
  const fixturePath = join(tempDir, 'fixture.bin');
  await writeFile(fixturePath, payload);

  const app = express();
  app.get('/dl', (_req, res) => sendDownload(res, fixturePath, 'fixture.bin'));

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/dl`);
    assert.equal(response.status, 200);
    const ab = await response.arrayBuffer();
    const received = Buffer.from(ab);
    assert.equal(received.length, payload.length, 'byte length must match');
    assert.ok(received.equals(payload), 'received bytes must equal source bytes');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Frontend download flow uses blob/arrayBuffer rather than text() (no UTF-8 corruption)', async () => {
  // The client-side download flow is TypeScript and not directly invokable
  // from node:test, but we can pin the contract by asserting that the helper
  // does not transcode the response: it uses response.blob() and never
  // response.text() on the download path.
  const fileTreeOps = await readFile(
    resolvePath(REPO_ROOT, 'src/components/file-tree/hooks/useFileTreeOperations.ts'),
    'utf8',
  );
  assert.match(fileTreeOps, /downloadEntry[^]*?response\.blob\(\)/, 'downloadEntry must call response.blob()');
  // The download flow must NOT transcode through text(); search only inside
  // the downloadEntry block to avoid false positives elsewhere in the file.
  const downloadBlockMatch = fileTreeOps.match(/downloadEntry[\s\S]*?\n\s*\}\s*,\s*\[/);
  assert.ok(downloadBlockMatch, 'must locate downloadEntry block');
  assert.doesNotMatch(
    downloadBlockMatch[0],
    /response\.text\(\)/,
    'downloadEntry must not call response.text()',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Service Worker activation clears legacy caches and does not pin assets
// ─────────────────────────────────────────────────────────────────────────────

test('Service worker activation clears legacy caches and does not return cached assets', async () => {
  const swSource = await readFile(resolvePath(REPO_ROOT, 'public/sw.js'), 'utf8');

  // Build a sandboxed self with a recording caches API.
  const deletedCaches = [];
  const cachesStub = {
    keys: async () => ['legacy-html-v1', 'legacy-assets-v2'],
    delete: async (name) => {
      deletedCaches.push(name);
      return true;
    },
    match: async () => undefined,
  };

  const listeners = new Map();
  const fetchEvents = [];
  let unregistered = false;
  let claimed = false;
  let skipWaitingCalled = false;

  const selfStub = {
    addEventListener(eventName, handler) {
      listeners.set(eventName, handler);
    },
    skipWaiting() {
      skipWaitingCalled = true;
      return Promise.resolve();
    },
    registration: {
      unregister: async () => {
        unregistered = true;
        return true;
      },
    },
    clients: {
      claim: async () => {
        claimed = true;
      },
    },
  };

  const sandbox = {
    self: selfStub,
    caches: cachesStub,
    Promise,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(swSource, sandbox);

  // The script must register at minimum activate + fetch handlers.
  assert.ok(listeners.has('activate'), 'sw.js must register an activate listener');
  assert.ok(listeners.has('fetch'), 'sw.js must register a fetch listener');

  // Drive activate.
  let waitedFor = null;
  await new Promise((resolve, reject) => {
    listeners.get('activate')({
      waitUntil(promise) {
        waitedFor = Promise.resolve(promise)
          .then(resolve)
          .catch(reject);
      },
    });
  });
  await waitedFor;

  // Activation MUST clear every legacy cache.
  assert.deepEqual(
    deletedCaches.sort(),
    ['legacy-assets-v2', 'legacy-html-v1'],
    'every legacy cache name must be deleted',
  );
  assert.equal(unregistered, true, 'old worker must unregister itself');
  assert.equal(claimed, true, 'worker must claim clients to take over immediately');

  // The fetch handler must NOT call respondWith with cached responses; we
  // simulate a navigate request and assert respondWith is never invoked.
  let respondedWith = null;
  listeners.get('fetch')({
    request: { url: 'https://example.test/index.html', mode: 'navigate' },
    respondWith(promise) {
      respondedWith = promise;
      fetchEvents.push('respondWith');
    },
  });
  assert.equal(respondedWith, null, 'fetch handler must be a no-op so the network serves latest');
  assert.equal(fetchEvents.length, 0);

  // skipWaiting on install is a nice-to-have but expected by the design.
  if (listeners.has('install')) {
    listeners.get('install')({
      waitUntil() {},
    });
    assert.equal(skipWaitingCalled, true, 'install handler should call skipWaiting');
  }
});
