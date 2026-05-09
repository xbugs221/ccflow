/**
 * PURPOSE: Verify durable runner turns use minimal runtime state for Codex/OpenCode.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendTurnEvent,
  buildStartTurnRequest,
  recoverRunnerTurns,
  startRunnerTurn,
  writeTurnState,
  __buildRunnerLaunchCommandForTest,
} from '../server/runner-turns.js';

/**
 * Create an isolated turn runtime root and restore env after the test.
 */
async function withRuntimeRoot(fn) {
  const originalTurnsDir = process.env.CCFLOW_TURNS_DIR;
  const originalFakeRunner = process.env.CCFLOW_FAKE_RUNNER;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-runner-turns-'));
  process.env.CCFLOW_TURNS_DIR = root;
  process.env.CCFLOW_FAKE_RUNNER = '1';
  try {
    await fn(root);
  } finally {
    if (originalTurnsDir === undefined) delete process.env.CCFLOW_TURNS_DIR;
    else process.env.CCFLOW_TURNS_DIR = originalTurnsDir;
    if (originalFakeRunner === undefined) delete process.env.CCFLOW_FAKE_RUNNER;
    else process.env.CCFLOW_FAKE_RUNNER = originalFakeRunner;
    await fs.rm(root, { recursive: true, force: true });
  }
}

/**
 * Poll one runner turn until it leaves running state.
 */
async function waitForTerminalTurn(turnDir) {
  for (let index = 0; index < 20; index += 1) {
    const turn = JSON.parse(await fs.readFile(path.join(turnDir, 'turn.json'), 'utf8'));
    if (turn.status !== 'running') {
      return turn;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return JSON.parse(await fs.readFile(path.join(turnDir, 'turn.json'), 'utf8'));
}

test('StartTurn accepts only Codex and OpenCode providers', () => {
  assert.equal(buildStartTurnRequest({ provider: 'codex', projectPath: '/tmp/a' }).provider, 'codex');
  assert.equal(buildStartTurnRequest({ provider: 'opencode', projectPath: '/tmp/a' }).provider, 'opencode');
  assert.throws(() => buildStartTurnRequest({ provider: 'claude' }), /codex.*opencode/);
});

test('fake runner turn creates only turn.json and events.jsonl', { concurrency: false }, async () => {
  await withRuntimeRoot(async () => {
    const { turnDir } = await startRunnerTurn({
      provider: 'codex',
      projectPath: process.cwd(),
      prompt: 'hello',
      ccflowSessionId: 'c1',
      clientRequestId: 'req-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    const entries = (await fs.readdir(turnDir)).sort();
    assert.deepEqual(entries, ['events.jsonl', 'turn.json']);
    const turn = JSON.parse(await fs.readFile(path.join(turnDir, 'turn.json'), 'utf8'));
    assert.equal(Object.hasOwn(turn, 'scopeUnit'), true);
  });
});

test('turn.json omits prompt, attachments and UI metadata', { concurrency: false }, async () => {
  await withRuntimeRoot(async () => {
    const { turnDir } = await startRunnerTurn({
      provider: 'opencode',
      projectPath: process.cwd(),
      prompt: 'secret prompt',
      ccflowSessionId: 'c2',
      clientRequestId: 'req-2',
      attachments: [{ name: 'a.txt', content: 'not allowed' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    const turn = JSON.parse(await fs.readFile(path.join(turnDir, 'turn.json'), 'utf8'));
    for (const forbidden of ['prompt', 'attachments', 'summary', 'label', 'favorite', 'hidden', 'routeIndex']) {
      assert.equal(Object.hasOwn(turn, forbidden), false, `${forbidden} must not be persisted`);
    }
  });
});

test('fake runner persists provider events in send order before completion', { concurrency: false }, async () => {
  await withRuntimeRoot(async () => {
    const { turnDir } = await startRunnerTurn({
      provider: 'opencode',
      projectPath: process.cwd(),
      prompt: 'ordered events',
      ccflowSessionId: 'c-order',
      clientRequestId: 'req-order',
    });

    const turn = await waitForTerminalTurn(turnDir);
    assert.equal(turn.status, 'completed');

    const events = (await fs.readFile(path.join(turnDir, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.type),
      ['session-created', 'opencode-response', 'opencode-complete'],
    );
  });
});

test('runner does not duplicate provider error events when CLI fails', { concurrency: false }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-runner-failure-'));
  const binDir = path.join(root, 'bin');
  const turnDir = path.join(root, 'turn');
  const fakeOpencode = path.join(binDir, 'opencode');
  const previousFakeRunner = process.env.CCFLOW_FAKE_RUNNER;

  try {
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(fakeOpencode, '#!/bin/sh\necho "opencode failed once" >&2\nexit 2\n', 'utf8');
    await fs.chmod(fakeOpencode, 0o755);
    if (previousFakeRunner === undefined) delete process.env.CCFLOW_FAKE_RUNNER;
    else process.env.CCFLOW_FAKE_RUNNER = previousFakeRunner;

    await writeTurnState(turnDir, {
      turnId: 'failed-turn',
      provider: 'opencode',
      status: 'running',
      projectPath: process.cwd(),
      ccflowSessionId: 'c-failed',
      providerSessionId: null,
      clientRequestId: 'req-failed',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    await fs.writeFile(path.join(turnDir, 'events.jsonl'), '', 'utf8');

    const request = {
      provider: 'opencode',
      projectPath: process.cwd(),
      prompt: 'fail once',
      ccflowSessionId: 'c-failed',
      clientRequestId: 'req-failed',
    };
    const encodedRequest = Buffer.from(JSON.stringify(request)).toString('base64url');
    const child = spawn(process.execPath, [
      path.join(process.cwd(), 'server', 'ccflow-runner.js'),
      '--turn-dir',
      turnDir,
      '--request',
      encodedRequest,
    ], {
      env: {
        ...process.env,
        OPENCODE_CLI_PATH: fakeOpencode,
        CCFLOW_FAKE_RUNNER: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const exitCode = await new Promise((resolve) => {
      child.on('close', resolve);
    });
    assert.equal(exitCode, 1);

    const turn = JSON.parse(await fs.readFile(path.join(turnDir, 'turn.json'), 'utf8'));
    assert.equal(turn.status, 'failed');

    const eventTypes = (await fs.readFile(path.join(turnDir, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).type);
    assert.deepEqual(eventTypes, ['opencode-error']);
  } finally {
    if (previousFakeRunner === undefined) delete process.env.CCFLOW_FAKE_RUNNER;
    else process.env.CCFLOW_FAKE_RUNNER = previousFakeRunner;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('restart recovery tails live running turns and marks dead pids stale', { concurrency: false }, async () => {
  await withRuntimeRoot(async (root) => {
    const liveDir = path.join(root, 'live-turn');
    const staleDir = path.join(root, 'stale-turn');
    await writeTurnState(liveDir, {
      turnId: 'live-turn',
      provider: 'codex',
      status: 'running',
      projectPath: process.cwd(),
      ccflowSessionId: 'c3',
      providerSessionId: null,
      clientRequestId: 'req-3',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    await fs.writeFile(path.join(liveDir, 'events.jsonl'), '', 'utf8');
    await writeTurnState(staleDir, {
      turnId: 'stale-turn',
      provider: 'opencode',
      status: 'running',
      projectPath: process.cwd(),
      ccflowSessionId: 'c4',
      providerSessionId: null,
      clientRequestId: 'req-4',
      pid: 99999999,
      startedAt: new Date().toISOString(),
    });
    await fs.writeFile(path.join(staleDir, 'events.jsonl'), '', 'utf8');

    const recovered = [];
    await recoverRunnerTurns((turnDir, state) => {
      recovered.push({ turnDir, state });
    });

    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].state.turnId, 'live-turn');

    const stale = JSON.parse(await fs.readFile(path.join(staleDir, 'turn.json'), 'utf8'));
    assert.equal(stale.status, 'stale');

    await appendTurnEvent(liveDir, { type: 'codex-response', sessionId: 's1' });
    const events = await fs.readFile(path.join(liveDir, 'events.jsonl'), 'utf8');
    assert.match(events, /codex-response/);
  });
});

test('runner launch can use a systemd user scope for service restart isolation', () => {
  const previous = process.env.CCFLOW_RUNNER_SYSTEMD_SCOPE;
  process.env.CCFLOW_RUNNER_SYSTEMD_SCOPE = '1';
  try {
    const launch = __buildRunnerLaunchCommandForTest({
      turnDir: '/tmp/ccflow-turns/t_demo',
      encodedRequest: 'eyJwcm92aWRlciI6ImNvZGV4In0',
    });
    assert.equal(launch.command, 'systemd-run');
    assert.equal(launch.detached, false);
    assert.ok(launch.args.includes('--scope'));
    assert.ok(launch.args.includes('KillMode=process'));
    assert.equal(launch.scopeUnit, 'ccflow-runner-t_demo.scope');
  } finally {
    if (previous === undefined) delete process.env.CCFLOW_RUNNER_SYSTEMD_SCOPE;
    else process.env.CCFLOW_RUNNER_SYSTEMD_SCOPE = previous;
  }
});
