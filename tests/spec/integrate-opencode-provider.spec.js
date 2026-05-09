/**
 * PURPOSE: End-to-end tests for OpenCode provider integration.
 * Covers: SDK event transformation, steer queue, REST routes, session discovery,
 * WebSocket message flow, and frontend provider picker.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

async function readRepoFile(relPath) {
  return readFile(resolve(REPO_ROOT, relPath), 'utf8');
}

async function fileExists(relPath) {
  try {
    await stat(resolve(REPO_ROOT, relPath));
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend module existence assertions
// ─────────────────────────────────────────────────────────────────────────────

test('OpenCode backend modules exist', async () => {
  assert.ok(await fileExists('server/opencode-sdk.js'), 'server/opencode-sdk.js must exist');
  assert.ok(await fileExists('server/routes/opencode.js'), 'server/routes/opencode.js must exist');
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode SDK event transformation tests
// ─────────────────────────────────────────────────────────────────────────────

test('transformOpencodeEvent maps step_start to turn_started', async () => {
  const { __transformOpencodeEventForTest } = await import('../../server/opencode-sdk.js');
  const result = __transformOpencodeEventForTest({ type: 'step_start', part: { id: 'step1' } });
  assert.equal(result.type, 'turn_started');
});

test('transformOpencodeEvent maps text to agent_message item', async () => {
  const { __transformOpencodeEventForTest } = await import('../../server/opencode-sdk.js');
  const result = __transformOpencodeEventForTest({ type: 'text', part: { text: 'hello' } });
  assert.equal(result.type, 'item');
  assert.equal(result.itemType, 'agent_message');
  assert.equal(result.message.role, 'assistant');
  assert.equal(result.message.content, 'hello');
});

test('transformOpencodeEvent maps tool_call to command_execution started', async () => {
  const { __transformOpencodeEventForTest } = await import('../../server/opencode-sdk.js');
  const result = __transformOpencodeEventForTest({ type: 'tool_call', part: { name: 'read', arguments: '{}' } });
  assert.equal(result.type, 'item');
  assert.equal(result.itemType, 'command_execution');
  assert.equal(result.lifecycle, 'started');
});

test('transformOpencodeEvent maps tool_result to command_execution completed', async () => {
  const { __transformOpencodeEventForTest } = await import('../../server/opencode-sdk.js');
  const result = __transformOpencodeEventForTest({ type: 'tool_result', part: { name: 'read', result: 'data' } });
  assert.equal(result.type, 'item');
  assert.equal(result.itemType, 'command_execution');
  assert.equal(result.lifecycle, 'completed');
});

test('transformOpencodeEvent maps step_finish to turn_complete', async () => {
  const { __transformOpencodeEventForTest } = await import('../../server/opencode-sdk.js');
  const result = __transformOpencodeEventForTest({ type: 'step_finish', part: { tokens: { input: 10, output: 20 } } });
  assert.equal(result.type, 'turn_complete');
  assert.deepEqual(result.usage, { input: 10, output: 20 });
});

test('transformOpencodeEvent maps error to error type', async () => {
  const { __transformOpencodeEventForTest } = await import('../../server/opencode-sdk.js');
  const result = __transformOpencodeEventForTest({ type: 'error', part: { message: 'fail' } });
  assert.equal(result.type, 'error');
  assert.equal(result.message, 'fail');
});

test('transformOpencodeEvent returns unknown for unrecognized types', async () => {
  const { __transformOpencodeEventForTest } = await import('../../server/opencode-sdk.js');
  const result = __transformOpencodeEventForTest({ type: 'unknown_type', part: {} });
  assert.equal(result.type, 'item');
  assert.equal(result.itemType, 'unknown');
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode SDK steer queue tests
// ─────────────────────────────────────────────────────────────────────────────

test('enqueueSteer adds messages to FIFO queue', async () => {
  const { enqueueSteer, getSteerQueue, clearSteerQueue } = await import('../../server/opencode-sdk.js');
  clearSteerQueue('test-session');
  const result = enqueueSteer('test-session', 'steer message');
  assert.equal(result.status, 'accepted');
  assert.equal(result.position, 1);
  const queue = getSteerQueue('test-session');
  assert.equal(queue.length, 1);
  assert.equal(queue[0].content, 'steer message');
  assert.equal(queue[0].status, 'queued');
  clearSteerQueue('test-session');
});

test('enqueueSteer maintains FIFO order', async () => {
  const { enqueueSteer, getSteerQueue, clearSteerQueue } = await import('../../server/opencode-sdk.js');
  clearSteerQueue('test-session2');
  enqueueSteer('test-session2', 'first');
  enqueueSteer('test-session2', 'second');
  const queue = getSteerQueue('test-session2');
  assert.equal(queue[0].content, 'first');
  assert.equal(queue[1].content, 'second');
  clearSteerQueue('test-session2');
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode CLI argument builder tests
// ─────────────────────────────────────────────────────────────────────────────

test('buildOpencodeExecArgs for new session', async () => {
  const { __buildOpencodeExecArgsForTest } = await import('../../server/opencode-sdk.js');
  const args = __buildOpencodeExecArgsForTest({ command: 'hello', workingDirectory: '/tmp' });
  assert.ok(args.includes('run'));
  assert.ok(args.includes('--format'));
  assert.ok(args.includes('json'))
  ;
  assert.ok(args.includes('--dir'));
  assert.ok(!args.includes('--cd'));
  assert.ok(args.includes('/tmp'));
  assert.ok(args.includes('hello'));
});

test('buildOpencodeExecArgs for continued session', async () => {
  const { __buildOpencodeExecArgsForTest } = await import('../../server/opencode-sdk.js');
  const args = __buildOpencodeExecArgsForTest({ command: 'continue', sessionId: 'ses_123', workingDirectory: '/tmp' });
  assert.ok(args.includes('--session'));
  assert.ok(args.includes('ses_123'));
  assert.ok(args.includes('--continue'));
});

test('queryOpencode reports real CLI failures by throwing after opencode-error', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ccflow-opencode-failure-'));
  const fakeCli = join(tempDir, 'opencode');
  const previousCliPath = process.env.OPENCODE_CLI_PATH;

  try {
    await writeFile(fakeCli, '#!/bin/sh\necho "usage: opencode run --dir" >&2\nexit 2\n', 'utf8');
    await chmod(fakeCli, 0o755);
    process.env.OPENCODE_CLI_PATH = fakeCli;

    const { queryOpencode } = await import(`../../server/opencode-sdk.js?failure=${Date.now()}`);
    const sent = [];
    const writer = {
      isWebSocketWriter: true,
      send(payload) {
        sent.push(payload);
      },
    };

    await assert.rejects(
      () => queryOpencode('hello', { projectPath: tempDir }, writer),
      /usage: opencode run --dir/,
    );
    assert.equal(sent.at(-1)?.type, 'opencode-error');
  } finally {
    if (previousCliPath === undefined) delete process.env.OPENCODE_CLI_PATH;
    else process.env.OPENCODE_CLI_PATH = previousCliPath;
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REST route existence assertions
// ─────────────────────────────────────────────────────────────────────────────

test('OpenCode REST routes handle models, sessions, messages, and delete', async () => {
  const source = await readRepoFile('server/routes/opencode.js');
  assert.match(source, /router\.get\('\/models'/, 'must define GET /models');
  assert.match(source, /router\.get\('\/sessions'/, 'must define GET /sessions');
  assert.match(source, /router\.get\('\/sessions\/:sessionId\/messages'/, 'must define GET /sessions/:sessionId/messages');
  assert.match(source, /router\.delete\('\/sessions\/:sessionId'/, 'must define DELETE /sessions/:sessionId');
  assert.match(source, /\['models'\]/, 'models route must use current OpenCode models contract');
  assert.match(source, /\['session', 'list', '--format', 'json'\]/, 'sessions route must use current OpenCode JSON format flag');
  assert.match(source, /\['export', sessionId\]/, 'messages route must use current OpenCode export contract');
  assert.doesNotMatch(source, /\['models', '--json'\]/, 'models route must not pass retired --json flag');
  assert.doesNotMatch(source, /\['export', sessionId, '--json'\]/, 'messages route must not pass retired --json flag');
});

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket integration assertions
// ─────────────────────────────────────────────────────────────────────────────

test('server/index.js imports opencode SDK functions', async () => {
  const source = await readRepoFile('server/index.js');
  assert.match(source, /from '\.\/opencode-sdk\.js'/, 'must import from opencode-sdk.js');
  assert.match(source, /queryOpencode/, 'must import queryOpencode');
  assert.match(source, /abortOpencodeSession/, 'must import abortOpencodeSession');
  assert.match(source, /isOpencodeSessionActive/, 'must import isOpencodeSessionActive');
  assert.match(source, /getActiveOpencodeSessions/, 'must import getActiveOpencodeSessions');
});

test('server/index.js mounts OpenCode REST routes', async () => {
  const source = await readRepoFile('server/index.js');
  assert.match(source, /import opencodeRoutes from '\.\/routes\/opencode\.js'/, 'must import opencode routes');
  assert.match(source, /app\.use\('\/api\/cli\/opencode',/, 'must mount /api/cli/opencode routes');
});

test('server/index.js handles opencode-command WebSocket messages', async () => {
  const source = await readRepoFile('server/index.js');
  assert.match(source, /data\.type === 'opencode-command'/, 'must handle opencode-command type');
});

test('server/index.js handles opencode in abort-session', async () => {
  const source = await readRepoFile('server/index.js');
  assert.match(source, /provider === 'opencode'[\s\S]*?abortOpencodeSession/, 'must abort opencode sessions');
});

test('server/index.js handles opencode in check-session-status', async () => {
  const source = await readRepoFile('server/index.js');
  assert.match(source, /provider === 'opencode'[\s\S]*?isOpencodeSessionActive/, 'must check opencode session status');
});

test('server/index.js includes opencode in get-active-sessions', async () => {
  const source = await readRepoFile('server/index.js');
  assert.match(source, /opencode:\s*\[[\s\S]*?getActiveOpencodeSessions\(\)[\s\S]*?runnerSessions\.filter\(\(turn\)\s*=>\s*turn\.provider\s*===\s*'opencode'\)/, 'must include opencode and runner sessions in active sessions');
});

test('server/index.js does not replay terminal runner turns after reconnect', async () => {
  const source = await readRepoFile('server/index.js');
  assert.match(source, /if\s*\(turn\.status !== 'running'\)\s*\{[\s\S]*?continue;/, 'runner replay must skip terminal turns');
  assert.match(source, /runnerActiveTurns\.delete\(turnKey\)/, 'terminal runner events must be removed from active replay set');
});

test('server/index.js handles opencode-error in catch block', async () => {
  const source = await readRepoFile('server/index.js');
  assert.match(source, /data\?\.type === 'opencode-command'/, 'must detect opencode-command in error handler');
  assert.match(source, /errorType = 'opencode-error'/, 'must set opencode-error type');
});

// ─────────────────────────────────────────────────────────────────────────────
// Session discovery assertions
// ─────────────────────────────────────────────────────────────────────────────

test('server/projects.js normalizes opencode provider in chat records', async () => {
  const source = await readRepoFile('server/projects.js');
  assert.match(source, /if\s*\(\s*provider\s*===\s*'opencode'\s*\)\s*return\s*'opencode'/, 'normalizeProjectChatProvider must support opencode');
});

test('server/projects.js defines getOpencodeSessions function', async () => {
  const source = await readRepoFile('server/projects.js');
  assert.match(source, /async function getOpencodeSessions\(/, 'must define getOpencodeSessions');
  assert.match(source, /stdout\.trim\(\)[\s\S]*?\?\s*JSON\.parse\(trimmedStdout\)\s*:\s*\[\]/, 'empty OpenCode session list stdout must mean no sessions');
  assert.match(source, /\['session', 'list', '--format', 'json'\]/, 'must use current OpenCode JSON format flag');
  assert.doesNotMatch(source, /\['session', 'list', '--json'\]/, 'must not use retired OpenCode --json flag');
});

test('server/projects.js includes opencodeSessions in project payload', async () => {
  const source = await readRepoFile('server/projects.js');
  assert.match(source, /opencodeSessions:\s*\[\]/, 'project payload must include opencodeSessions');
});

test('server/projects.js populates opencodeSessions in populateProjectCollections', async () => {
  const source = await readRepoFile('server/projects.js');
  assert.match(source, /getOpencodeSessions\(actualProjectDir,[\s\S]*?indexRef:\s*opencodeSessionsIndexRef[\s\S]*?\)/, 'populateProjectCollections must fetch opencode sessions through the shared index');
  assert.match(source, /const opencodeSessionsIndexRef = \{ sessionsByProject: null \}/, 'getProjects must reuse one OpenCode session index per refresh');
});

// ─────────────────────────────────────────────────────────────────────────────
// Frontend provider picker assertions
// ─────────────────────────────────────────────────────────────────────────────

test('ProjectOverviewPanel renders OpenCode provider button', async () => {
  const source = await readRepoFile('src/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx');
  assert.match(source, /data-testid="project-new-session-provider-opencode"/, 'must have opencode provider testid');
  assert.match(source, /handleCreateSession\('opencode'\)/, 'must call handleCreateSession with opencode');
});

// ─────────────────────────────────────────────────────────────────────────────
// Frontend message handling assertions
// ─────────────────────────────────────────────────────────────────────────────

test('useChatRealtimeHandlers handles opencode-response events', async () => {
  const source = await readRepoFile('src/components/chat/hooks/useChatRealtimeHandlers.ts');
  assert.match(source, /case 'opencode-response':/, 'must handle opencode-response');
});

test('useChatRealtimeHandlers handles opencode-complete events', async () => {
  const source = await readRepoFile('src/components/chat/hooks/useChatRealtimeHandlers.ts');
  assert.match(source, /case 'opencode-complete':/, 'must handle opencode-complete');
});

test('useChatRealtimeHandlers handles opencode-error events', async () => {
  const source = await readRepoFile('src/components/chat/hooks/useChatRealtimeHandlers.ts');
  assert.match(source, /case 'opencode-error':/, 'must handle opencode-error');
});

test('useChatComposerState sends opencode-command messages', async () => {
  const source = await readRepoFile('src/components/chat/hooks/useChatComposerState.ts');
  assert.match(source, /type: 'opencode-command'/, 'must send opencode-command type');
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings controller assertions
// ─────────────────────────────────────────────────────────────────────────────

test('useSettingsController sets opencode auth status to authenticated', async () => {
  const source = await readRepoFile('src/components/settings/hooks/useSettingsController.ts');
  assert.match(source, /if\s*\(\s*provider === 'opencode'\s*\)\s*\{[\s\S]*?authenticated:\s*true/, 'checkAuthStatus must set opencode as authenticated');
});

test('AccountContent hides unavailable quota and login for local OpenCode', async () => {
  const source = await readRepoFile('src/components/settings/view/tabs/agents-settings/sections/content/AccountContent.tsx');
  assert.match(source, /agent\s*===\s*'opencode'\s*\?\s*\(/, 'must render local OpenCode status without login action');
  assert.match(source, /agent\s*!==\s*'opencode'\s*&&\s*\([\s\S]*?<UsageProviderQuota/, 'must skip UsageProviderQuota for opencode');
});
