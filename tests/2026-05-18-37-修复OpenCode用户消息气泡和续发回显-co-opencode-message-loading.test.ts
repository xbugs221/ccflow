// @ts-nocheck -- Change-level regression tests run through tsx without project test typing.
/**
 * PURPOSE: Verify OpenCode co durable history restores user bubbles from
 * request buckets when turn directories only carry request_id in metadata.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { readCoConversationMessages } from '../server/co-read-model.ts';

/**
 * Write a minimal OpenCode co turn whose request is linked by state/result.
 */
async function writeOpenCodeTurn(coHome, conversationId, turnId, requestBucket, requestId, userText, assistantText, createdAt) {
  const requestDir = path.join(coHome, 'requests', requestBucket);
  await fs.mkdir(requestDir, { recursive: true });
  await fs.writeFile(
    path.join(requestDir, `${requestId}.json`),
    JSON.stringify({
      request_id: requestId,
      conversation_id: conversationId,
      provider: 'opencode',
      text: userText,
      created_at: createdAt,
    }, null, 2),
  );

  const turnDir = path.join(coHome, 'turns', turnId);
  await fs.mkdir(turnDir, { recursive: true });
  await fs.writeFile(
    path.join(turnDir, 'state.json'),
    JSON.stringify({
      turn_id: turnId,
      conversation_id: conversationId,
      provider: 'opencode',
      request_id: requestId,
    }, null, 2),
  );
  await fs.writeFile(
    path.join(turnDir, 'result.json'),
    JSON.stringify({
      turn_id: turnId,
      conversation_id: conversationId,
      provider: 'opencode',
      request_id: requestId,
    }, null, 2),
  );

  if (assistantText) {
    await fs.writeFile(
      path.join(turnDir, 'events.jsonl'),
      `${JSON.stringify({
        seq: 0,
        provider: 'opencode',
        created_at: new Date(new Date(createdAt).getTime() + 1000).toISOString(),
        data: { message: { content: assistantText } },
      })}\n`,
    );
  }
}

/**
 * Run a test body with an isolated co home.
 */
async function withCoHome(fn) {
  const tempRoot = path.join(os.tmpdir(), `cbw-opencode-co-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const coHome = path.join(tempRoot, 'co');
  const prevCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    await fn(coHome);
  } finally {
    if (prevCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = prevCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('OpenCode transcript restores two user bubbles through turn state request_id', async () => {
  await withCoHome(async (coHome) => {
    const conversationId = 'c49';
    await writeOpenCodeTurn(coHome, conversationId, 'turn_alpha', 'done', 'chatreq-1', 'ping', 'Pong!', '2026-05-18T08:00:00.000Z');
    await writeOpenCodeTurn(coHome, conversationId, 'turn_beta', 'done', 'chatreq-2', 'ping2', 'Pong!', '2026-05-18T08:01:00.000Z');

    const result = await readCoConversationMessages({
      conversation_id: conversationId,
      provider: 'opencode',
      turns: ['turn_alpha', 'turn_beta'],
    }, 'opencode');

    assert.deepEqual(
      result.messages.map((message) => [message.type, message.message.content]),
      [
        ['user', 'ping'],
        ['assistant', 'Pong!'],
        ['user', 'ping2'],
        ['assistant', 'Pong!'],
      ],
    );
    assert.equal(result.messages[0].messageKey, 'co:c49:turn_alpha:user:chatreq-1');
    assert.equal(result.messages[2].messageKey, 'co:c49:turn_beta:user:chatreq-2');
  });
});

test('OpenCode claimed request is visible before assistant event exists', async () => {
  await withCoHome(async (coHome) => {
    const conversationId = 'c49';
    await writeOpenCodeTurn(coHome, conversationId, 'turn_claimed', 'claimed', 'chatreq-claimed', 'ping2', '', '2026-05-18T08:02:00.000Z');

    const result = await readCoConversationMessages({
      conversation_id: conversationId,
      provider: 'opencode',
      turns: ['turn_claimed'],
    }, 'opencode');

    assert.deepEqual(
      result.messages.map((message) => [message.type, message.message.content]),
      [['user', 'ping2']],
    );
    assert.equal(result.messages[0].requestId, 'chatreq-claimed');
  });
});

test('OpenCode running request is visible before assistant event exists', async () => {
  await withCoHome(async (coHome) => {
    const conversationId = 'c49';
    await writeOpenCodeTurn(coHome, conversationId, 'turn_running', 'running', 'chatreq-running', 'ping3', '', '2026-05-18T08:02:30.000Z');

    const result = await readCoConversationMessages({
      conversation_id: conversationId,
      provider: 'opencode',
      turns: ['turn_running'],
    }, 'opencode');

    assert.deepEqual(
      result.messages.map((message) => [message.type, message.message.content]),
      [['user', 'ping3']],
    );
    assert.equal(result.messages[0].requestId, 'chatreq-running');
  });
});

test('OpenCode duplicate request across buckets is emitted once', async () => {
  await withCoHome(async (coHome) => {
    const conversationId = 'c49';
    await writeOpenCodeTurn(coHome, conversationId, 'turn_dedup', 'claimed', 'chatreq-dupe', 'same', 'Pong!', '2026-05-18T08:03:00.000Z');
    const doneDir = path.join(coHome, 'requests', 'done');
    await fs.mkdir(doneDir, { recursive: true });
    await fs.writeFile(
      path.join(doneDir, 'chatreq-dupe.json'),
      JSON.stringify({
        request_id: 'chatreq-dupe',
        conversation_id: conversationId,
        provider: 'opencode',
        text: 'same',
        created_at: '2026-05-18T08:03:00.000Z',
      }),
    );

    const result = await readCoConversationMessages({
      conversation_id: conversationId,
      provider: 'opencode',
      turns: ['turn_dedup'],
    }, 'opencode');

    assert.equal(result.messages.filter((message) => message.type === 'user').length, 1);
  });
});
