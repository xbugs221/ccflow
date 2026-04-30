/**
 * PURPOSE: Verify raw session refresh dedupe keeps follow-mode append stable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dedupeSessionMessagesByIdentity,
  getUniqueIncomingSessionMessages,
} from '../../src/components/chat/utils/sessionMessageDedup.js';

test('getUniqueIncomingSessionMessages skips rows already loaded by JSONL identity', () => {
  const existingMessages = [
    {
      type: 'user',
      messageKey: 'codex:s1:line:10',
      content: '把工作区的stage变更合并到 02080295 这个commit里',
    },
  ];
  const incomingMessages = [
    {
      type: 'user',
      messageKey: 'codex:s1:line:10',
      content: '把工作区的stage变更合并到 02080295 这个commit里',
    },
    {
      type: 'assistant',
      messageKey: 'codex:s1:line:11',
      content: '已处理',
    },
  ];

  const uniqueMessages = getUniqueIncomingSessionMessages(existingMessages, incomingMessages);

  assert.deepEqual(uniqueMessages.map((message) => message.messageKey), ['codex:s1:line:11']);
});

test('dedupeSessionMessagesByIdentity preserves repeated text when backend identity differs', () => {
  const messages = [
    {
      type: 'user',
      messageKey: 'codex:s1:line:20',
      content: '继续',
    },
    {
      type: 'user',
      messageKey: 'codex:s1:line:25',
      content: '继续',
    },
  ];

  const dedupedMessages = dedupeSessionMessagesByIdentity(messages);

  assert.equal(dedupedMessages.length, 2);
});

test('getUniqueIncomingSessionMessages skips Codex user echo split across refreshes', () => {
  const prompt = 'RTK-WHEEL-DEDUPE-请输出20行OK';
  const existingMessages = [
    {
      type: 'user',
      messageKey: 'codex:s1:line:20',
      timestamp: '2026-04-30T03:40:29.604Z',
      message: { role: 'user', content: prompt },
    },
  ];
  const incomingMessages = [
    {
      type: 'user',
      messageKey: 'codex:s1:line:21',
      timestamp: '2026-04-30T03:40:29.605Z',
      message: { role: 'user', content: prompt },
    },
    {
      type: 'assistant',
      messageKey: 'codex:s1:line:22',
      timestamp: '2026-04-30T03:40:30.604Z',
      content: 'OK',
    },
  ];

  const uniqueMessages = getUniqueIncomingSessionMessages(existingMessages, incomingMessages);

  assert.deepEqual(uniqueMessages.map((message) => message.messageKey), ['codex:s1:line:22']);
});

test('getUniqueIncomingSessionMessages skips raw role user rows repeated by refresh', () => {
  const existingMessages = [
    {
      timestamp: '2026-04-30T06:01:16.000Z',
      message: { role: 'user', content: '继续' },
    },
  ];
  const incomingMessages = [
    {
      timestamp: '2026-04-30T06:01:16.000Z',
      message: { role: 'user', content: '继续' },
    },
    {
      timestamp: '2026-04-30T06:01:18.000Z',
      message: { role: 'assistant', content: '继续处理' },
    },
  ];

  const uniqueMessages = getUniqueIncomingSessionMessages(existingMessages, incomingMessages);

  assert.equal(uniqueMessages.length, 1);
  assert.equal(uniqueMessages[0].message.content, '继续处理');
});
