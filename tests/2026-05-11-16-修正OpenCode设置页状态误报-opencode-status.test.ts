// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify OpenCode settings status reports CLI availability and
 * provider metadata without depending on JSON-only auth output.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import opencodeRoutes, { parseOpencodeAuthListText } from '../server/routes/opencode.ts';

async function withFakeOpencode(script, callback) {
  /**
   * Run one status request with OPENCODE_CLI_PATH pointed at a fake CLI.
   */
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbw-opencode-status-'));
  const cliPath = path.join(tempDir, 'opencode');
  const originalCliPath = process.env.OPENCODE_CLI_PATH;
  await fs.writeFile(cliPath, script, { mode: 0o755 });
  process.env.OPENCODE_CLI_PATH = cliPath;
  try {
    return await callback();
  } finally {
    if (originalCliPath === undefined) {
      delete process.env.OPENCODE_CLI_PATH;
    } else {
      process.env.OPENCODE_CLI_PATH = originalCliPath;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function requestStatus() {
  /**
   * Query the real OpenCode status router through an isolated Express server.
   */
  const app = express();
  app.use('/api/cli/opencode', opencodeRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/cli/opencode/status`);
    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('OpenCode status falls back from unsupported JSON auth list to text providers', async () => {
  await withFakeOpencode([
    '#!/bin/sh',
    'if [ "$1 $2 $3" = "auth list --json" ]; then echo "unknown flag: --json" >&2; exit 2; fi',
    'if [ "$1 $2" = "auth list" ]; then',
    '  printf "\\033[0m\\n"',
    '  printf "┌  Credentials \\033[90m~/.local/share/opencode/auth.json\\n"',
    '  echo "│"',
    '  printf "●  DeepSeek \\033[90mapi\\n"',
    '  printf "●  Kimi For Coding \\033[90mapi\\n"',
    '  echo "└  2 credentials"',
    '  exit 0',
    'fi',
    'echo "opencode 1.0.0"',
  ].join('\n'), async () => {
    const response = await requestStatus();

    assert.equal(response.status, 200);
    assert.equal(response.body.available, true);
    assert.equal(response.body.authenticated, true);
    assert.deepEqual(response.body.providers.map((provider) => provider.name), ['DeepSeek', 'Kimi For Coding']);
    assert.equal(response.body.providers[0].authType, 'api');
    assert.equal(response.body.providers[0].api.type, 'api');
    assert.equal(response.body.providers[0].source, '~/.local/share/opencode/auth.json');
  });
});

test('OpenCode text parser keeps provider names with spaces and strips ANSI color', () => {
  const providers = parseOpencodeAuthListText('\u001b[0m\n┌  Credentials \u001b[90m/tmp/auth.json\n●  Kimi For Coding \u001b[90mapi\n');

  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, 'Kimi For Coding');
  assert.equal(providers[0].authType, 'api');
});

test('OpenCode text parser keeps full provider name when auth type is absent', () => {
  const providers = parseOpencodeAuthListText('Credentials /tmp/auth.json\n●  Kimi For Coding\n');

  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, 'Kimi For Coding');
  assert.equal(providers[0].authType, null);
  assert.equal(providers[0].api.type, null);
});

test('OpenCode status reports missing CLI without connected providers', async () => {
  const originalCliPath = process.env.OPENCODE_CLI_PATH;
  process.env.OPENCODE_CLI_PATH = path.join(os.tmpdir(), 'cbw-opencode-missing-cli');
  try {
    const response = await requestStatus();

    assert.equal(response.status, 503);
    assert.equal(response.body.available, false);
    assert.equal(response.body.authenticated, false);
    assert.deepEqual(response.body.providers, []);
    assert.match(response.body.error, /PATH=/);
  } finally {
    if (originalCliPath === undefined) {
      delete process.env.OPENCODE_CLI_PATH;
    } else {
      process.env.OPENCODE_CLI_PATH = originalCliPath;
    }
  }
});
