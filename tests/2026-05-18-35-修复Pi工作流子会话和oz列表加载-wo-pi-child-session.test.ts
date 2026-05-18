// @ts-nocheck -- Test isolation: strict types deferred.
/**
 * PURPOSE: Verify wo read model generates provider-aware child sessions from
 * sessions-only state.json (no explicit processes), and deduplicates when
 * explicit processes and sessions role map share the same session id.
 *
 * Covers:
 * - Spec 场景：Pi executor sessions-only 状态可进入子会话
 * - Spec 场景：sessions-only 状态不伪造进程
 * - Spec 场景：explicit process 与 role session 去重
 * - Spec 场景：非 Pi provider role map 同样可路由
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { buildWoWorkflowReadModel } from '../server/domains/workflows/wo-read-model.ts';

async function writeWoState(runDir, state) {
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, 'state.json'),
    JSON.stringify(state, null, 2),
    'utf8',
  );
}

test('sessions-only pi:executor generates child session with correct provider and stage', async () => {
  const projectPath = path.join(os.tmpdir(), `cbw-pi-child-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-pi-exec');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-pi-exec',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: {
        'pi:executor': 'pi-thread-1',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWoWorkflowReadModel({
      projectPath,
      runDirName: 'run-pi-exec',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    // sessions-only: childSessions must include the Pi executor session
    const piChild = model.childSessions.find((s) => s.id === 'pi-thread-1');
    assert.ok(piChild, 'pi:executor should be in childSessions');
    assert.equal(piChild.provider, 'pi');
    assert.equal(piChild.role, 'executor');
    assert.equal(piChild.stageKey, 'execution');
    assert.equal(piChild.address, 'execution');

    // sessions-only: runnerProcesses must be empty
    assert.deepEqual(model.runnerProcesses, []);

    // No unknown stage warnings
    assert.ok(!model.diagnostics.warnings.some((w) => w.includes('Unknown runner stage')));
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('sessions-only multi-provider sessions all generate child sessions', async () => {
  const projectPath = path.join(os.tmpdir(), `cbw-multi-prov-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-multi');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-multi',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running', review_1: 'running' },
      sessions: {
        'codex:executor': 'codex-exec-1',
        'pi:executor': 'pi-exec-1',
        'codex:reviewer': 'codex-review-1',
        'pi:reviewer': 'pi-review-1',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWoWorkflowReadModel({
      projectPath,
      runDirName: 'run-multi',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    // All four session ids should be in childSessions
    const ids = model.childSessions.map((s) => s.id);
    assert.ok(ids.includes('codex-exec-1'), 'codex:executor should be in childSessions');
    assert.ok(ids.includes('pi-exec-1'), 'pi:executor should be in childSessions');
    assert.ok(ids.includes('codex-review-1'), 'codex:reviewer should be in childSessions');
    assert.ok(ids.includes('pi-review-1'), 'pi:reviewer should be in childSessions');

    // Each child session should have correct provider
    const codexExec = model.childSessions.find((s) => s.id === 'codex-exec-1');
    assert.equal(codexExec.provider, 'codex');
    assert.equal(codexExec.stageKey, 'execution');

    const piExec = model.childSessions.find((s) => s.id === 'pi-exec-1');
    assert.equal(piExec.provider, 'pi');
    assert.equal(piExec.stageKey, 'execution');

    const codexReview = model.childSessions.find((s) => s.id === 'codex-review-1');
    assert.equal(codexReview.provider, 'codex');
    assert.equal(codexReview.stageKey, 'review_1');

    const piReview = model.childSessions.find((s) => s.id === 'pi-review-1');
    assert.equal(piReview.provider, 'pi');
    assert.equal(piReview.stageKey, 'review_1');

    // Route path uniqueness: same-stage sessions with different providers
    // must have distinct routePaths so the browser can resolve the correct one.
    const routePaths = model.childSessions.map((s) => s.routePath);
    const uniqueRoutes = new Set(routePaths);
    assert.equal(uniqueRoutes.size, 4, 'All four child sessions must have distinct routePaths');

    // First provider for each stage claims the stage address.
    // Order depends on Object.entries iteration (insertion order).
    assert.equal(codexExec.address, 'execution');
    assert.ok(codexExec.routePath.endsWith('/sessions/execution'));
    assert.equal(piExec.address, 'by-id/pi-exec-1');
    assert.ok(piExec.routePath.endsWith('/sessions/by-id/pi-exec-1'));

    assert.equal(codexReview.address, 'review_1');
    assert.ok(codexReview.routePath.endsWith('/sessions/review_1'));
    assert.equal(piReview.address, 'by-id/pi-review-1');
    assert.ok(piReview.routePath.endsWith('/sessions/by-id/pi-review-1'));
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('explicit process and sessions role map deduplicate shared session id', async () => {
  const projectPath = path.join(os.tmpdir(), `cbw-dedup-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-dedup');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-dedup',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: {
        'pi:executor': 'pi-thread-1',
      },
      processes: [
        { stage: 'execution', role: 'executor', status: 'running', session_id: 'pi-thread-1', pid: 12345 },
      ],
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWoWorkflowReadModel({
      projectPath,
      runDirName: 'run-dedup',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    // childSessions should have exactly one entry for pi-thread-1
    const piChildren = model.childSessions.filter((s) => s.id === 'pi-thread-1');
    assert.equal(piChildren.length, 1, 'pi-thread-1 should appear exactly once in childSessions');

    // runnerProcesses should contain the process entry
    assert.equal(model.runnerProcesses.length, 1);
    assert.equal(model.runnerProcesses[0].pid, 12345);
    assert.equal(model.runnerProcesses[0].sessionId, 'pi-thread-1');

    // The child session should still have correct provider
    const piChild = piChildren[0];
    assert.equal(piChild.provider, 'pi');
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('stage-key sessions (review_1, fix_1) generate child sessions', async () => {
  const projectPath = path.join(os.tmpdir(), `cbw-stage-keys-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-stages');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-stages',
      contract_version: 'v1',
      status: 'running',
      stage: 'fix_1',
      stages: { execution: 'completed', review_1: 'completed', fix_1: 'running' },
      sessions: {
        review_1: 'review-session-1',
        fix_1: 'fix-session-1',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWoWorkflowReadModel({
      projectPath,
      runDirName: 'run-stages',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    const reviewChild = model.childSessions.find((s) => s.id === 'review-session-1');
    assert.ok(reviewChild, 'review_1 session should be in childSessions');
    assert.equal(reviewChild.stageKey, 'review_1');
    assert.equal(reviewChild.role, 'review_1');

    const fixChild = model.childSessions.find((s) => s.id === 'fix-session-1');
    assert.ok(fixChild, 'fix_1 session should be in childSessions');
    assert.equal(fixChild.stageKey, 'fix_1');
    assert.equal(fixChild.role, 'fix_1');
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('opencode:executor generates child session with correct provider', async () => {
  const projectPath = path.join(os.tmpdir(), `cbw-opencode-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-oc');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-oc',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: {
        'opencode:executor': 'oc-thread-1',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWoWorkflowReadModel({
      projectPath,
      runDirName: 'run-oc',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    const ocChild = model.childSessions.find((s) => s.id === 'oc-thread-1');
    assert.ok(ocChild, 'opencode:executor should be in childSessions');
    assert.equal(ocChild.provider, 'opencode');
    assert.equal(ocChild.stageKey, 'execution');

    // runnerProcesses must be empty for sessions-only
    assert.deepEqual(model.runnerProcesses, []);
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});
