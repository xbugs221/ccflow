/**
 * PURPOSE: Validate provider-specific usage remaining adapters and fallback behavior.
 * This suite ensures Claude/Codex parsing and unavailable-state handling stay stable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearUsageRemainingCache,
  getClaudeUsageRemaining,
  getCodexUsageRemaining,
  getUsageRemaining,
} from '../../server/usage-remaining.js';

let homeIsolationQueue = Promise.resolve();

/**
 * Execute test logic under an isolated HOME directory.
 */
async function withTemporaryHome(testBody) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-usage-test-'));

    process.env.HOME = tempHome;
    clearUsageRemainingCache();

    try {
      await testBody(tempHome);
    } finally {
      clearUsageRemainingCache();

      if (originalHome) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }

      await fs.rm(tempHome, { recursive: true, force: true });
    }
  };

  const runPromise = homeIsolationQueue.then(run, run);
  homeIsolationQueue = runPromise.catch(() => {});
  return runPromise;
}

/**
 * Write minimal Claude statusline settings and usage cache fixtures.
 */
async function createClaudeUsageFixture(homeDir, usagePayload, options = {}) {
  const claudeDir = path.join(homeDir, '.claude');
  const cacheDir = path.join(claudeDir, 'cache');
  const settings = {
    statusLine: {
      type: 'command',
      command: 'bash ~/.claude/statusline-command.sh',
    },
    ...(options.settings || {}),
  };

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify(settings, null, 2),
    'utf8'
  );

  await fs.writeFile(path.join(cacheDir, 'usage-api.json'), JSON.stringify(usagePayload, null, 2), 'utf8');
}

/**
 * Write minimal Codex config and session JSONL fixtures with rate-limit payload.
 */
async function createCodexUsageFixture(homeDir, rateLimitsPayload, options = {}) {
  const {
    usePayloadRateLimits = false,
    sessionFileName = 'codex-session.jsonl',
  } = options;
  const codexDir = path.join(homeDir, '.codex');
  const sessionsDir = path.join(codexDir, 'sessions', '2026', '03', '05');

  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    path.join(codexDir, 'config.toml'),
    [
      '[tui]',
      'status_line = ["current-dir", "five-hour-limit", "weekly-limit", "used-tokens"]',
      '',
    ].join('\n'),
    'utf8'
  );

  await fs.writeFile(
    path.join(sessionsDir, sessionFileName),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-03-05T09:00:00.000Z',
        payload: {
          id: 'codex-session',
          cwd: '/tmp/demo',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-03-05T09:10:00.000Z',
        payload: usePayloadRateLimits
          ? {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 1,
              },
            },
            rate_limits: rateLimitsPayload,
          }
          : {
            type: 'token_count',
            info: {
              rate_limits: rateLimitsPayload,
            },
          },
      }),
    ].join('\n') + '\n',
    'utf8'
  );
}

test('getClaudeUsageRemaining converts utilization to 5h/7d remaining values', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    await createClaudeUsageFixture(tempHome, {
      five_hour: { utilization: 82.3 },
      seven_day: { utilization: 41 },
      updated_at: '2026-03-05T09:00:00.000Z',
    });

    const usage = await getClaudeUsageRemaining({ homeDir: tempHome });

    assert.equal(usage.status, 'ok');
    assert.equal(usage.provider, 'claude');
    assert.equal(usage.fiveHourRemaining.value, 17.7);
    assert.equal(usage.sevenDayRemaining.value, 59);
    assert.equal(usage.source, 'claude-usage-cache');
  });
});

test('getClaudeUsageRemaining accepts statusline rate limit field names', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    await createClaudeUsageFixture(tempHome, {
      rate_limits: {
        five_hour: { used_percentage: 25 },
        seven_day: { used_percent: 12.5 },
      },
      fetched_at: '2026-03-05T09:05:00.000Z',
    });

    const usage = await getClaudeUsageRemaining({ homeDir: tempHome });

    assert.equal(usage.status, 'ok');
    assert.equal(usage.fiveHourRemaining.value, 75);
    assert.equal(usage.sevenDayRemaining.value, 87.5);
    assert.equal(usage.updatedAt, '2026-03-05T09:05:00.000Z');
  });
});

test('getClaudeUsageRemaining fetches Kimi quota when Claude uses Kimi provider', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    await createClaudeUsageFixture(
      tempHome,
      {
        five_hour: { utilization: 99 },
        seven_day: { utilization: 99 },
      },
      {
        settings: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
            ANTHROPIC_API_KEY: 'test-key',
          },
        },
      }
    );

    const usage = await getClaudeUsageRemaining({
      homeDir: tempHome,
      fetchImpl: async (url, request) => {
        assert.equal(url, 'https://api.kimi.com/coding/v1/usages');
        assert.equal(request.headers.Authorization, 'Bearer test-key');
        return {
          ok: true,
          json: async () => ({
            usage: {
              limit: '100',
              remaining: '80',
            },
            limits: [
              {
                window: {
                  duration: 300,
                  timeUnit: 'TIME_UNIT_MINUTE',
                },
                detail: {
                  limit: '50',
                  remaining: '25',
                },
              },
            ],
          }),
        };
      },
    });

    assert.equal(usage.status, 'ok');
    assert.equal(usage.source, 'kimi-usage-api');
    assert.equal(usage.fiveHourRemaining.value, 50);
    assert.equal(usage.sevenDayRemaining.value, 80);
  });
});

test('getCodexUsageRemaining converts primary/secondary used_percent to remaining values', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    await createCodexUsageFixture(tempHome, {
      primary: { used_percent: 65 },
      secondary: { used_percent: 55.5 },
    }, { usePayloadRateLimits: true });

    const usage = await getCodexUsageRemaining({ homeDir: tempHome });

    assert.equal(usage.status, 'ok');
    assert.equal(usage.provider, 'codex');
    assert.equal(usage.fiveHourRemaining.value, 35);
    assert.equal(usage.sevenDayRemaining.value, 44.5);
    assert.equal(usage.source, 'codex-rate-limits');
  });
});

test('getCodexUsageRemaining falls back to older session when newest file has no rate limits', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    await createCodexUsageFixture(
      tempHome,
      {
        primary: { used_percent: 25 },
        secondary: { used_percent: 40 },
      },
      {
        usePayloadRateLimits: true,
        sessionFileName: 'older-session.jsonl',
      }
    );

    const sessionsDir = path.join(tempHome, '.codex', 'sessions', '2026', '03', '05');
    const latestFilePath = path.join(sessionsDir, 'latest-session.jsonl');
    await fs.writeFile(
      latestFilePath,
      [
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-03-05T12:00:00.000Z',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 123,
              },
            },
            rate_limits: null,
          },
        }),
      ].join('\n') + '\n',
      'utf8'
    );
    await fs.utimes(latestFilePath, new Date('2026-03-05T12:00:00.000Z'), new Date('2026-03-05T12:00:00.000Z'));

    const usage = await getCodexUsageRemaining({ homeDir: tempHome });

    assert.equal(usage.status, 'ok');
    assert.equal(usage.fiveHourRemaining.value, 75);
    assert.equal(usage.sevenDayRemaining.value, 60);
  });
});

test('getUsageRemaining returns unavailable payload when source data is missing or invalid', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    await fs.mkdir(path.join(tempHome, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(tempHome, '.claude', 'settings.json'),
      JSON.stringify({ statusLine: { type: 'command', command: 'echo' } }),
      'utf8'
    );

    const claudeUsage = await getUsageRemaining('claude', { homeDir: tempHome, cacheTtlMs: 0 });
    assert.equal(claudeUsage.status, 'unavailable');

    await fs.mkdir(path.join(tempHome, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(tempHome, '.codex', 'config.toml'),
      ['[tui]', 'status_line = ["current-dir", "used-tokens"]', ''].join('\n'),
      'utf8'
    );

    const codexUsage = await getUsageRemaining('codex', { homeDir: tempHome, cacheTtlMs: 0 });
    assert.equal(codexUsage.status, 'unavailable');
    assert.equal(codexUsage.reason, 'session-file-not-found');
  });
});
