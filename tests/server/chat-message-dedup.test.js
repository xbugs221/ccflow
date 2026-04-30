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

test('dedupeAdjacentChatMessages collapses non-adjacent same-timestamp user echoes', () => {
  const messages = [
    {
      type: 'user',
      content: '滚动到底部后不要重复',
      timestamp: '2026-04-30T04:10:00.000Z',
    },
    {
      type: 'assistant',
      content: '处理中',
      timestamp: '2026-04-30T04:10:01.000Z',
    },
    {
      type: 'user',
      content: '滚动到底部后不要重复',
      timestamp: '2026-04-30T04:10:00.000Z',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.deepEqual(dedupedMessages.map((message) => message.content), ['滚动到底部后不要重复', '处理中']);
});

test('dedupeAdjacentChatMessages collapses non-adjacent user echoes inside the send window', () => {
  const messages = [
    {
      type: 'user',
      content: '我重启服务了，你新建个会话实测一遍',
      timestamp: '2026-04-30T06:38:03.100Z',
      deliveryStatus: 'persisted',
    },
    {
      type: 'assistant',
      content: '开始测试',
      timestamp: '2026-04-30T06:38:04.000Z',
    },
    {
      type: 'user',
      content: '我重启服务了，你新建个会话实测一遍',
      timestamp: '2026-04-30T06:38:03.900Z',
      deliveryStatus: 'sent',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.deepEqual(
    dedupedMessages.map((message) => `${message.type}:${message.content}`),
    ['user:我重启服务了，你新建个会话实测一遍', 'assistant:开始测试'],
  );
  assert.equal(dedupedMessages[0].deliveryStatus, 'persisted');
});

test('dedupeAdjacentChatMessages merges optimistic user bubble with persisted echo', () => {
  const messages = [
    {
      type: 'user',
      content: '发送时用户气泡不要重复',
      timestamp: '2026-04-30T04:30:00.000Z',
      clientRequestId: 'chatreq-test',
      deliveryStatus: 'pending',
    },
    {
      type: 'user',
      content: '发送时用户气泡不要重复',
      timestamp: '2026-04-30T04:30:01.000Z',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 1);
  assert.equal(dedupedMessages[0].content, '发送时用户气泡不要重复');
  assert.equal(dedupedMessages[0].deliveryStatus, 'persisted');
});

test('dedupeAdjacentChatMessages treats empty attachment arrays as plain user messages', () => {
  const messages = [
    {
      type: 'user',
      content: '空附件数组不要阻断去重',
      timestamp: '2026-04-15T10:00:00.000Z',
      clientRequestId: 'chatreq-empty-attachments',
      deliveryStatus: 'pending',
      attachments: [],
    },
    {
      type: 'user',
      content: '空附件数组不要阻断去重',
      timestamp: '2026-04-15T10:00:01.000Z',
      clientRequestId: 'chatreq-empty-attachments',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 1);
  assert.equal(dedupedMessages[0].deliveryStatus, 'persisted');
});

test('dedupeAdjacentChatMessages merges duplicated user bubbles with the same attachment', () => {
  const messages = [
    {
      type: 'user',
      content: '带附件的用户消息不要重复',
      timestamp: '2026-04-30T07:36:19.000Z',
      deliveryStatus: 'sent',
      attachments: [
        {
          name: 'b7190647290f8eb88c52.jpg',
          absolutePath: '/home/zzl/ccflow-uploads/1/1777534579564-6135f129/b7190647290f8eb88c52.jpg',
        },
      ],
    },
    {
      type: 'user',
      content: '带附件的用户消息不要重复',
      timestamp: '2026-04-30T07:36:19.000Z',
      deliveryStatus: 'persisted',
      attachments: [
        {
          name: 'b7190647290f8eb88c52.jpg',
          absolutePath: '/home/zzl/ccflow-uploads/1/1777534579564-6135f129/b7190647290f8eb88c52.jpg',
        },
      ],
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 1);
  assert.equal(dedupedMessages[0].deliveryStatus, 'persisted');
});

test('dedupeAdjacentChatMessages keeps same text when attachments differ', () => {
  const messages = [
    {
      type: 'user',
      content: '同一说明但附件不同',
      timestamp: '2026-04-30T07:36:19.000Z',
      attachments: [{ name: 'before.jpg', absolutePath: '/tmp/before.jpg' }],
    },
    {
      type: 'user',
      content: '同一说明但附件不同',
      timestamp: '2026-04-30T07:36:20.000Z',
      attachments: [{ name: 'after.jpg', absolutePath: '/tmp/after.jpg' }],
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 2);
});
