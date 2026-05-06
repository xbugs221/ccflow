/**
 * PURPOSE: Verify Go-backed workflow integration through fake opsx/mc JSON
 * contracts instead of the retired Node auto-runner state machine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

/**
 * Run a test body with fake Go CLIs first in PATH and restore process env.
 */
async function withFakeGoWorkflowTools(testBody) {
  const previousPath = process.env.PATH;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-go-workflow-'));
  const binDir = path.join(tempRoot, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'opsx'),
    [
      '#!/bin/sh',
      'case "$1" in',
      '  --version) echo "opsx-fake";;',
      '  list) echo \'{"changes":[{"name":"go-change"}]}\';;',
      '  status) echo "{\"name\":\"$2\",\"status\":\"active\"}";;',
      '  instructions) echo \'{"schemaName":"spec-driven","state":"ready","contextFiles":["docs/changes/go-change/tasks.md"],"progress":{"total":1,"completed":0,"remaining":1},"tasks":[]}\';;',
      '  validate) echo \'{"ok":true}\';;',
      '  archive) echo \'{"ok":true}\';;',
      '  *) echo \'{}\';;',
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(binDir, 'mc'),
    [
      '#!/bin/sh',
      'run_id="run-abc"',
      'run_dir="$PWD/.ccflow/runs/$run_id"',
      'state="$run_dir/state.json"',
      'write_state() {',
      '  mkdir -p "$run_dir/logs"',
      '  echo "runner log" > "$run_dir/logs/executor.log"',
      '  cat > "$state" <<JSON',
      '{"runId":"run-abc","changeName":"go-change","status":"$1","stage":"$2","stages":{"execution":"$1","review_1":"pending","repair_1":"pending","archive":"pending"},"paths":{"executor_log":".ccflow/runs/run-abc/logs/executor.log"},"sessions":{"executor":"codex-exec-thread"},"error":"$3"}',
      'JSON',
      '}',
      'case "$1" in',
      '  --version) echo "mc-fake";;',
      '  run) write_state running execution ""; echo \'{"runId":"run-abc","changeName":"go-change","status":"running","stage":"execution"}\';;',
      '  resume) write_state running review_1 ""; echo \'{"runId":"run-abc","changeName":"go-change","status":"running","stage":"review_1"}\';;',
      '  abort) write_state aborted review_1 "user aborted"; echo \'{"runId":"run-abc","changeName":"go-change","status":"aborted","stage":"review_1"}\';;',
      '  status) cat "$state";;',
      '  list-changes) echo \'{"changes":[{"name":"go-change"}]}\';;',
      '  *) echo "usage: mc run resume status abort --json --run-id --change";;',
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );

  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    await testBody(tempRoot);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Write the minimal docs/ OpenSpec change files expected by workflow read model.
 */
async function writeOpenSpecChange(projectPath) {
  const changeRoot = path.join(projectPath, 'docs', 'changes', 'go-change');
  await fs.mkdir(path.join(changeRoot, 'specs'), { recursive: true });
  await fs.writeFile(path.join(changeRoot, 'proposal.md'), '# proposal\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'design.md'), '# design\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [ ] implement runner-backed workflow\n', 'utf8');
}

/**
 * Mark the fake OpenSpec task complete so review-stage runner states are valid.
 */
async function completeOpenSpecChangeTasks(projectPath) {
  await fs.writeFile(
    path.join(projectPath, 'docs', 'changes', 'go-change', 'tasks.md'),
    '- [x] implement runner-backed workflow\n',
    'utf8',
  );
}

test('Go-backed workflow persists run id and maps state.json into the read model', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(projectPath, { recursive: true });
    await writeOpenSpecChange(projectPath);

    const importKey = encodeURIComponent(`${tempRoot}-create`);
    const {
      createProjectWorkflow,
      buildWorkflowLauncherConfig,
      getProjectWorkflow,
      updateWorkflowStageProviders,
    } = await import(`../../server/workflows.js?go=${importKey}`);

    const workflow = await createProjectWorkflow(project, {
      title: 'Go runner adoption',
      objective: 'Use the external runner as source of truth',
      openspecChangeName: 'go-change',
      stageProviders: { execution: 'claude' },
    });

    assert.equal(workflow.runner, 'go');
    assert.equal(workflow.runnerProvider, 'codex');
    assert.equal(workflow.runId, 'run-abc');
    assert.equal(workflow.stage, 'execution');
    assert.equal(workflow.runState, 'running');
    assert.equal(workflow.stageStatuses.find((stage) => stage.key === 'execution')?.status, 'active');
    assert.ok(workflow.artifacts.some((artifact) => artifact.relativePath === '.ccflow/runs/run-abc/logs/executor.log'));
    assert.deepEqual(
      workflow.runnerProcesses.find((process) => process.stage === 'execution'),
      {
        stage: 'execution',
        role: 'executor',
        status: 'running',
        sessionId: 'codex-exec-thread',
        logPath: '.ccflow/runs/run-abc/logs/executor.log',
      },
    );
    assert.deepEqual(
      workflow.runnerProcesses.find((process) => process.stage === 'repair_1'),
      {
        stage: 'repair_1',
        role: 'executor',
        status: 'pending',
      },
    );
    assert.deepEqual(
      workflow.runnerProcesses.find((process) => process.stage === 'archive'),
      {
        stage: 'archive',
        role: 'executor',
        status: 'pending',
      },
    );
    assert.deepEqual(
      workflow.childSessions.find((session) => session.id === 'codex-exec-thread'),
      {
        id: 'codex-exec-thread',
        routeIndex: 1,
        title: '执行',
        summary: '执行',
        provider: 'codex',
        workflowId: 'w1',
        stageKey: 'execution',
      },
    );

    const stored = JSON.parse(await fs.readFile(path.join(projectPath, '.ccflow', 'conf.json'), 'utf8'));
    assert.equal(stored.workflows['1'].runner, 'go');
    assert.equal(stored.workflows['1'].runnerProvider, 'codex');
    assert.equal(stored.workflows['1'].runId, 'run-abc');

    await assert.rejects(
      () => updateWorkflowStageProviders(project, workflow.id, { review_1: 'claude' }),
      /only support Codex/,
    );
    await assert.rejects(
      () => buildWorkflowLauncherConfig(project, workflow.id, 'execution'),
      /Go-backed workflows are controlled by the Go runner/,
    );

    const refreshed = await getProjectWorkflow(project, workflow.id);
    assert.equal(refreshed.runId, 'run-abc');
    assert.equal(refreshed.runnerError, '');
    assert.equal(refreshed.childSessions.find((session) => session.id === 'codex-exec-thread')?.routeIndex, 1);
  });
});

test('Go-backed workflow prefers runner processes and preserves process metadata', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(path.join(projectPath, '.ccflow', 'runs', 'run-abc', 'logs'), { recursive: true });
    await writeOpenSpecChange(projectPath);
    await fs.writeFile(
      path.join(projectPath, '.ccflow', 'runs', 'run-abc', 'state.json'),
      JSON.stringify({
        runId: 'run-abc',
        changeName: 'go-change',
        status: 'running',
        stage: 'review_1',
        stages: { execution: 'completed', review_1: 'running' },
        paths: { reviewer_log: '.ccflow/runs/run-abc/logs/reviewer.log' },
        sessions: { reviewer: 'fallback-review-thread' },
        processes: [{
          stage: 'review_1',
          role: 'reviewer',
          status: 'running',
          sessionId: 'codex-review-thread',
          pid: 12345,
          exitCode: 7,
          failed: true,
          logPath: '.ccflow/runs/run-abc/logs/reviewer.log',
        }],
      }),
      'utf8',
    );
    await fs.writeFile(path.join(projectPath, '.ccflow', 'runs', 'run-abc', 'logs', 'reviewer.log'), 'runner log\n');

    const importKey = encodeURIComponent(`${tempRoot}-processes`);
    const { getProjectWorkflow } = await import(`../../server/workflows.js?go=${importKey}`);
    await fs.writeFile(
      path.join(projectPath, '.ccflow', 'conf.json'),
      JSON.stringify({
        version: 2,
        workflows: {
          1: {
            id: 'w1',
            routeIndex: 1,
            runner: 'go',
            runnerProvider: 'codex',
            runId: 'run-abc',
            title: 'Process metadata',
            objective: 'Expose runner process rows',
            openspecChangeName: 'go-change',
            stage: 'execution',
            runState: 'running',
            chat: {},
          },
        },
      }),
      'utf8',
    );

    const workflow = await getProjectWorkflow(project, 'w1');
    assert.deepEqual(workflow.runnerProcesses, [{
      stage: 'review_1',
      role: 'reviewer',
      status: 'running',
      sessionId: 'codex-review-thread',
      pid: 12345,
      exitCode: 7,
      failed: true,
      logPath: '.ccflow/runs/run-abc/logs/reviewer.log',
    }]);
    assert.equal(workflow.childSessions.find((session) => session.id === 'codex-review-thread')?.stageKey, 'review_1');
  });
});

test('Go-backed workflow preserves runner child-session routeIndex across process reorder', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(path.join(projectPath, '.ccflow', 'runs', 'run-abc'), { recursive: true });
    await writeOpenSpecChange(projectPath);
    await fs.writeFile(
      path.join(projectPath, '.ccflow', 'conf.json'),
      JSON.stringify({
        version: 2,
        workflows: {
          1: {
            id: 'w1',
            routeIndex: 1,
            runner: 'go',
            runnerProvider: 'codex',
            runId: 'run-abc',
            title: 'Stable child routes',
            objective: 'Keep runner child routes stable',
            openspecChangeName: 'go-change',
            stage: 'execution',
            runState: 'running',
            chat: {},
          },
        },
      }),
      'utf8',
    );

    const importKey = encodeURIComponent(`${tempRoot}-stable-routes`);
    const { listProjectWorkflows } = await import(`../../server/workflows.js?go=${importKey}`);
    await fs.writeFile(
      path.join(projectPath, '.ccflow', 'runs', 'run-abc', 'state.json'),
      JSON.stringify({
        runId: 'run-abc',
        changeName: 'go-change',
        status: 'running',
        stage: 'review_1',
        stages: { execution: 'completed', review_1: 'running' },
        paths: {},
        sessions: {},
        processes: [
          { stage: 'execution', role: 'executor', status: 'completed', sessionId: 'codex-exec-thread' },
          { stage: 'review_1', role: 'reviewer', status: 'running', sessionId: 'codex-review-thread' },
        ],
      }),
      'utf8',
    );
    const firstRead = (await listProjectWorkflows(projectPath))[0];
    assert.equal(firstRead.childSessions.find((session) => session.id === 'codex-exec-thread')?.routeIndex, 1);
    assert.equal(firstRead.childSessions.find((session) => session.id === 'codex-review-thread')?.routeIndex, 2);

    await fs.writeFile(
      path.join(projectPath, '.ccflow', 'runs', 'run-abc', 'state.json'),
      JSON.stringify({
        runId: 'run-abc',
        changeName: 'go-change',
        status: 'running',
        stage: 'repair_1',
        stages: { execution: 'completed', review_1: 'completed', repair_1: 'running' },
        paths: {},
        sessions: {},
        processes: [
          { stage: 'repair_1', role: 'executor', status: 'running', sessionId: 'codex-repair-thread' },
          { stage: 'review_1', role: 'reviewer', status: 'completed', sessionId: 'codex-review-thread' },
          { stage: 'execution', role: 'executor', status: 'completed', sessionId: 'codex-exec-thread' },
        ],
      }),
      'utf8',
    );
    const secondRead = (await listProjectWorkflows(projectPath))[0];
    assert.equal(secondRead.childSessions.find((session) => session.id === 'codex-exec-thread')?.routeIndex, 1);
    assert.equal(secondRead.childSessions.find((session) => session.id === 'codex-review-thread')?.routeIndex, 2);
    assert.equal(secondRead.childSessions.find((session) => session.id === 'codex-repair-thread')?.routeIndex, 3);
  });
});

test('Go-backed workflow maps runner execution, review, repair, and archive stage statuses', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(path.join(projectPath, '.ccflow', 'runs', 'run-abc'), { recursive: true });
    await writeOpenSpecChange(projectPath);
    await fs.writeFile(
      path.join(projectPath, '.ccflow', 'conf.json'),
      JSON.stringify({
        version: 2,
        workflows: {
          1: {
            id: 'w1',
            routeIndex: 1,
            runner: 'go',
            runnerProvider: 'codex',
            runId: 'run-abc',
            title: 'Stage mapping',
            objective: 'Map all Go runner stages',
            openspecChangeName: 'go-change',
            stage: 'execution',
            runState: 'running',
            chat: {},
          },
        },
      }),
      'utf8',
    );

    const importKey = encodeURIComponent(`${tempRoot}-stage-mapping`);
    const { getProjectWorkflow } = await import(`../../server/workflows.js?go=${importKey}`);
    const cases = [
      ['execution', 'running', 'execution', 'active'],
      ['review_1', 'running', 'review_1', 'active'],
      ['repair_1', 'running', 'repair_1', 'active'],
      ['archive', 'completed', 'archive', 'completed'],
    ];

    for (const [runnerStage, runnerStatus, expectedStage, expectedStatus] of cases) {
      await fs.writeFile(
        path.join(projectPath, '.ccflow', 'runs', 'run-abc', 'state.json'),
        JSON.stringify({
          runId: 'run-abc',
          changeName: 'go-change',
          status: runnerStatus,
          stage: runnerStage,
          stages: { [runnerStage]: runnerStatus },
          paths: {},
          sessions: {},
        }),
        'utf8',
      );
      const workflow = await getProjectWorkflow(project, 'w1');
      assert.equal(workflow.stage, expectedStage);
      assert.equal(workflow.stageStatuses.find((stage) => stage.key === expectedStage)?.status, expectedStatus);
    }
  });
});

test('Go-backed workflow resume and abort refresh state from runner state.json', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(projectPath, { recursive: true });
    await writeOpenSpecChange(projectPath);

    const importKey = encodeURIComponent(`${tempRoot}-resume`);
    const {
      abortWorkflowRun,
      createProjectWorkflow,
      resumeWorkflowRun,
    } = await import(`../../server/workflows.js?go=${importKey}`);

    const workflow = await createProjectWorkflow(project, {
      title: 'Resume Go runner',
      objective: 'Resume and abort through mc JSON commands',
      openspecChangeName: 'go-change',
    });
    await completeOpenSpecChangeTasks(projectPath);

    const resumed = await resumeWorkflowRun(project, workflow.id);
    assert.equal(resumed.stage, 'review_1');
    assert.equal(resumed.runState, 'running');
    assert.equal(resumed.stageStatuses.find((stage) => stage.key === 'review_1')?.status, 'active');

    const aborted = await abortWorkflowRun(project, workflow.id);
    assert.equal(aborted.stage, 'review_1');
    assert.equal(aborted.runState, 'blocked');
    assert.equal(aborted.runnerError, 'user aborted');
    assert.equal(aborted.stageStatuses.find((stage) => stage.key === 'review_1')?.status, 'blocked');
  });
});

test('Go runner client accepts state-publishing commands that exit immediately', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    await fs.mkdir(projectPath, { recursive: true });

    const importKey = encodeURIComponent(`${tempRoot}-immediate-exit`);
    const {
      startGoWorkflowRun,
      resumeGoWorkflowRun,
    } = await import(`../../server/domains/workflows/go-runner-client.js?go=${importKey}`);

    const started = await startGoWorkflowRun(projectPath, 'go-change');
    assert.equal(started.runId, 'run-abc');
    assert.equal(Number.isInteger(started.pid), true);

    const resumed = await resumeGoWorkflowRun(projectPath, 'run-abc');
    assert.equal(resumed.runId, 'run-abc');
    assert.equal(resumed.stage, 'review_1');
  });
});
