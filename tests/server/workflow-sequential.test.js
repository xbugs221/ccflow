/**
 * PURPOSE: Verify workflow stage evidence is evaluated as a strict ordered
 * chain so stale or malformed files cannot move a workflow past review/repair.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearProjectDirectoryCache,
} from '../../server/projects.js';
import {
  createProjectWorkflow,
  listProjectWorkflows,
} from '../../server/workflows.js';
import {
  resolveWorkflowAutoAction,
} from '../../server/workflow-auto-runner.js';

const STAGE_STATUSES = [
  ['planning', '规划提案'],
  ['execution', '执行'],
  ['review_1', '初审'],
  ['repair_1', '初修'],
  ['review_2', '再审'],
  ['repair_2', '再修'],
  ['review_3', '三审'],
  ['repair_3', '三修'],
  ['archive', '归档'],
].map(([key, label]) => ({ key, label, status: 'completed' }));

let homeIsolationQueue = Promise.resolve();

/**
 * PURPOSE: Run one test with isolated HOME/PATH so workflow config and the
 * fake OpenSpec CLI cannot leak into other tests.
 */
async function withWorkflowProject(testBody) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-workflow-sequential-test-'));
    const binDir = path.join(tempHome, 'bin');
    const projectPath = path.join(tempHome, 'workspace', 'project');

    process.env.HOME = tempHome;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
    clearProjectDirectoryCache();

    try {
      await fs.mkdir(binDir, { recursive: true });
      await fs.mkdir(projectPath, { recursive: true });
      await fs.writeFile(
        path.join(binDir, 'openspec'),
        [
          '#!/usr/bin/env node',
          'console.log(JSON.stringify({ changes: [{ name: "1-demo", status: "active", completedTasks: 1, totalTasks: 1 }] }));',
        ].join('\n'),
        { mode: 0o755 },
      );

      const project = { name: 'workflow-sequential-project', path: projectPath, fullPath: projectPath };
      const workflow = await createProjectWorkflow(project, {
        title: '严格顺序工作流',
        objective: '验证评审修复归档顺序',
      });
      await rewriteWorkflow(projectPath, workflow.id, {
        stage: 'archive',
        runState: 'running',
        openspecChangeName: '1-demo',
        openspecChangePrefix: '1',
        adoptsExistingOpenSpec: true,
        stageStatuses: STAGE_STATUSES,
      });

      await testBody({ project, projectPath, workflowId: workflow.id });
    } finally {
      clearProjectDirectoryCache();
      process.env.PATH = originalPath || '';
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
 * PURPOSE: Update the persisted workflow record without going through UI routes.
 */
async function rewriteWorkflow(projectPath, workflowId, patch) {
  const configPath = path.join(projectPath, '.ccflow', 'conf.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const workflowIndex = String(workflowId).replace(/^w/, '');
  config.workflows[workflowIndex] = {
    ...config.workflows[workflowIndex],
    ...patch,
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * PURPOSE: Write one workflow artifact with deterministic mtime ordering.
 */
async function writeWorkflowArtifact(projectPath, workflowId, filename, content, mtimeMs) {
  const artifactPath = path.join(projectPath, '.ccflow', String(workflowId).replace(/^w/, ''), filename);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, content, 'utf8');
  const mtime = new Date(mtimeMs);
  await fs.utimes(artifactPath, mtime, mtime);
}

/**
 * PURPOSE: Write the full ordered evidence chain through review 3.
 */
async function writeEvidenceThroughReview3(projectPath, workflowId, review3Decision = 'blocked') {
  await writeWorkflowArtifact(projectPath, workflowId, 'review-1.json', JSON.stringify({ decision: 'blocked', findings: [{ title: 'fix 1' }] }), 1000);
  await writeWorkflowArtifact(projectPath, workflowId, 'repair-1-summary.md', '# repair 1\n', 2000);
  await writeWorkflowArtifact(projectPath, workflowId, 'review-2.json', JSON.stringify({ decision: 'needs_repair', findings: [{ title: 'fix 2' }] }), 3000);
  await writeWorkflowArtifact(projectPath, workflowId, 'repair-2-summary.md', '# repair 2\n', 4000);
  await writeWorkflowArtifact(projectPath, workflowId, 'review-3.json', JSON.stringify({ decision: review3Decision, findings: [{ title: 'fix 3' }] }), 5000);
}

test('blocked review 3 keeps stale archive pending until repair 3 evidence exists', { concurrency: false }, async () => {
  await withWorkflowProject(async ({ project, projectPath, workflowId }) => {
    await writeEvidenceThroughReview3(projectPath, workflowId, 'blocked');
    await writeWorkflowArtifact(projectPath, workflowId, 'delivery-summary.md', '# stale archive\n', 6000);

    const [workflow] = await listProjectWorkflows(projectPath);
    assert.equal(workflow.stageStatuses.find((stage) => stage.key === 'archive')?.status, 'pending');
    assert.equal(workflow.stageStatuses.find((stage) => stage.key === 'repair_3')?.status, 'pending');

    const action = await resolveWorkflowAutoAction(project, workflow);
    assert.equal(action?.stage, 'repair_3');
  });
});

test('fresh repair 3 evidence allows archive completion after a blocked review 3', { concurrency: false }, async () => {
  await withWorkflowProject(async ({ project, projectPath, workflowId }) => {
    await writeEvidenceThroughReview3(projectPath, workflowId, 'blocked');
    await writeWorkflowArtifact(projectPath, workflowId, 'repair-3-summary.md', '# repair 3\n', 6000);
    await writeWorkflowArtifact(projectPath, workflowId, 'delivery-summary.md', '# archive\n', 7000);

    const [workflow] = await listProjectWorkflows(projectPath);
    assert.equal(workflow.stage, 'archive');
    assert.equal(workflow.runState, 'completed');
    assert.equal(workflow.stageStatuses.find((stage) => stage.key === 'repair_3')?.status, 'completed');
    assert.equal(workflow.stageStatuses.find((stage) => stage.key === 'archive')?.status, 'completed');

    const action = await resolveWorkflowAutoAction(project, workflow);
    assert.equal(action, null);
  });
});

test('malformed review JSON does not complete review or archive', { concurrency: false }, async () => {
  await withWorkflowProject(async ({ projectPath, workflowId }) => {
    await writeWorkflowArtifact(projectPath, workflowId, 'review-1.json', JSON.stringify({ decision: 'clean', findings: [] }), 1000);
    await writeWorkflowArtifact(projectPath, workflowId, 'repair-1-summary.md', '# repair 1\n', 2000);
    await writeWorkflowArtifact(projectPath, workflowId, 'review-2.json', JSON.stringify({ decision: 'clean', findings: [] }), 3000);
    await writeWorkflowArtifact(projectPath, workflowId, 'repair-2-summary.md', '# repair 2\n', 4000);
    await writeWorkflowArtifact(projectPath, workflowId, 'review-3.json', '{not-json', 5000);
    await writeWorkflowArtifact(projectPath, workflowId, 'delivery-summary.md', '# stale archive\n', 6000);

    const [workflow] = await listProjectWorkflows(projectPath);
    assert.notEqual(workflow.stageStatuses.find((stage) => stage.key === 'review_3')?.status, 'completed');
    assert.notEqual(workflow.stageStatuses.find((stage) => stage.key === 'archive')?.status, 'completed');
  });
});
