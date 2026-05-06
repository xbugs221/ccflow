/**
 * PURPOSE: Verify Go-backed workflows keep automatic stage ownership fixed to
 * Codex and do not persist legacy duplicate stageProviders maps.
 */
import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import test from 'node:test';

import {
  createProjectWorkflow,
  getProjectWorkflow,
} from '../../server/workflows.js';

/**
 * PURPOSE: Create an isolated project path for workflow persistence tests.
 */
async function withWorkflowProject(testBody) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-workflow-stage-provider-'));
  const binDir = path.join(tempRoot, 'bin');
  const projectPath = path.join(tempRoot, 'project');
  const previousPath = process.env.PATH;
  const project = { name: 'workflow-stage-provider-project', path: projectPath, fullPath: projectPath };
  try {
    await fs.mkdir(projectPath, { recursive: true });
    await writeFakeGoTools(binDir);
    await writeOpenSpecChange(projectPath, 'provider-storage');
    process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
    await testBody({ project, projectPath });
  } finally {
    process.env.PATH = previousPath || '';
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * PURPOSE: Provide minimal opsx/mc commands for the workflow creation contract.
 */
async function writeFakeGoTools(binDir) {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'opsx'),
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo opsx-provider-test; exit 0; fi',
      'if [ "$1" = "list" ]; then echo \'{"changes":[{"name":"provider-storage"}]}\'; exit 0; fi',
      'if [ "$1" = "status" ]; then echo \'{"name":"provider-storage","status":"active"}\'; exit 0; fi',
      'echo \'{}\'',
    ].join('\n'),
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(binDir, 'mc'),
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo mc-provider-test; exit 0; fi',
      'if [ "$1" = "run" ]; then',
      '  mkdir -p "$PWD/.ccflow/runs/provider-run/logs"',
      '  echo log > "$PWD/.ccflow/runs/provider-run/logs/executor.log"',
      '  echo \'{"runId":"provider-run","changeName":"provider-storage","status":"running","stage":"execution","stages":{"execution":"running"},"paths":{"executor_log":".ccflow/runs/provider-run/logs/executor.log"},"sessions":{},"error":""}\' > "$PWD/.ccflow/runs/provider-run/state.json"',
      '  echo \'{"runId":"provider-run","changeName":"provider-storage","status":"running","stage":"execution"}\'',
      '  exit 0',
      'fi',
      'echo "usage: mc run resume status abort --json --run-id --change"',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/**
 * PURPOSE: Write a real docs/ change so opsx status/list can adopt it.
 */
async function writeOpenSpecChange(projectPath, changeName) {
  const changeRoot = path.join(projectPath, 'docs', 'changes', changeName);
  await fs.mkdir(path.join(changeRoot, 'specs'), { recursive: true });
  await fs.writeFile(path.join(changeRoot, 'proposal.md'), '# proposal\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'design.md'), '# design\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [ ] provider lock\n', 'utf8');
}

test('Go-backed workflows reject legacy non-Codex provider choices', async () => {
  await withWorkflowProject(async ({ project, projectPath }) => {
    const workflow = await createProjectWorkflow(project, {
      title: 'Provider storage',
      objective: 'Provider storage',
      openspecChangeName: 'provider-storage',
      stageProviders: {
        execution: 'claude',
        repair_1: 'claude',
        archive: 'claude',
      },
    });

    assert.equal(workflow.stageProviders, undefined);
    assert.equal(workflow.runner, 'go');
    assert.equal(workflow.stageStatuses.find((stage) => stage.key === 'execution')?.provider, 'codex');
    assert.equal(workflow.stageStatuses.find((stage) => stage.key === 'repair_1')?.provider, 'codex');

    const configPath = path.join(projectPath, '.ccflow', 'conf.json');
    const persisted = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const persistedWorkflow = persisted.workflows['1'];
    assert.equal(Object.prototype.hasOwnProperty.call(persistedWorkflow, 'stageProviders'), false);
    assert.equal(
      persistedWorkflow.stageStatuses.find((stage) => stage.key === 'archive')?.provider,
      undefined,
    );

    const refreshed = await getProjectWorkflow(project, 'w1');
    assert.equal(refreshed.stageProviders, undefined);
    assert.equal(refreshed.stageStatuses.find((stage) => stage.key === 'archive')?.provider, 'codex');
  });
});
