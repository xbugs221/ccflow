// @ts-nocheck -- Test isolation: strict types deferred.
/**
 * PURPOSE: Endpoint-level integration test for the session messages API
 * with provider=pi.  Imports the REAL handleGetSessionMessages from
 * server/session-messages-handler.ts so the test verifies the ACTUAL
 * production handler, not a copy.
 *
 * Covers spec 场景：Pi child session 请求消息时携带 provider
 *               co conversation 缺失时不跨 provider fallback
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { handleGetSessionMessages } from '../../server/session-messages-handler.ts';
import { extractProjectDirectory, clearProjectDirectoryCache } from '../../server/projects.ts';

/**
 * Minimal mock Express response object for capturing handler output.
 */
function createMockRes() {
  let _status = 200;
  let _json = null;
  return {
    status(code) { _status = code; return this; },
    json(data) { _json = data; return this; },
    getStatus() { return _status; },
    getJson() { return _json; },
  };
}

/**
 * Set up co conversation fixtures under a temporary co home.
 */
async function writeCoFixture(coHome, conversationId, provider, providerSessionId, turns = []) {
  const convDir = path.join(coHome, 'conversations', conversationId);
  await fs.mkdir(convDir, { recursive: true });
  const turnDirNames = turns.map((t) => `turn_req-${t.turn_id}`);
  await fs.writeFile(path.join(convDir, 'state.json'), JSON.stringify({
    conversation_id: conversationId, provider, provider_session_id: providerSessionId, turns: turnDirNames,
  }, null, 2));

  const doneDir = path.join(coHome, 'requests', 'done');
  await fs.mkdir(doneDir, { recursive: true });

  for (const turn of turns) {
    const requestId = `req-${turn.turn_id}`;
    await fs.writeFile(path.join(doneDir, `${requestId}.json`), JSON.stringify({
      request_id: requestId, conversation_id: conversationId,
      text: turn.user_text || '', created_at: turn.created_at || new Date().toISOString(),
    }));
    const turnDir = path.join(coHome, 'turns', `turn_${requestId}`);
    await fs.mkdir(turnDir, { recursive: true });
    await fs.writeFile(path.join(turnDir, 'request.json'), JSON.stringify({ request_id: requestId, conversation_id: conversationId }));
    const lines = (turn.events || []).map((e) => JSON.stringify(e)).join('\n');
    await fs.writeFile(path.join(turnDir, 'events.jsonl'), lines + '\n');
  }
}

/**
 * Write project config at the XDG state path.
 */
async function writeProjectConfig(homeDir, projectName, projectPath) {
  const stateRoot = process.env.XDG_STATE_HOME || path.join(homeDir, '.local', 'state');
  const cfgDir = path.join(stateRoot, 'cbw');
  await fs.mkdir(cfgDir, { recursive: true });
  const cfgPath = path.join(cfgDir, 'conf.json');
  let config = {};
  try { config = JSON.parse(await fs.readFile(cfgPath, 'utf8')); } catch {}
  config[projectName] = { originalPath: projectPath };
  await fs.writeFile(cfgPath, JSON.stringify(config, null, 2));
}

test('handleGetSessionMessages with provider=pi returns Pi messages from co durable history', async () => {
  const tempHome = path.join(os.tmpdir(), `cbw-ep-real-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'cbw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    const conversationId = 'conv-ep-real-1';
    await writeCoFixture(coHome, conversationId, 'pi', 'pi-session-real', [
      {
        turn_id: 't1',
        user_text: 'Real handler test user message',
        created_at: '2026-05-18T10:00:00.000Z',
        events: [
          { seq: 0, type: 'text', created_at: '2026-05-18T10:00:01.000Z', provider: 'pi', data: { message: { content: 'Real handler reply' } } },
        ],
      },
    ]);

    const projectPath = path.join(tempHome, 'projects', 'ep-real-project');
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, 'ep-real-project', projectPath);
    clearProjectDirectoryCache();

    // Call the REAL production handler
    const req = {
      params: { projectName: 'ep-real-project', sessionId: 'pi-session-real' },
      query: { provider: 'pi' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200, `Expected 200, got ${res.getStatus()}`);
    const body = res.getJson();
    assert.ok(Array.isArray(body.messages), 'messages should be an array');
    assert.ok(body.messages.length >= 2, `Expected >= 2 messages, got ${body.messages.length}`);

    const userMsg = body.messages.find((m) => m.type === 'user');
    assert.ok(userMsg, 'Should have user message');
    assert.equal(userMsg.message.content, 'Real handler test user message');

    const asstMsg = body.messages.find((m) => m.type === 'assistant');
    assert.ok(asstMsg, 'Should have assistant message');
    assert.equal(asstMsg.message.content, 'Real handler reply');
    assert.equal(asstMsg.provider, 'pi');
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('handleGetSessionMessages with provider=pi + no matching co conversation → empty', async () => {
  const tempHome = path.join(os.tmpdir(), `cbw-ep-real-empty-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'cbw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    // Write only a Codex conversation (wrong provider)
    await writeCoFixture(coHome, 'conv-codex-real', 'codex', 'pi-session-missing', []);

    const projectPath = path.join(tempHome, 'projects', 'ep-real-empty');
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, 'ep-real-empty', projectPath);
    clearProjectDirectoryCache();

    const req = {
      params: { projectName: 'ep-real-empty', sessionId: 'pi-session-missing' },
      query: { provider: 'pi' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200);
    const body = res.getJson();
    assert.deepEqual(body.messages || [], [], 'Should return empty when no Pi conversation');
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('handleGetSessionMessages with provider=pi skips provider guessing', async () => {
  const tempHome = path.join(os.tmpdir(), `cbw-ep-real-noguess-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'cbw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    await writeCoFixture(coHome, 'conv-ep-noguess', 'pi', 'pi-session-noguess', [
      {
        turn_id: 't1',
        user_text: 'Direct',
        created_at: '2026-05-18T10:00:00.000Z',
        events: [{ seq: 0, type: 'text', created_at: '2026-05-18T10:00:01.000Z', provider: 'pi', data: { message: { content: 'R' } } }],
      },
    ]);

    const projectPath = path.join(tempHome, 'projects', 'ep-noguess');
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, 'ep-noguess', projectPath);
    clearProjectDirectoryCache();

    const req = {
      params: { projectName: 'ep-noguess', sessionId: 'pi-session-noguess' },
      query: { provider: 'pi' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200);
    const body = res.getJson();
    assert.ok(body.messages.length >= 2);
    // No non-Pi messages
    const nonPi = body.messages.filter((m) => m.provider && m.provider !== 'pi');
    assert.equal(nonPi.length, 0, 'All messages must be from pi');
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('cN route session with provider=codex reads co durable history, not native JSONL', async () => {
  // Regression: fix-1 started always appending provider=codex to all session
  // message requests.  cN sessions (c51, c123) must still read from co
  // conversation read model, not fall through to native Codex JSONL.
  const tempHome = path.join(os.tmpdir(), `cbw-ep-cn-codex-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'cbw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    // Write a codex co conversation with conversation_id = c51 (a cN route id)
    const conversationId = 'c51';
    await writeCoFixture(coHome, conversationId, 'codex', 'provider-sess-c51', [
      {
        turn_id: 't1',
        user_text: 'CO_QUEUE_1_OK',
        created_at: '2026-05-18T10:00:00.000Z',
        events: [
          { seq: 0, type: 'text', created_at: '2026-05-18T10:00:01.000Z', provider: 'codex', data: { message: { content: 'CO_QUEUE_1_OK' } } },
        ],
      },
    ]);

    const projectPath = path.join(tempHome, 'projects', 'ep-cn-project');
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, 'ep-cn-project', projectPath);
    clearProjectDirectoryCache();

    // No manual draft runtimeContext for c51 — simulates the scenario where
    // getManualSessionDraftRuntime returns null.  The handler must still
    // fall back to co conversation lookup by cN route id.
    const req = {
      params: { projectName: 'ep-cn-project', sessionId: 'c51' },
      query: { provider: 'codex' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200, `Expected 200, got ${res.getStatus()}`);
    const body = res.getJson();
    assert.ok(Array.isArray(body.messages), 'messages should be an array');
    assert.ok(body.messages.length >= 2, `Expected >= 2 messages, got ${body.messages.length}`);

    const userMsg = body.messages.find((m) => m.type === 'user');
    assert.ok(userMsg, 'Should have user message');
    assert.equal(userMsg.message.content, 'CO_QUEUE_1_OK');
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});
