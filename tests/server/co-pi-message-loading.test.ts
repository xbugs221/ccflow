// @ts-nocheck -- Test isolation: strict types deferred.
/**
 * PURPOSE: Verify Pi workflow child session messages load from co conversation
 * read model (readCoConversationMessages), not Codex JSONL fallback.
 *
 * Covers:
 * - Spec 场景：co conversation 存在时返回 Pi 消息
 * - Spec 场景：co conversation 缺失时不跨 provider fallback
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { readCoConversationMessages, findCoConversationForSession } from '../../server/co-read-model.ts';

/**
 * Write a minimal co conversation structure:
 *   conversations/<conversationId>/state.json
 *   requests/done/<requestId>.json
 *   turns/<turnId>/request.json
 *   turns/<turnId>/events.jsonl
 */
async function writeCoFixture(coHome, conversationId, provider, providerSessionId, turns = []) {
  const convDir = path.join(coHome, 'conversations', conversationId);
  await fs.mkdir(convDir, { recursive: true });
  // Turn directory names follow the turn_<requestId> convention.
  const turnDirNames = turns.map((t) => `turn_req-${t.turn_id}`);
  await fs.writeFile(
    path.join(convDir, 'state.json'),
    JSON.stringify({
      conversation_id: conversationId,
      provider,
      provider_session_id: providerSessionId,
      turns: turnDirNames,
    }, null, 2),
  );

  const doneDir = path.join(coHome, 'requests', 'done');
  await fs.mkdir(doneDir, { recursive: true });

  for (const turn of turns) {
    const requestId = `req-${turn.turn_id}`;
    await fs.writeFile(
      path.join(doneDir, `${requestId}.json`),
      JSON.stringify({
        request_id: requestId,
        conversation_id: conversationId,
        text: turn.user_text || '',
        created_at: turn.created_at || new Date().toISOString(),
      }),
    );

    // Turn directories must be named turn_<requestId> so the read model
    // can map them back to requests for user-message extraction.
    const turnDirName = `turn_${requestId}`;
    const turnDir = path.join(coHome, 'turns', turnDirName);
    await fs.mkdir(turnDir, { recursive: true });
    await fs.writeFile(
      path.join(turnDir, 'request.json'),
      JSON.stringify({ request_id: requestId, conversation_id: conversationId }),
    );

    const events = Array.isArray(turn.events) ? turn.events : [];
    const lines = events.map((e) => JSON.stringify(e)).join('\n');
    await fs.writeFile(path.join(turnDir, 'events.jsonl'), lines + '\n');
  }
}

test('readCoConversationMessages returns Pi messages from co durable history', async () => {
  const tempRoot = path.join(os.tmpdir(), `cbw-co-msg-${Date.now()}`);
  const coHome = path.join(tempRoot, 'co');

  const prevCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    const conversationId = 'conv-pi-msg-001';
    await writeCoFixture(coHome, conversationId, 'pi', 'pi-thread-1', [
      {
        turn_id: 'turn-1',
        user_text: 'Hello from Pi user',
        created_at: '2026-05-18T04:00:00.000Z',
        events: [
          {
            seq: 0,
            type: 'text',
            created_at: '2026-05-18T04:00:01.000Z',
            provider: 'pi',
            data: { message: { content: 'Hello from Pi assistant' } },
          },
          {
            seq: 1,
            type: 'text',
            created_at: '2026-05-18T04:00:02.000Z',
            provider: 'pi',
            data: { message: { content: 'Second Pi message' } },
          },
        ],
      },
    ]);

    const conversation = {
      conversation_id: conversationId,
      provider: 'pi',
      provider_session_id: 'pi-thread-1',
      turns: ['turn_req-turn-1'],
    };

    const result = await readCoConversationMessages(conversation, 'pi');

    assert.ok(Array.isArray(result.messages), 'messages should be an array');
    assert.ok(result.messages.length >= 3, 'should have user + 2 assistant messages');

    const userMsg = result.messages.find((m) => m.type === 'user');
    assert.ok(userMsg, 'should include user message');
    assert.equal(userMsg.message.content, 'Hello from Pi user');

    const asstMsgs = result.messages.filter((m) => m.type === 'assistant');
    assert.ok(asstMsgs.length >= 2, 'should include 2 assistant messages');
    assert.equal(asstMsgs[0].message.content, 'Hello from Pi assistant');
    assert.equal(asstMsgs[0].provider, 'pi');
    assert.equal(asstMsgs[1].message.content, 'Second Pi message');
    assert.equal(asstMsgs[1].provider, 'pi');

    assert.equal(result.total, result.messages.length);
    assert.equal(result.hasMore, false);
  } finally {
    if (prevCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = prevCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('readCoConversationMessages returns empty when conversation has no id', async () => {
  const tempRoot = path.join(os.tmpdir(), `cbw-co-empty-${Date.now()}`);
  const coHome = path.join(tempRoot, 'co');

  const prevCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    // null conversation
    const nullResult = await readCoConversationMessages(null, 'pi');
    assert.deepEqual(nullResult, { messages: [], total: 0, hasMore: false });

    // empty conversation_id
    const emptyResult = await readCoConversationMessages({ conversation_id: '', turns: [] }, 'pi');
    assert.deepEqual(emptyResult, { messages: [], total: 0, hasMore: false });
  } finally {
    if (prevCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = prevCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('readCoConversationMessages respects limit and offset', async () => {
  const tempRoot = path.join(os.tmpdir(), `cbw-co-page-${Date.now()}`);
  const coHome = path.join(tempRoot, 'co');

  const prevCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    const conversationId = 'conv-pi-page-001';
    await writeCoFixture(coHome, conversationId, 'pi', 'pi-thread-p', [
      {
        turn_id: 'turn-a',
        user_text: 'First user message',
        created_at: '2026-05-18T04:00:00.000Z',
        events: [
          {
            seq: 0,
            type: 'text',
            created_at: '2026-05-18T04:00:01.000Z',
            provider: 'pi',
            data: { message: { content: 'First reply' } },
          },
        ],
      },
      {
        turn_id: 'turn-b',
        user_text: 'Second user message',
        created_at: '2026-05-18T04:01:00.000Z',
        events: [
          {
            seq: 0,
            type: 'text',
            created_at: '2026-05-18T04:01:01.000Z',
            provider: 'pi',
            data: { message: { content: 'Second reply' } },
          },
        ],
      },
    ]);

    const conversation = {
      conversation_id: conversationId,
      provider: 'pi',
      turns: ['turn_req-turn-a', 'turn_req-turn-b'],
    };

    // Limit to 1 message
    const limited = await readCoConversationMessages(conversation, 'pi', 1, 0);
    assert.equal(limited.messages.length, 1);
    assert.equal(limited.total, 4); // 2 user + 2 assistant = 4 total
    assert.equal(limited.hasMore, true);

    // Offset by 1
    const offset = await readCoConversationMessages(conversation, 'pi', null, 1);
    assert.equal(offset.messages.length, 3);
    assert.equal(offset.total, 4);
  } finally {
    if (prevCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = prevCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('findCoConversationForSession filters by expectedProvider to prevent cross-provider leak', async () => {
  const tempRoot = path.join(os.tmpdir(), `cbw-co-provfilter-${Date.now()}`);
  const coHome = path.join(tempRoot, 'co');

  const prevCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    // Write a Codex conversation that happens to have provider_session_id = 'pi-thread-1'
    const codexConvDir = path.join(coHome, 'conversations', 'conv-codex-leak');
    await fs.mkdir(codexConvDir, { recursive: true });
    await fs.writeFile(
      path.join(codexConvDir, 'state.json'),
      JSON.stringify({
        conversation_id: 'conv-codex-leak',
        provider: 'codex',
        provider_session_id: 'pi-thread-1',
        turns: [],
      }),
    );

    // Write a legitimate Pi conversation with the same provider_session_id
    const piConvDir = path.join(coHome, 'conversations', 'conv-pi-legit');
    await fs.mkdir(piConvDir, { recursive: true });
    await fs.writeFile(
      path.join(piConvDir, 'state.json'),
      JSON.stringify({
        conversation_id: 'conv-pi-legit',
        provider: 'pi',
        provider_session_id: 'pi-thread-1',
        turns: [],
      }),
    );

    // Without expectedProvider, finds the first match (Codex or Pi depending on dir order)
    const noFilter = await findCoConversationForSession('pi-thread-1');
    assert.ok(noFilter, 'Should find a conversation without provider filter');

    // With expectedProvider='pi', should only return the Pi conversation
    const piFiltered = await findCoConversationForSession('pi-thread-1', 'pi');
    assert.ok(piFiltered, 'Should find Pi conversation when filtering for pi');
    assert.equal(piFiltered.provider, 'pi');
    assert.equal(piFiltered.conversation_id, 'conv-pi-legit');

    // With expectedProvider='codex', should only return the Codex conversation
    const codexFiltered = await findCoConversationForSession('pi-thread-1', 'codex');
    assert.ok(codexFiltered, 'Should find Codex conversation when filtering for codex');
    assert.equal(codexFiltered.provider, 'codex');
    assert.equal(codexFiltered.conversation_id, 'conv-codex-leak');

    // With expectedProvider='opencode' (mismatched), should return null
    const opencodeFiltered = await findCoConversationForSession('pi-thread-1', 'opencode');
    assert.equal(opencodeFiltered, null,
      'Should return null when no conversation matches the expected provider');
  } finally {
    if (prevCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = prevCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
