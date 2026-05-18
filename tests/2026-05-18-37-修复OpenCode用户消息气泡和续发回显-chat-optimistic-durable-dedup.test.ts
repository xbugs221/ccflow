// @ts-nocheck -- Change-level regression tests run through tsx without project test typing.
/**
 * PURPOSE: Verify chat session merge collapses durable OpenCode echoes into
 * existing optimistic user bubbles without deleting real duplicate sends.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mergePersistedAndOptimisticMessages } from '../src/components/chat/utils/sessionMessageMerge.ts';

test('durable OpenCode user message confirms optimistic bubble once', () => {
  const merged = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'user',
        content: 'ping2',
        timestamp: '2026-05-18T08:01:00.000Z',
        messageKey: 'co:c49:turn_beta:user:chatreq-2',
      },
    ],
    [
      {
        type: 'user',
        content: 'ping2',
        submittedContent: 'ping2',
        timestamp: '2026-05-18T08:00:59.000Z',
        deliveryStatus: 'pending',
      },
    ],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].content, 'ping2');
  assert.equal(merged[0].deliveryStatus, 'persisted');
  assert.equal(merged[0].messageKey, 'co:c49:turn_beta:user:chatreq-2');
});

test('same text sent twice remains two durable OpenCode user messages', () => {
  const merged = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'user',
        content: 'ping',
        timestamp: '2026-05-18T08:00:00.000Z',
        messageKey: 'co:c49:turn_alpha:user:chatreq-1',
      },
      {
        type: 'user',
        content: 'ping',
        timestamp: '2026-05-18T08:01:00.000Z',
        messageKey: 'co:c49:turn_beta:user:chatreq-2',
      },
    ],
    [],
  );

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((message) => message.messageKey), [
    'co:c49:turn_alpha:user:chatreq-1',
    'co:c49:turn_beta:user:chatreq-2',
  ]);
});

test('same text with distinct OpenCode request ids remains after assistant interleaving', () => {
  const merged = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'user',
        content: 'ping',
        timestamp: '2026-05-18T08:00:00.000Z',
        requestId: 'chatreq-1',
        clientRequestId: 'chatreq-1',
        messageKey: 'co:c49:turn_1:user:chatreq-1',
      },
      {
        type: 'assistant',
        content: 'Pong!',
        timestamp: '2026-05-18T08:00:01.000Z',
        messageKey: 'co:c49:turn_1:event:1',
      },
      {
        type: 'user',
        content: 'ping',
        timestamp: '2026-05-18T08:00:03.000Z',
        requestId: 'chatreq-2',
        clientRequestId: 'chatreq-2',
        messageKey: 'co:c49:turn_2:user:chatreq-2',
      },
    ],
    [],
  );

  const userMessages = merged.filter((message) => message.type === 'user');
  assert.equal(userMessages.length, 2);
  assert.deepEqual(userMessages.map((message) => message.clientRequestId), ['chatreq-1', 'chatreq-2']);
});

test('same timestamp and text with distinct OpenCode request ids remains after assistant interleaving', () => {
  const merged = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'user',
        content: 'ping',
        timestamp: '2026-05-18T08:00:00.000Z',
        requestId: 'chatreq-1',
        clientRequestId: 'chatreq-1',
        messageKey: 'co:c49:turn_1:user:chatreq-1',
      },
      {
        type: 'assistant',
        content: 'Pong!',
        timestamp: '2026-05-18T08:00:01.000Z',
        messageKey: 'co:c49:turn_1:event:1',
      },
      {
        type: 'user',
        content: 'ping',
        timestamp: '2026-05-18T08:00:00.000Z',
        requestId: 'chatreq-2',
        clientRequestId: 'chatreq-2',
        messageKey: 'co:c49:turn_2:user:chatreq-2',
      },
    ],
    [],
  );

  const userMessages = merged.filter((message) => message.type === 'user');
  assert.equal(userMessages.length, 2);
  assert.deepEqual(userMessages.map((message) => message.messageKey), [
    'co:c49:turn_1:user:chatreq-1',
    'co:c49:turn_2:user:chatreq-2',
  ]);
});

test('same text optimistic bubbles merge with matching durable request identities', () => {
  const merged = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'user',
        content: 'ping',
        timestamp: '2026-05-18T08:00:00.000Z',
        clientRequestId: 'A',
        messageKey: 'co:c49:turn_1:user:A',
      },
      {
        type: 'user',
        content: 'ping',
        timestamp: '2026-05-18T08:00:03.000Z',
        clientRequestId: 'B',
        messageKey: 'co:c49:turn_2:user:B',
      },
    ],
    [
      {
        type: 'user',
        content: 'ping',
        submittedContent: 'ping',
        timestamp: '2026-05-18T08:00:00.000Z',
        clientRequestId: 'A',
        deliveryStatus: 'pending',
        messageKey: 'optimistic:A',
      },
      {
        type: 'user',
        content: 'ping',
        submittedContent: 'ping',
        timestamp: '2026-05-18T08:00:03.000Z',
        clientRequestId: 'B',
        deliveryStatus: 'pending',
        messageKey: 'optimistic:B',
      },
    ],
  );

  assert.deepEqual(merged.map((message) => ({
    messageKey: message.messageKey,
    clientRequestId: message.clientRequestId,
    deliveryStatus: message.deliveryStatus,
  })), [
    {
      messageKey: 'co:c49:turn_1:user:A',
      clientRequestId: 'A',
      deliveryStatus: 'persisted',
    },
    {
      messageKey: 'co:c49:turn_2:user:B',
      clientRequestId: 'B',
      deliveryStatus: 'persisted',
    },
  ]);
});
