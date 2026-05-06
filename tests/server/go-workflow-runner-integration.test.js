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
      '{"runId":"run-abc","changeName":"go-change","status":"$1","stage":"$2","stages":{"execution":"$1"},"paths":{"executor_log":".ccflow/runs/run-abc/logs/executor.log"},"sessions":{},"error":"$3"}',
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
