/**
 * PURPOSE: Verify ccflow follows the oz/wo workflow contract and renders wo
 * display lines from sealed state files.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listOpenSpecChanges } from '../../server/domains/openspec/oz-client.js';
import { startGoWorkflowRun } from '../../server/domains/workflows/go-runner-client.js';
import { listWoWorkflowReadModels } from '../../server/domains/workflows/wo-read-model.js';

async function writeExecutable(filePath, content) {
  /**
   * Create one fake CLI binary on PATH for contract-level workflow tests.
   */
  await fs.writeFile(filePath, content, { mode: 0o755 });
}

async function withFakePath(callback) {
  /**
   * Run a test with only fake oz/wo commands prepended, proving old command
   * names are not required.
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-wo-contract-'));
  const binDir = path.join(tempRoot, 'bin');
  const projectPath = path.join(tempRoot, 'project');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
  try {
    await callback({ tempRoot, binDir, projectPath });
  } finally {
    process.env.PATH = originalPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('oz list and wo run use the new command names and .wo run root', async () => {
  await withFakePath(async ({ binDir, projectPath }) => {
    await writeExecutable(path.join(binDir, 'oz'), [
      '#!/bin/sh',
      'if [ "$1" = "list" ]; then echo \'{"changes":[{"name":"1-适配wo-oz并展示新版工作流输出"}]}\'; exit 0; fi',
      'echo "{}"',
    ].join('\n'));
    await writeExecutable(path.join(binDir, 'wo'), [
      '#!/bin/sh',
      'if [ "$1" = "run" ]; then',
      '  run_id="run-a"',
      '  mkdir -p "$PWD/.wo/runs/$run_id/logs"',
      '  cat > "$PWD/.wo/runs/$run_id/state.json" <<JSON',
      '{"run_id":"run-a","change_name":"1-适配wo-oz并展示新版工作流输出","status":"running","stage":"execution","stages":{"execution":"running"},"sessions":{"execution":"codex-exec-thread"},"paths":{"executor_log":".wo/runs/run-a/logs/executor.log"}}',
      'JSON',
      '  echo \'{"run_id":"run-a","change_name":"1-适配wo-oz并展示新版工作流输出"}\'',
      '  exit 0',
      'fi',
      'echo "{}"',
    ].join('\n'));

    assert.deepEqual(await listOpenSpecChanges(projectPath), ['1-适配wo-oz并展示新版工作流输出']);
    const result = await startGoWorkflowRun(projectPath, '1-适配wo-oz并展示新版工作流输出');
    assert.equal(result.run_id, 'run-a');
    await assert.rejects(() => fs.access(path.join(projectPath, '.ccflow', 'runs', 'run-a', 'state.json')));

    const workflows = await listWoWorkflowReadModels(projectPath);
    assert.equal(workflows[0].runId, 'run-a');
    assert.equal(workflows[0].workflowDisplay.lines[0].text, 'start');
    assert.equal(workflows[0].workflowDisplay.lines[0].marker, '→');
  });
});

test('wo read model emits only happened display lines and session warnings', async () => {
  await withFakePath(async ({ projectPath }) => {
    const runRoot = path.join(projectPath, '.wo', 'runs');
    await fs.mkdir(path.join(runRoot, 'run-review'), { recursive: true });
    await fs.writeFile(path.join(runRoot, 'run-review', 'state.json'), JSON.stringify({
      run_id: 'run-review',
      change_name: 'change-a',
      status: 'running',
      stage: 'review_1',
      stages: { execution: 'completed', review_1: 'running' },
      sessions: { execution: 'codex-exec-thread', review_1: 'codex-review-thread' },
    }));
    await fs.mkdir(path.join(runRoot, 'run-archive'), { recursive: true });
    await fs.writeFile(path.join(runRoot, 'run-archive', 'state.json'), JSON.stringify({
      run_id: 'run-archive',
      change_name: 'change-a',
      status: 'running',
      stage: 'archive',
      stages: { execution: 'completed', review_1: 'completed', archive: 'running' },
    }));
    await fs.mkdir(path.join(runRoot, 'run-repair'), { recursive: true });
    await fs.writeFile(path.join(runRoot, 'run-repair', 'state.json'), JSON.stringify({
      run_id: 'run-repair',
      change_name: 'change-a',
      status: 'running',
      stage: 'review_2',
      stages: { execution: 'completed', review_1: 'completed', repair_1: 'completed', review_2: 'running' },
      workflow_display: {
        lines: [
          { id: 'manual', marker: '→', text: 'review', raw_line: '→ review unknown-thread.jsonl', stage_key: 'review_1' },
        ],
      },
      processes: [
        { stage: 'review_1', role: 'reviewer', status: 'running', sessionId: 'actual-review-thread' },
      ],
    }));

    const byId = new Map((await listWoWorkflowReadModels(projectPath)).map((workflow) => [workflow.runId, workflow]));
    assert.deepEqual(byId.get('run-review').workflowDisplay.lines.map((line) => `${line.marker} ${line.text}`), ['✓ start', '→ review']);
    assert.deepEqual(byId.get('run-archive').workflowDisplay.lines.map((line) => line.text), ['start', 'review', 'archive']);
    assert.ok(!byId.get('run-archive').workflowDisplay.lines.some((line) => line.text === '1 fix'));
    assert.deepEqual(byId.get('run-repair').workflowDisplay.lines.map((line) => line.text), ['review']);
    assert.deepEqual(byId.get('run-repair').workflowDisplay.lines[0].sessionRef, {
      label: 'unknown-thread.jsonl',
      stageKey: 'review_1',
    });
    assert.ok(byId.get('run-repair').diagnostics.warnings.some((warning) => warning.includes('unknown-thread.jsonl')));
  });
});
