/**
 * PURPOSE: Verify refresh-time transcript deduping collapses accidental
 * adjacent duplicates without deleting genuinely separate repeated messages.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { dedupeAdjacentChatMessages } from '../../src/components/chat/utils/messageDedup.js';

test('dedupeAdjacentChatMessages collapses adjacent duplicate user messages from session restore', () => {
  const messages = [
    {
      type: 'user',
      content: '帮我查一下日志',
      timestamp: '2026-04-15T10:00:00.000Z',
    },
    {
      type: 'user',
      content: '帮我查一下日志',
      timestamp: '2026-04-15T10:00:01.500Z',
    },
    {
      type: 'assistant',
      content: '收到',
      timestamp: '2026-04-15T10:00:03.000Z',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 2);
  assert.equal(dedupedMessages[0].content, '帮我查一下日志');
  assert.equal(dedupedMessages[1].content, '收到');
});

test('dedupeAdjacentChatMessages keeps repeated user messages that are meaningfully separated in time', () => {
  const messages = [
    {
      type: 'user',
      content: '继续',
      timestamp: '2026-04-15T10:00:00.000Z',
    },
    {
      type: 'assistant',
      content: '好的',
      timestamp: '2026-04-15T10:00:02.000Z',
    },
    {
      type: 'user',
      content: '继续',
      timestamp: '2026-04-15T10:02:00.000Z',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 3);
  assert.deepEqual(dedupedMessages.map((message) => message.content), ['继续', '好的', '继续']);
});
