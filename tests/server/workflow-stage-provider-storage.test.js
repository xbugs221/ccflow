/**
 * PURPOSE: Verify workflow stage provider choices are stored on stageStatuses
 * instead of a duplicate stageProviders map.
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
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-workflow-stage-provider-'));
  const project = { name: 'workflow-stage-provider-project', path: projectPath, fullPath: projectPath };
  try {
    await testBody({ project, projectPath });
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
}

test('workflow provider choices persist in stageStatuses without duplicate stageProviders', async () => {
  await withWorkflowProject(async ({ project, projectPath }) => {
    const workflow = await createProjectWorkflow(project, {
      title: 'Provider storage',
      objective: 'Provider storage',
      adoptsExistingOpenSpec: true,
      stageProviders: {
        execution: 'claude',
        repair_1: 'claude',
        archive: 'claude',
      },
    });

    assert.equal(workflow.stageProviders, undefined);
    assert.equal(workflow.stageStatuses.find((stage) => stage.key === 'execution')?.provider, 'claude');
    assert.equal(workflow.stageStatuses.find((stage) => stage.key === 'repair_1')?.provider, 'claude');

    const configPath = path.join(projectPath, '.ccflow', 'conf.json');
    const persisted = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const persistedWorkflow = persisted.workflows['1'];
    assert.equal(Object.prototype.hasOwnProperty.call(persistedWorkflow, 'stageProviders'), false);
    assert.equal(
      persistedWorkflow.stageStatuses.find((stage) => stage.key === 'archive')?.provider,
      'claude',
    );

    const refreshed = await getProjectWorkflow(project, 'w1');
    assert.equal(refreshed.stageProviders, undefined);
    assert.equal(refreshed.stageStatuses.find((stage) => stage.key === 'archive')?.provider, 'claude');
  });
});
