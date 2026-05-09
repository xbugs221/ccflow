/**
 * PURPOSE: Verify ccflow submits chat operations through the co file protocol instead of local provider runners.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  buildCoRequest,
  isCoProviderAvailable,
  readCoConversationState,
  runCoDoctor,
  tailCoEvents,
  writeCoRequest,
} from '../server/co-client.js';

async function makeCoHome() {
  /**
   * Create an isolated co home fixture with the directory shape used by the daemon.
   */
  return fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-co-client-'));
}

test('Codex message writes an atomic co-request-v1 file without UI metadata', async () => {
  const coHome = await makeCoHome();
  const request = buildCoRequest({
    requestId: 'req_codex_1',
    conversationId: 'c12',
    projectPath: '/tmp/project',
    provider: 'codex',
    text: 'implement the change',
    options: {
      model: 'gpt-5.3-codex',
      reasoningEffort: 'low',
      permissionMode: 'default',
    },
    attachments: [{ path: '/tmp/project/a.txt', name: 'a.txt', transientPreviewUrl: 'blob:ui-only' }],
    actor: { userId: 'local', deviceId: 'device_1', windowId: 'window_1' },
  });

  const result = await writeCoRequest(request, { coHome });
  const files = await fs.readdir(path.join(coHome, 'requests', 'pending'));
  const persisted = JSON.parse(await fs.readFile(result.path, 'utf8'));

  assert.deepEqual(files, ['req_codex_1.json']);
  assert.equal(persisted.contract, 'co-request-v1');
  assert.equal(persisted.op, 'message');
  assert.equal(persisted.conversation_id, 'c12');
  assert.equal(persisted.project_path, '/tmp/project');
  assert.equal(persisted.provider, 'codex');
  assert.equal(persisted.text, 'implement the change');
  assert.equal(persisted.options.reasoning_effort, 'low');
  assert.equal(persisted.attachments[0].path, '/tmp/project/a.txt');
  assert.equal(Object.hasOwn(persisted.attachments[0], 'transientPreviewUrl'), false);
  assert.equal(Object.hasOwn(persisted, 'routeIndex'), false);
  assert.equal(Object.hasOwn(persisted, 'summary'), false);
});

test('OpenCode running-turn intervention preserves active_policy and target_turn_id', async () => {
  const request = buildCoRequest({
    requestId: 'req_opencode_steer',
    conversationId: 'c12',
    projectPath: '/tmp/project',
    provider: 'opencode',
    text: 'change direction',
    activePolicy: 'abort_and_send',
    targetTurnId: 'turn_active',
  });

  assert.equal(request.provider, 'opencode');
  assert.equal(request.active_policy, 'abort_and_send');
  assert.equal(request.target_turn_id, 'turn_active');
});

test('stop action writes op=abort request with conversation and target turn', async () => {
  const coHome = await makeCoHome();
  const request = buildCoRequest({
    op: 'abort',
    requestId: 'req_abort_1',
    conversationId: 'c12',
    projectPath: '/tmp/project',
    provider: 'codex',
    targetTurnId: 'turn_active',
  });

  await writeCoRequest(request, { coHome });
  const persisted = JSON.parse(await fs.readFile(path.join(coHome, 'requests', 'pending', 'req_abort_1.json'), 'utf8'));

  assert.equal(persisted.op, 'abort');
  assert.equal(persisted.conversation_id, 'c12');
  assert.equal(persisted.target_turn_id, 'turn_active');
  assert.equal(persisted.text, '');
});

test('refresh recovery reads conversation state and tails subsequent events', async () => {
  const coHome = await makeCoHome();
  await fs.mkdir(path.join(coHome, 'conversations', 'c12'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'turns', 'turn_active'), { recursive: true });
  await fs.writeFile(path.join(coHome, 'conversations', 'c12', 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c12',
    project_path: '/tmp/project',
    provider: 'codex',
    active_turn_id: 'turn_active',
    status: 'running',
  }));

  const state = await readCoConversationState('c12', { coHome });
  const events = [];
  const tail = tailCoEvents('turn_active', (event) => events.push(event), { coHome, pollMs: 20 });
  await fs.writeFile(path.join(coHome, 'turns', 'turn_active', 'events.jsonl'), `${JSON.stringify({
    type: 'codex-response',
    provider: 'codex',
    turn_id: 'turn_active',
    conversation_id: 'c12',
    session_id: 'provider_1',
    data: { text: 'continued after refresh' },
  })}\n`);

  await new Promise((resolve) => setTimeout(resolve, 80));
  tail.close();

  assert.equal(state.active_turn_id, 'turn_active');
  assert.equal(events.length, 1);
  assert.equal(events[0].conversation_id, 'c12');
});

test('co doctor failure reports unavailable chat execution without runner fallback', async () => {
  const status = await runCoDoctor({ command: 'ccflow-missing-co-binary-for-test', timeoutMs: 50 });

  assert.equal(status.ok, false);
  assert.match(status.error, /ENOENT|not found|spawn/);
});

test('co doctor provider availability is checked per target provider', () => {
  const status = {
    ok: true,
    contract: 'co-request-v1',
    providers: {
      codex: { available: true },
      opencode: { available: false },
    },
  };

  assert.equal(isCoProviderAvailable(status, 'codex'), true);
  assert.equal(isCoProviderAvailable(status, 'opencode'), false);
  assert.equal(isCoProviderAvailable(status, 'claude'), false);
});
