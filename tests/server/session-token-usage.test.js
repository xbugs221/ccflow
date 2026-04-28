/**
 * PURPOSE: Validate session context token usage parsing and remaining-percent
 * normalization for Claude and Codex session payloads.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildSessionTokenUsagePayload,
  getClaudeSessionTokenUsage,
  getClaudeSessionTokenUsageFromModelUsage,
  getCodexSessionTokenUsage,
} from '../../server/session-token-usage.js';

/**
 * Run each test inside an isolated HOME tree so provider fixtures stay local.
 */
async function withTemporaryHome(testBody) {
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-session-token-usage-'));

  process.env.HOME = tempHome;
  try {
    await testBody(tempHome);
  } finally {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

/**
 * Write a minimal Claude session fixture with assistant usage data.
 */
async function createClaudeSessionFixture(homeDir) {
  const projectDir = path.join(homeDir, '.claude', 'projects', '-tmp-demo');
  const sessionFile = path.join(projectDir, 'claude-session.jsonl');

  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    sessionFile,
    [
      JSON.stringify({ type: 'user', timestamp: '2026-04-10T08:00:00.000Z' }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-10T08:01:00.000Z',
        message: {
          usage: {
            input_tokens: 15000,
            cache_creation_input_tokens: 5000,
            cache_read_input_tokens: 2000,
            output_tokens: 900,
          },
        },
      }),
    ].join('\n') + '\n',
    'utf8'
  );

  return sessionFile;
}

/**
 * Write a minimal Codex session fixture with token_count info.
 */
async function createCodexSessionFixture(homeDir) {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '10');
  const sessionFile = path.join(sessionsDir, 'rollout-demo-codex-session.jsonl');

  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    sessionFile,
    [
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-10T08:47:26.760Z',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 246408,
              cached_input_tokens: 207360,
              output_tokens: 1509,
              reasoning_output_tokens: 155,
              total_tokens: 247917,
            },
            last_token_usage: {
              input_tokens: 60518,
              cached_input_tokens: 60416,
              output_tokens: 154,
              reasoning_output_tokens: 41,
              total_tokens: 61798,
            },
            model_context_window: 258400,
          },
        },
      }),
    ].join('\n') + '\n',
    'utf8'
  );
}

test('buildSessionTokenUsagePayload derives remaining and percentages', () => {
  const payload = buildSessionTokenUsagePayload({
    used: 25,
    total: 100,
    source: 'unit-test',
  });

  assert.equal(payload.remaining, 75);
  assert.equal(payload.usedPercent, 25);
  assert.equal(payload.remainingPercent, 75);
});

test('getClaudeSessionTokenUsage returns remainingPercent from assistant usage', async () => {
  await withTemporaryHome(async (tempHome) => {
    const sessionFile = await createClaudeSessionFixture(tempHome);
    const usage = await getClaudeSessionTokenUsage(sessionFile, { contextWindow: 100000 });

    assert.ok(usage);
    assert.equal(usage.used, 22000);
    assert.equal(usage.total, 100000);
    assert.equal(usage.remaining, 78000);
    assert.equal(usage.remainingPercent, 78);
    assert.equal(usage.breakdown.output, 900);
  });
});

test('getClaudeSessionTokenUsageFromModelUsage matches REST context-only budget math', () => {
  const usage = getClaudeSessionTokenUsageFromModelUsage(
    {
      cumulativeInputTokens: 12000,
      cumulativeCacheReadInputTokens: 3000,
      cumulativeCacheCreationInputTokens: 5000,
      cumulativeOutputTokens: 700,
    },
    { contextWindow: 40000 }
  );

  assert.ok(usage);
  assert.equal(usage.used, 20000);
  assert.equal(usage.remainingPercent, 50);
  assert.equal(usage.breakdown.output, 700);
});

test('getCodexSessionTokenUsage returns remainingPercent from token_count info', async () => {
  await withTemporaryHome(async (tempHome) => {
    await createCodexSessionFixture(tempHome);
    const usage = await getCodexSessionTokenUsage('codex-session', { homeDir: tempHome });

    assert.ok(usage);
    assert.equal(usage.used, 61798);
    assert.equal(usage.total, 258400);
    assert.equal(usage.remaining, 196602);
    assert.equal(usage.remainingPercent, 80);
    assert.equal(usage.breakdown.cumulativeTotal, 247917);
  });
});
