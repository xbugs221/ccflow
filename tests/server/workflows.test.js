/**
 * PURPOSE: Verify workflow stage normalization stays consistent with the
 * evidence recorded in artifacts and child sessions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run a test body with an isolated HOME directory and restore the original env.
 */
async function withTemporaryHome(testBody) {
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-workflow-test-'));

  process.env.HOME = tempHome;
  try {
    await testBody(tempHome);
  } finally {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

/**
 * Write one minimal OpenSpec tasks.md so `openspec list --json` can report task progress.
 */
async function writeOpenSpecTasks(projectPath, changeName, completedFlags = []) {
  const tasksPath = path.join(projectPath, 'openspec', 'changes', changeName, 'tasks.md');
  const lines = [
    '## 1. 测试任务',
    '',
    ...completedFlags.map((completed, index) => `- [${completed ? 'x' : ' '}] 1.${index + 1} 任务 ${index + 1}`),
    '',
  ];
  await fs.writeFile(tasksPath, `${lines.join('\n')}\n`, 'utf8');
}

function getWorkflowStorePath(projectPath) {
  return path.join(projectPath, '.ccflow', 'conf.json');
}

/**
 * Return stage status rows using the legacy aggregate verification view expected
 * by older workflow assertions.
 */
function aggregateStageStatusRows(workflow) {
  const rows = [];
  const reviewStatuses = [];
  for (const stage of workflow.stageStatuses || []) {
    if (/^review_\d+$/.test(stage.key)) {
      reviewStatuses.push(stage.status || 'pending');
      continue;
    }
    if (/^repair_\d+$/.test(stage.key)) {
      continue;
    }
    if (stage.key === 'archive') {
      rows.push(['ready_for_acceptance', stage.status]);
      continue;
    }
    rows.push([stage.key, stage.status]);
  }
  if (reviewStatuses.length > 0 && !rows.some(([key]) => key === 'verification')) {
    const status = reviewStatuses.includes('active')
      ? 'active'
      : reviewStatuses.includes('blocked')
        ? 'blocked'
        : reviewStatuses.every((item) => item === 'completed')
          ? 'completed'
          : 'pending';
    const insertIndex = rows.findIndex(([key]) => key === 'ready_for_acceptance');
    rows.splice(insertIndex >= 0 ? insertIndex : rows.length, 0, ['verification', status]);
  }
  return rows;
}

/**
 * Find one stage inspection, synthesizing the old verification aggregate from
 * split review stages when needed.
 */
function findStageInspection(workflow, stageKey) {
  if (stageKey !== 'verification') {
    return workflow.stageInspections.find((stage) => stage.stageKey === stageKey);
  }
  const existing = workflow.stageInspections.find((stage) => stage.stageKey === 'verification');
  if (existing) {
    return existing;
  }
  const reviewStages = workflow.stageInspections.filter((stage) => /^review_\d+$/.test(stage.stageKey));
  if (reviewStages.length === 0) {
    return undefined;
  }
  return {
    stageKey: 'verification',
    title: '审核',
    status: reviewStages.some((stage) => stage.status === 'active')
      ? 'active'
      : reviewStages.some((stage) => stage.status === 'blocked')
        ? 'blocked'
        : reviewStages.every((stage) => stage.status === 'completed')
          ? 'completed'
          : 'pending',
    substages: reviewStages.flatMap((stage) => stage.substages || []),
  };
}

/**
 * Build a status map with the old verification aggregate available.
 */
function stageInspectionStatusMap(workflow) {
  const entries = workflow.stageInspections
    .filter((stage) => !/^review_\d+$/.test(stage.stageKey))
    .map((stage) => [stage.stageKey, Object.fromEntries(stage.substages.map((substage) => [substage.substageKey, substage.status]))]);
  const verificationStage = findStageInspection(workflow, 'verification');
  if (verificationStage && !entries.some(([stageKey]) => stageKey === 'verification')) {
    entries.splice(
      entries.findIndex(([stageKey]) => stageKey === 'archive') || entries.findIndex(([stageKey]) => stageKey === 'ready_for_acceptance'),
      0,
      ['verification', Object.fromEntries(verificationStage.substages.map((substage) => [substage.substageKey, substage.status]))],
    );
  }
  return Object.fromEntries(entries);
}

test('workflow read model blocks later stages when planning output is missing', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(homeDir)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '不一致阶段顺序',
                objective: '验证缺失规划输出时不会越过 planning',
                stage: 'ready_for_acceptance',
                runState: 'completed',
                gateDecision: 'pass',
                finalReadiness: true,
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'completed' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'completed' },
                ],
                artifacts: [
                  { id: 'intake-request', label: 'Intake request', stage: 'intake', substageKey: 'requirement_input' },
                  { id: 'verification-evidence', label: 'verification-evidence.json', stage: 'verification', path: 'verification-evidence.json' },
                ],
                childSessions: [],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);

    assert.ok(workflow);
    assert.equal(workflow.stage, 'archive');
    assert.equal(workflow.runState, 'completed');
    assert.deepEqual(
      aggregateStageStatusRows(workflow),
      [
        ['planning', 'pending'],
        ['execution', 'pending'],
        ['verification', 'pending'],
        ['ready_for_acceptance', 'pending'],
      ],
    );

    const planningStage = workflow.stageInspections.find((stage) => stage.stageKey === 'planning');
    assert.ok(planningStage);
    assert.equal(planningStage.status, 'pending');
    assert.equal(planningStage.substages[0].substageKey, 'planner_output');
    assert.equal(planningStage.substages[0].status, 'pending');

    const repairedStore = JSON.parse(await fs.readFile(workflowStorePath, 'utf8'));
    const repairedWorkflow = repairedStore.workflows['1'];
    assert.equal(repairedWorkflow.stage ?? 'archive', 'archive');
    assert.equal(repairedWorkflow.runState, 'completed');
  });
});

test('createProjectWorkflow enters planning directly when no OpenSpec proposal is adopted', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const { createProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-create`)}`);
    const workflowStorePath = getWorkflowStorePath(projectPath);

    await fs.mkdir(projectPath, { recursive: true });
    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '新工作流', objective: '验证创建时的数据完整性' },
    );

    assert.equal(workflow.stage, 'planning');
    assert.equal(workflow.runState, 'running');
    assert.deepEqual(aggregateStageStatusRows(workflow), [
      ['planning', 'active'],
      ['execution', 'pending'],
      ['verification', 'pending'],
      ['ready_for_acceptance', 'pending'],
    ]);
    assert.deepEqual(workflow.artifacts, []);

    const planningStage = workflow.stageInspections.find((stage) => stage.stageKey === 'planning');
    assert.ok(planningStage);
    assert.equal(planningStage.status, 'active');
    assert.equal(planningStage.substages[0].substageKey, 'planner_output');
    assert.equal(planningStage.substages[0].status, 'active');

    const persistedStore = JSON.parse(await fs.readFile(workflowStorePath, 'utf8'));
    const persistedWorkflow = persistedStore.workflows['1'];
    assert.equal(persistedWorkflow.stage ?? 'planning', 'planning');
    assert.equal(persistedWorkflow.runState ?? 'running', 'running');
    assert.deepEqual(persistedWorkflow.artifacts ?? [], []);
    assert.equal(persistedWorkflow.openspecChangeName ?? '', '');
    assert.match(persistedWorkflow.openspecChangePrefix, /^\d+$/);
  });
});

test('createProjectWorkflow reserves an OpenSpec prefix and resolves the agent-created change name', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'project-prefix-bind');
    const { createProjectWorkflow, getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-prefix-bind`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    const project = { name: 'project-prefix-bind', fullPath: projectPath, path: projectPath };
    const workflow = await createProjectWorkflow(project, {
      title: '新功能',
      objective: '让 agent 自己命名 OpenSpec 变更提案',
    });

    assert.equal(workflow.openspecChangeName, '');
    assert.match(workflow.openspecChangePrefix, /^\d+$/);

    const secondWorkflow = await createProjectWorkflow(project, {
      title: '第二个新功能',
      objective: '验证未落盘的预留编号不会重复',
    });
    assert.equal(Number(secondWorkflow.openspecChangePrefix), Number(workflow.openspecChangePrefix) + 1);

    const changeName = `${workflow.openspecChangePrefix}-create-new-feature`;
    await execFileAsync('openspec', ['new', 'change', changeName], { cwd: projectPath });
    await fs.writeFile(path.join(projectPath, 'openspec', 'changes', changeName, 'proposal.md'), '# proposal\n', 'utf8');

    const refreshedWorkflow = await getProjectWorkflow(project, workflow.id);
    assert.equal(refreshedWorkflow.openspecChangeName, changeName);
    assert.equal(refreshedWorkflow.openspecChangeDetected, true);
  });
});

test('backend workflow auto runner launches planning only before a planning child session exists', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'project-backend-planning');
    const importKey = encodeURIComponent(`${homeDir}-backend-planning`);
    const { createProjectWorkflow, registerWorkflowChildSession } = await import(`../../server/workflows.js?home=${importKey}`);
    const { resolveWorkflowAutoAction } = await import(`../../server/workflow-auto-runner.js?home=${importKey}`);

    await fs.mkdir(projectPath, { recursive: true });
    const project = { name: 'project-backend-planning', fullPath: projectPath, path: projectPath };
    const workflow = await createProjectWorkflow(project, {
      title: '后端文件驱动规划',
      objective: '验证 planning 由后端基于 workflow 文件触发',
    });

    const actionBeforeSession = await resolveWorkflowAutoAction(project, workflow);
    assert.equal(actionBeforeSession?.stage, 'planning');

    const workflowWithPlanningSession = await registerWorkflowChildSession(project, workflow.id, {
      sessionId: 'codex-planning-session',
      title: '规划提案',
      summary: '规划提案',
      provider: 'codex',
      stageKey: 'planning',
      substageKey: 'planner_output',
    });
    const actionAfterSession = await resolveWorkflowAutoAction(project, workflowWithPlanningSession);
    assert.equal(actionAfterSession, null);

    const existingChangeName = 'existing-openspec-change';
    await fs.mkdir(path.join(projectPath, 'openspec', 'changes', existingChangeName), { recursive: true });
    const adoptedWorkflow = await createProjectWorkflow(project, {
      title: '复用已有变更',
      objective: '验证已有变更不会触发规划',
      openspecChangeName: existingChangeName,
    });
    const adoptedAction = await resolveWorkflowAutoAction(project, adoptedWorkflow);
    assert.notEqual(adoptedAction?.stage, 'planning');
  });
});

test('workflow stage tree exposes openspec proposal files when the change exists on disk', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const changeName = '1-existing-openspec-change';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-existing-change`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', changeName], { cwd: projectPath });
    await fs.writeFile(path.join(projectPath, 'openspec', 'changes', changeName, 'proposal.md'), '# proposal\n', 'utf8');
    await fs.writeFile(path.join(projectPath, 'openspec', 'changes', changeName, 'design.md'), '# design\n', 'utf8');
    await fs.writeFile(path.join(projectPath, 'openspec', 'changes', changeName, 'tasks.md'), '# tasks\n', 'utf8');
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '已有规划产物',
                objective: '验证磁盘已有规划文件时阶段树可直接打开',
                openspecChangeName: changeName,
                stage: 'planning',
                runState: 'running',
                gateDecision: 'pending',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'active' },
                  { key: 'execution', label: '执行', status: 'pending' },
                  { key: 'verification', label: '验证', status: 'pending' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [],
                childSessions: [],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const planningStage = workflow.stageInspections.find((stage) => stage.stageKey === 'planning');
    const proposalFiles = planningStage?.substages?.find((substage) => substage.substageKey === 'planner_output')?.files || [];
    const proposal = proposalFiles.find((artifact) => artifact.label === 'proposal.md');

    assert.ok(proposal);
    assert.equal(workflow.openspecChangeDetected, true);
    assert.equal(proposal.exists, true);
    assert.equal(proposal.status, 'ready');
    assert.equal(proposal.path, path.join(projectPath, 'openspec', 'changes', changeName, 'proposal.md'));
    assert.equal(proposal.relativePath, path.join('openspec', 'changes', changeName, 'proposal.md'));
  });
});

test('workflow stage tree opens planning files after OpenSpec change is archived', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const changeName = '2028-jsonl-agent-message-classification';
    const archivedChangeName = `2026-04-28-${changeName}`;
    const archivedChangePath = path.join(projectPath, 'openspec', 'changes', 'archive', archivedChangeName);
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-archived-change`)}`);

    await fs.mkdir(path.join(archivedChangePath, 'specs'), { recursive: true });
    await fs.writeFile(path.join(archivedChangePath, 'proposal.md'), '# proposal\n', 'utf8');
    await fs.writeFile(path.join(archivedChangePath, 'design.md'), '# design\n', 'utf8');
    await fs.writeFile(path.join(archivedChangePath, 'tasks.md'), '# tasks\n', 'utf8');
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
          {
            id: workflowId,
            title: '已归档规划产物',
            objective: '验证归档后的 OpenSpec 文件仍可从阶段树打开',
            openspecChangeName: changeName,
            stage: 'archive',
            runState: 'completed',
            gateDecision: 'pass',
            stageStatuses: [
              { key: 'planning', label: '规划', status: 'completed' },
              { key: 'execution', label: '执行', status: 'completed' },
              { key: 'archive', label: '归档', status: 'completed' },
            ],
            artifacts: [],
            childSessions: [],
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const planningStage = workflow.stageInspections.find((stage) => stage.stageKey === 'planning');
    const proposalFiles = planningStage?.substages?.find((substage) => substage.substageKey === 'planner_output')?.files || [];
    const proposal = proposalFiles.find((artifact) => artifact.label === 'proposal.md');

    assert.ok(proposal);
    assert.equal(workflow.openspecChangeDetected, true);
    assert.equal(workflow.openspecArtifactChangeName, path.join('archive', archivedChangeName));
    assert.equal(proposal.exists, true);
    assert.equal(proposal.status, 'ready');
    assert.equal(proposal.path, path.join(archivedChangePath, 'proposal.md'));
    assert.equal(proposal.relativePath, path.join('openspec', 'changes', 'archive', archivedChangeName, 'proposal.md'));
  });
});

test('createProjectWorkflow can adopt an existing OpenSpec change and mark it as detected', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const changeName = '1-adopt-existing-change';
    const { createProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-adopt`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', changeName], { cwd: projectPath });

    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      {
        title: '接手已有提案',
        objective: '验证 workflow 可以绑定现有 OpenSpec proposal',
        openspecChangeName: changeName,
      },
    );

    assert.equal(workflow.openspecChangeName, changeName);
    assert.equal(workflow.openspecChangeDetected, true);
    assert.equal(workflow.stage, 'execution');
    assert.deepEqual(aggregateStageStatusRows(workflow), [
      ['planning', 'completed'],
      ['execution', 'active'],
      ['verification', 'pending'],
      ['ready_for_acceptance', 'pending'],
    ]);
  });
});

test('createProjectWorkflow advances completed adopted OpenSpec change to initial review', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const changeName = '1-adopt-completed-change';
    const { createProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-adopt-completed`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', changeName], { cwd: projectPath });
    await writeOpenSpecTasks(projectPath, changeName, [true, true]);

    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      {
        title: '接手已完成提案',
        objective: '验证已完成 OpenSpec proposal 接入 workflow 后自动进入初审',
        openspecChangeName: changeName,
      },
    );

    const reviewStage = findStageInspection(workflow, 'review_1');

    assert.equal(workflow.openspecChangeName, changeName);
    assert.equal(workflow.openspecChangeDetected, true);
    assert.equal(workflow.stage, 'review_1');
    assert.deepEqual(aggregateStageStatusRows(workflow), [
      ['planning', 'completed'],
      ['execution', 'completed'],
      ['verification', 'active'],
      ['ready_for_acceptance', 'pending'],
    ]);
    assert.equal(reviewStage?.status, 'active');
  });
});

test('legacy planning session mislabeled as discussion is repaired into planning stage', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-repair`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: 'workflow-stale-discussion',
                title: '历史错挂 workflow',
                objective: '验证 planning 会话被错误注册到 discussion 时可以自愈',
                adoptsExistingOpenSpec: false,
                openspecChangeName: '2029-5-5',
                stage: 'discussion',
                runState: 'running',
                stageStatuses: [
                  { key: 'discussion', label: '讨论', status: 'active' },
                  { key: 'planning', label: '规划', status: 'pending' },
                  { key: 'execution', label: '执行', status: 'pending' },
                  { key: 'verification', label: '验证', status: 'pending' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [],
                childSessions: [
                  {
                    id: 'session-planning-title',
                    title: '创建 openspec 变更并生成所有 artifact',
                    summary: '创建 openspec 变更并生成所有 artifact',
                    provider: 'codex',
                    stageKey: 'discussion',
                    substageKey: 'intent_alignment',
                  },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, 'w1');

    assert.equal(workflow.stage, 'planning');
    assert.deepEqual(aggregateStageStatusRows(workflow), [
      ['planning', 'active'],
      ['execution', 'pending'],
      ['verification', 'pending'],
      ['ready_for_acceptance', 'pending'],
    ]);
    assert.equal(workflow.childSessions[0].stageKey, 'planning');
    assert.equal(workflow.childSessions[0].substageKey, 'planner_output');
  });
});

test('listProjectAdoptableOpenSpecChanges hides changes that are already claimed by workflows', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const claimedChangeName = '1-claimed-change';
    const freeChangeName = '2-free-change';
    const {
      createProjectWorkflow,
      listProjectAdoptableOpenSpecChanges,
    } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-changes`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', claimedChangeName], { cwd: projectPath });
    await execFileAsync('openspec', ['new', 'change', freeChangeName], { cwd: projectPath });

    await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      {
        title: '已占用 proposal',
        objective: '验证已绑定 change 不再出现在接手列表',
        openspecChangeName: claimedChangeName,
      },
    );

    const changes = await listProjectAdoptableOpenSpecChanges({ fullPath: projectPath, path: projectPath });
    assert.deepEqual(changes, [freeChangeName]);
  });
});

test('prepareWorkflowRecord repairs planning sessions that were mistakenly stored under discussion', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-repair`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: 'workflow-misclassified-discussion',
                title: '错误阶段归类',
                objective: '验证 planning 会话误挂到 discussion 时能自动修复',
                stage: 'discussion',
                runState: 'running',
                openspecChangeName: '2029-5-5',
                stageStatuses: [
                  { key: 'discussion', label: '讨论', status: 'active' },
                  { key: 'planning', label: '规划', status: 'pending' },
                  { key: 'execution', label: '执行', status: 'pending' },
                  { key: 'verification', label: '验证', status: 'pending' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                childSessions: [
                  {
                    id: 'session-planning',
                    title: '创建 openspec 变更并生成所有 artifact',
                    summary: '创建 openspec 变更并生成所有 artifact',
                    provider: 'codex',
                    stageKey: 'discussion',
                    substageKey: 'intent_alignment',
                  },
                ],
                artifacts: [],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, 'w1');
    assert.equal(workflow.stage, 'planning');
    assert.deepEqual(aggregateStageStatusRows(workflow), [
      ['planning', 'active'],
      ['execution', 'pending'],
      ['verification', 'pending'],
      ['ready_for_acceptance', 'pending'],
    ]);
    assert.equal(workflow.childSessions[0].stageKey, 'planning');
    assert.equal(workflow.childSessions[0].substageKey, 'planner_output');
  });
});

test('advanceWorkflow promotes planning into execution after proposal review', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const { createProjectWorkflow, advanceWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-advance`)}`);
    await fs.mkdir(projectPath, { recursive: true });
    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '推进执行', objective: '验证审核提案后可以进入执行阶段' },
    );
    const changeName = workflow.openspecChangeName || `${workflow.openspecChangePrefix}-test-advance`;
    await execFileAsync('openspec', ['new', 'change', changeName], { cwd: projectPath });
    const executionWorkflow = await advanceWorkflow({ fullPath: projectPath, path: projectPath }, workflow.id);

    assert.ok(executionWorkflow);
    assert.equal(executionWorkflow.stage, 'execution');
    assert.deepEqual(aggregateStageStatusRows(executionWorkflow), [
      ['planning', 'completed'],
      ['execution', 'active'],
      ['verification', 'pending'],
      ['ready_for_acceptance', 'pending'],
    ]);
  });
});

test('registerWorkflowChildSession persists verification review pass metadata', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const { createProjectWorkflow, registerWorkflowChildSession } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-review-registration`)}`);
    await fs.mkdir(projectPath, { recursive: true });

    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '审核会话注册', objective: '验证 reviewer 注册时会持久化 review pass' },
    );

    const updatedWorkflow = await registerWorkflowChildSession(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      {
        sessionId: 'workflow-review-2-session',
        title: '审核2：审核会话注册',
        summary: '审核2：审核会话注册',
        provider: 'codex',
        stageKey: 'verification',
        substageKey: 'internal_review',
        reviewPassIndex: 2,
      },
    );

    const reviewSession = updatedWorkflow.childSessions.find((session) => session.id === 'workflow-review-2-session');
    const verificationStage = findStageInspection(updatedWorkflow, 'verification');
    const reviewPass2 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_2');

    assert.equal(reviewSession?.reviewPassIndex, 2);
    assert.equal(reviewSession?.substageKey, 'review_2');
    assert.deepEqual(reviewPass2?.agentSessions.map((session) => session.id), ['workflow-review-2-session']);
  });
});

test('registerWorkflowChildSession replaces a workflow draft session when the real provider session arrives', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const { createProjectWorkflow, registerWorkflowChildSession } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-draft-replacement`)}`);
    await fs.mkdir(projectPath, { recursive: true });

    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '规划草稿替换', objective: '验证 workflow child session 会用真实 session 替换 draft id' },
    );

    await registerWorkflowChildSession(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      {
        sessionId: 'new-session-draft123',
        title: 'Workflow Planning Kickoff: 规划草稿替换',
        summary: 'Workflow Planning Kickoff: 规划草稿替换',
        provider: 'codex',
        stageKey: 'planning',
        substageKey: 'planner_output',
      },
    );

    const updatedWorkflow = await registerWorkflowChildSession(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      {
        sessionId: 'codex-real-session-123',
        title: 'Workflow Planning Kickoff: 规划草稿替换',
        summary: 'Workflow Planning Kickoff: 规划草稿替换',
        provider: 'codex',
        stageKey: 'planning',
        substageKey: 'planner_output',
      },
    );

    assert.deepEqual(
      updatedWorkflow.childSessions.map((session) => session.id),
      ['codex-real-session-123'],
    );
    assert.equal(updatedWorkflow.childSessions[0].stageKey, 'planning');
    assert.equal(updatedWorkflow.childSessions[0].substageKey, 'planner_output');
  });
});

test('registerWorkflowChildSession deduplicates repeated draft sessions for the same workflow stage', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const { createProjectWorkflow, registerWorkflowChildSession } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-draft-dedup`)}`);
    await fs.mkdir(projectPath, { recursive: true });

    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '重复评审草稿', objective: '验证重复自动启动不会注册多个同阶段草稿' },
    );

    await registerWorkflowChildSession(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      {
        sessionId: 'c1',
        title: '评审1：重复评审草稿',
        summary: '评审1：重复评审草稿',
        provider: 'codex',
        stageKey: 'review_1',
        substageKey: 'review_1',
        reviewPassIndex: 1,
      },
    );

    const updatedWorkflow = await registerWorkflowChildSession(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      {
        sessionId: 'c2',
        title: '评审1：重复评审草稿',
        summary: '评审1：重复评审草稿',
        provider: 'codex',
        stageKey: 'review_1',
        substageKey: 'review_1',
        reviewPassIndex: 1,
      },
    );

    assert.deepEqual(
      updatedWorkflow.childSessions.map((session) => session.id),
      ['c2'],
    );
    assert.equal(updatedWorkflow.childSessions[0].reviewPassIndex, 1);
  });
});

test('registerWorkflowChildSession blocks later review sessions until previous review result exists', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const { createProjectWorkflow, registerWorkflowChildSession } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-review-register-gate`)}`);
    await fs.mkdir(projectPath, { recursive: true });

    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '阻止提前再审', objective: '验证没有初审结果时不能注册再审会话' },
    );

    const updatedWorkflow = await registerWorkflowChildSession(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      {
        sessionId: 'review-2-session',
        title: '评审2：阻止提前再审',
        summary: '评审2：阻止提前再审',
        provider: 'codex',
        stageKey: 'review_2',
        substageKey: 'review_2',
        reviewPassIndex: 2,
      },
    );

    assert.deepEqual(updatedWorkflow.childSessions, []);
  });
});

test('registerWorkflowChildSession moves one concrete provider session between workflows', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const {
      createProjectWorkflow,
      listProjectWorkflows,
      registerWorkflowChildSession,
    } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-unique-child-session`)}`);
    await fs.mkdir(projectPath, { recursive: true });

    const firstWorkflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '旧工作流', objective: '保存旧的内部规划会话' },
    );
    const secondWorkflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '新工作流', objective: '启动新的内部规划会话' },
    );

    await registerWorkflowChildSession(
      { fullPath: projectPath, path: projectPath },
      firstWorkflow.id,
      {
        sessionId: 'codex-shared-real-session',
        title: '规划提案：旧工作流',
        summary: '规划提案：旧工作流',
        provider: 'codex',
        stageKey: 'planning',
        substageKey: 'planner_output',
      },
    );

    await registerWorkflowChildSession(
      { fullPath: projectPath, path: projectPath },
      secondWorkflow.id,
      {
        sessionId: 'codex-shared-real-session',
        title: '规划提案：新工作流',
        summary: '规划提案：新工作流',
        provider: 'codex',
        stageKey: 'planning',
        substageKey: 'planner_output',
      },
    );

    const workflows = await listProjectWorkflows(projectPath);
    const refreshedFirstWorkflow = workflows.find((workflow) => workflow.id === firstWorkflow.id);
    const refreshedSecondWorkflow = workflows.find((workflow) => workflow.id === secondWorkflow.id);

    assert.deepEqual(
      refreshedFirstWorkflow.childSessions.map((session) => session.id),
      [],
    );
    assert.deepEqual(
      refreshedSecondWorkflow.childSessions.map((session) => session.id),
      ['codex-shared-real-session'],
    );
  });
});

test('substage inspections only complete evidence-backed deliverables for reached stages', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const changeName = '1-existing-evidence';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-evidence`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', changeName], { cwd: projectPath });
    await fs.writeFile(path.join(projectPath, 'openspec', 'changes', changeName, 'proposal.md'), '# proposal\n', 'utf8');
    await fs.writeFile(path.join(projectPath, 'openspec', 'changes', changeName, 'design.md'), '# design\n', 'utf8');
    await fs.writeFile(path.join(projectPath, 'openspec', 'changes', changeName, 'tasks.md'), '# tasks\n', 'utf8');
    await fs.mkdir(path.join(projectPath, '.ccflow', '1'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.ccflow', '1', 'verification-evidence.json'), '{}\n', 'utf8');
    await fs.writeFile(path.join(projectPath, '.ccflow', '1', 'delivery-summary.md'), '# delivery\n', 'utf8');
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: 'workflow-evidence',
                title: '已有多阶段证据',
                objective: '验证未到达的未来阶段不会仅因残留文件而被标记为完成',
                openspecChangeName: changeName,
                stage: 'planning',
                runState: 'running',
                stageStatuses: [
                  { key: 'discussion', label: '讨论', status: 'skipped' },
                  { key: 'planning', label: '规划', status: 'active' },
                  { key: 'execution', label: '执行', status: 'pending' },
                  { key: 'verification', label: '验证', status: 'pending' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [],
                childSessions: [
                  {
                    id: 'planning-session',
                    title: '创建 openspec 变更并生成所有 artifact',
                    summary: '创建 openspec 变更并生成所有 artifact',
                    provider: 'codex',
                    stageKey: 'planning',
                    substageKey: 'planner_output',
                  },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, 'w1');
    const stageMap = stageInspectionStatusMap(workflow);
    const executionStage = workflow.stageInspections.find((stage) => stage.stageKey === 'execution');
    const verificationStage = findStageInspection(workflow, 'verification');
    const deliveryStage = workflow.stageInspections.find((stage) => stage.stageKey === 'archive');

    assert.equal(stageMap.planning.planner_output, 'completed');
    assert.equal(stageMap.execution.node_execution, 'pending');
    assert.equal(stageMap.verification.review_1, 'pending');
    assert.equal(stageMap.verification.review_2, 'pending');
    assert.equal(stageMap.verification.review_3, 'pending');
    assert.equal(stageMap.archive.delivery_package, 'pending');
    assert.deepEqual(executionStage?.substages.find((substage) => substage.substageKey === 'node_execution')?.files, []);
    assert.deepEqual(verificationStage?.substages.find((substage) => substage.substageKey === 'review_1')?.files, []);
    assert.deepEqual(deliveryStage?.substages.find((substage) => substage.substageKey === 'delivery_package')?.files, []);
  });
});

test('deleteWorkflow removes one workflow from the project store', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const { createProjectWorkflow, deleteWorkflow, listProjectWorkflows } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-delete`)}`);
    await fs.mkdir(projectPath, { recursive: true });

    const firstWorkflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '保留工作流', objective: '验证删除不会误伤其他工作流' },
    );
    const secondWorkflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '删除目标', objective: '验证可以删除指定工作流' },
    );

    const deleted = await deleteWorkflow({ fullPath: projectPath, path: projectPath }, secondWorkflow.id);
    const remaining = await listProjectWorkflows(projectPath);

    assert.equal(deleted, true);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, firstWorkflow.id);
  });
});

test('deleteWorkflow removes workflow child session records and JSONL files', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const { deleteWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-delete-children`)}`);
    const claudeSessionId = 'claude-workflow-child-delete';
    const codexSessionId = 'codex-workflow-child-delete';
    const claudeProjectName = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
    const claudeSessionPath = path.join(homeDir, '.claude', 'projects', claudeProjectName, `${claudeSessionId}.jsonl`);
    const codexSessionPath = path.join(homeDir, '.codex', 'sessions', '2026', '04', '25', `${codexSessionId}.jsonl`);

    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.mkdir(path.dirname(claudeSessionPath), { recursive: true });
    await fs.mkdir(path.dirname(codexSessionPath), { recursive: true });
    await fs.writeFile(claudeSessionPath, `${JSON.stringify({ sessionId: claudeSessionId, cwd: projectPath })}\n`, 'utf8');
    await fs.writeFile(codexSessionPath, `${JSON.stringify({ id: codexSessionId, cwd: projectPath })}\n`, 'utf8');
    await fs.writeFile(workflowStorePath, `${JSON.stringify({
      schemaVersion: 2,
      workflows: {
        1: {
          title: '删除子会话工作流',
          chat: {
            1: { sessionId: claudeSessionId, provider: 'claude', title: '规划会话', stageKey: 'planning' },
            2: { sessionId: codexSessionId, provider: 'codex', title: '执行会话', stageKey: 'execution' },
          },
        },
        2: { title: '保留工作流' },
      },
    }, null, 2)}\n`, 'utf8');

    const deleted = await deleteWorkflow({ fullPath: projectPath, path: projectPath }, 'w1');
    const config = JSON.parse(await fs.readFile(workflowStorePath, 'utf8'));

    assert.equal(deleted, true);
    await assert.rejects(fs.access(claudeSessionPath), { code: 'ENOENT' });
    await assert.rejects(fs.access(codexSessionPath), { code: 'ENOENT' });
    assert.deepEqual(Object.keys(config.workflows), ['2']);
  });
});

test('execution completion only advances into verification after OpenSpec tasks are fully completed', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-auto-review-handoff`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-auto-review-handoff'], { cwd: projectPath });
    await writeOpenSpecTasks(projectPath, '1-auto-review-handoff', [true, true]);
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '执行完成后自动进入验证',
                objective: '验证只有 OpenSpec tasks 全部完成时才会切到 verification',
                openspecChangeName: '1-auto-review-handoff',
                stage: 'execution',
                runState: 'running',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'pending' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [],
                childSessions: [
                  {
                    id: 'sess-plan-finished',
                    title: '规划会话',
                    summary: 'proposal 已经确认',
                    provider: 'codex',
                    stageKey: 'planning',
                    substageKey: 'planner_output',
                  },
                  {
                    id: 'sess-apply-finished',
                    title: '执行会话',
                    summary: 'apply 已经跑完',
                    provider: 'codex',
                    stageKey: 'execution',
                    substageKey: 'node_execution',
                  },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const verificationStage = findStageInspection(workflow, 'verification');
    const reviewPass1 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_1');

    assert.ok(workflow);
    assert.equal(workflow.stage, 'review_1');
    assert.equal(workflow.runState, 'running');
    assert.deepEqual(
      aggregateStageStatusRows(workflow),
      [
        ['planning', 'completed'],
        ['execution', 'completed'],
        ['verification', 'active'],
        ['ready_for_acceptance', 'pending'],
      ],
    );
    assert.equal(verificationStage?.status, 'active');
    assert.equal(reviewPass1?.status, 'active');
    assert.equal(reviewPass1?.summary, '等待 apply 会话结束后自动派生第 1 轮 reviewer 会话。');
  });
});

test('execution stays active when OpenSpec tasks are unfinished even if the apply session has ended', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-wait-user-confirmation`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-wait-user-confirmation'], { cwd: projectPath });
    await writeOpenSpecTasks(projectPath, '1-wait-user-confirmation', [true, false]);
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '执行未完成时停留在 execution',
                objective: '验证 apply 会话结束但 OpenSpec 未完成时不会自动进入验证',
                openspecChangeName: '1-wait-user-confirmation',
                stage: 'execution',
                runState: 'running',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'pending' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [],
                childSessions: [
                  {
                    id: 'sess-plan-ready',
                    title: '规划会话',
                    summary: 'proposal 已经确认',
                    provider: 'codex',
                    stageKey: 'planning',
                    substageKey: 'planner_output',
                  },
                  {
                    id: 'sess-apply-stopped',
                    title: '执行会话',
                    summary: 'apply 会话结束，但仍有任务没完成',
                    provider: 'codex',
                    stageKey: 'execution',
                    substageKey: 'node_execution',
                  },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const executionStage = workflow.stageInspections.find((stage) => stage.stageKey === 'execution');
    const verificationStage = findStageInspection(workflow, 'verification');
    const executionSubstage = executionStage?.substages.find((substage) => substage.substageKey === 'node_execution');

    assert.ok(workflow);
    assert.equal(workflow.stage, 'execution');
    assert.equal(workflow.runState, 'running');
    assert.deepEqual(
      aggregateStageStatusRows(workflow),
      [
        ['planning', 'completed'],
        ['execution', 'active'],
        ['verification', 'pending'],
        ['ready_for_acceptance', 'pending'],
      ],
    );
    assert.equal(executionStage?.status, 'active');
    assert.equal(executionSubstage?.status, 'active');
    assert.equal(executionSubstage?.summary, 'OpenSpec 任务完成 1/2。');
    assert.equal(executionSubstage?.whyBlocked, 'apply 会话已运行，但 OpenSpec 任务尚未全部完成。');
    assert.equal(verificationStage?.status, 'pending');
  });
});

test('workflow UI state persists in workflow store and read model', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const { createProjectWorkflow, listProjectWorkflows, updateWorkflowUiState } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-ui-state`)}`);
    await fs.mkdir(projectPath, { recursive: true });

    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '工作流元数据', objective: '验证收藏待处理隐藏会写回 store' },
    );

    const updatedWorkflow = await updateWorkflowUiState(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      { favorite: true, pending: true, hidden: true },
    );

    assert.ok(updatedWorkflow);
    assert.equal(updatedWorkflow.favorite, true);
    assert.equal(updatedWorkflow.pending, true);
    assert.equal(updatedWorkflow.hidden, true);

    const persistedStore = JSON.parse(await fs.readFile(workflowStorePath, 'utf8'));
    const persistedWorkflow = persistedStore.workflows['1'];
    assert.equal(persistedWorkflow.favorite, true);
    assert.equal(persistedWorkflow.pending, true);
    assert.equal(persistedWorkflow.hidden, true);

    const workflows = await listProjectWorkflows(projectPath);
    assert.equal(workflows[0].favorite, true);
    assert.equal(workflows[0].pending, true);
    assert.equal(workflows[0].hidden, true);
  });
});

test('workflow gate decision persists user acceptance choice', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const { createProjectWorkflow, listProjectWorkflows, updateWorkflowGateDecision } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-gate-decision`)}`);
    await fs.mkdir(projectPath, { recursive: true });

    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '验收选择', objective: '验证用户能把工作流标记为通过或待完善' },
    );

    const passedWorkflow = await updateWorkflowGateDecision(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      'pass',
    );

    assert.ok(passedWorkflow);
    assert.equal(passedWorkflow.gateDecision, 'pass');
    assert.equal(passedWorkflow.finalReadiness, true);
    assert.equal(passedWorkflow.runState, 'completed');
    assert.equal(passedWorkflow.stage, 'archive');

    const persistedAfterPass = JSON.parse(await fs.readFile(workflowStorePath, 'utf8'));
    assert.equal(persistedAfterPass.workflows['1'].gateDecision, 'pass');
    assert.equal(persistedAfterPass.workflows['1'].finalReadiness, true);

    const repairedWorkflow = await updateWorkflowGateDecision(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      'needs_repair',
    );

    assert.ok(repairedWorkflow);
    assert.equal(repairedWorkflow.gateDecision, 'needs_repair');
    assert.equal(repairedWorkflow.finalReadiness, false);
    assert.equal(repairedWorkflow.runState, 'blocked');

    const workflows = await listProjectWorkflows(projectPath);
    assert.equal(workflows[0].gateDecision, 'needs_repair');
    assert.equal(workflows[0].stageStatuses.find((stage) => stage.key === 'archive')?.status, 'blocked');
  });
});

test('renameWorkflow updates persisted title without changing workflow id', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const { createProjectWorkflow, renameWorkflow, listProjectWorkflows } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-rename`)}`);
    await fs.mkdir(projectPath, { recursive: true });

    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '原始标题', objective: '验证只修改工作流展示标题' },
    );

    const renamedWorkflow = await renameWorkflow(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      '新的工作流名称',
    );

    assert.ok(renamedWorkflow);
    assert.equal(renamedWorkflow.id, workflow.id);
    assert.equal(renamedWorkflow.title, '新的工作流名称');

    const persistedStore = JSON.parse(await fs.readFile(workflowStorePath, 'utf8'));
    const persistedWorkflow = persistedStore.workflows['1'];
    assert.equal(persistedStore.workflows['1'].id, undefined);
    assert.equal(persistedWorkflow.title, '新的工作流名称');

    const workflows = await listProjectWorkflows(projectPath);
    assert.equal(workflows[0].title, '新的工作流名称');
  });
});

test('buildWorkflowLauncherConfig keeps planning prompt to explore alias and workflow title', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const aliasDir = path.join(homeDir, '.config', 'ccflow-alias');
    const { createProjectWorkflow, buildWorkflowLauncherConfig } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-launcher`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(aliasDir, { recursive: true });
    await fs.writeFile(path.join(aliasDir, 'explore.md'), 'EXPLORE TEMPLATE FROM HOME\n', 'utf8');
    await fs.writeFile(path.join(aliasDir, 'apply.md'), 'APPLY TEMPLATE FROM HOME\n', 'utf8');
    await fs.writeFile(path.join(aliasDir, 'archive.md'), 'ARCHIVE TEMPLATE FROM HOME\n', 'utf8');

    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '模板读取', objective: '验证 launcher prompt 直接来自 alias 文件' },
    );

    const planningLauncher = await buildWorkflowLauncherConfig(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      'planning',
    );

    assert.equal(planningLauncher.workflowStageKey, 'planning');
    assert.equal(planningLauncher.workflowSubstageKey, 'planner_output');
    assert.equal(planningLauncher.workflowAutoStart, 'planning');
    assert.equal(planningLauncher.autoPrompt, 'EXPLORE TEMPLATE FROM HOME\n拟新建 OpenSpec change 编号前缀：1\n工作流标题：模板读取\n需求正文：验证 launcher prompt 直接来自 alias 文件');
    assert.doesNotMatch(planningLauncher.autoPrompt, /工作流 ID/);

    const executionLauncher = await buildWorkflowLauncherConfig(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      'execution',
    );

    assert.match(executionLauncher.autoPrompt, /APPLY TEMPLATE FROM HOME/);

    const archiveLauncher = await buildWorkflowLauncherConfig(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      'archive',
    );

    assert.equal(archiveLauncher.workflowAutoStart, 'archive');
    assert.equal(archiveLauncher.workflowStageKey, 'archive');
    assert.equal(archiveLauncher.workflowSubstageKey, 'delivery_package');
    assert.match(archiveLauncher.autoPrompt, /ARCHIVE TEMPLATE FROM HOME/);
  });
});

test('buildWorkflowLauncherConfig keeps review prompt compact with focus and output format', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const { createProjectWorkflow, buildWorkflowLauncherConfig } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-review-prompt`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    const workflow = await createProjectWorkflow(
      { fullPath: projectPath, path: projectPath },
      { title: '审核提示词', objective: '验证审核提示词保持精简' },
    );

    const launcher = await buildWorkflowLauncherConfig(
      { fullPath: projectPath, path: projectPath },
      workflow.id,
      'review_2',
    );

    assert.equal(launcher.workflowAutoStart, 'review');
    assert.equal(launcher.workflowReviewPass, 2);
    assert.match(launcher.autoPrompt, /实现风险：检查最近变更/);
    assert.match(launcher.autoPrompt, /把审核结果写入/);
    assert.match(launcher.autoPrompt, /"required": \[/);
    assert.doesNotMatch(launcher.autoPrompt, /Workflow Reviewer Contract/);
    assert.doesNotMatch(launcher.autoPrompt, /Workflow Launcher Prelude/);
  });
});

test('buildWorkflowLauncherConfig continues from blocked review by launching a repair execution session', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowDir = path.join(projectPath, '.ccflow', '1');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const aliasDir = path.join(homeDir, '.config', 'ccflow-alias');
    const { buildWorkflowLauncherConfig } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-continue-repair`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(workflowDir, { recursive: true });
    await fs.mkdir(aliasDir, { recursive: true });
    await fs.writeFile(path.join(aliasDir, 'apply.md'), 'APPLY TEMPLATE FROM HOME\n', 'utf8');
    await fs.writeFile(
      path.join(workflowDir, 'review-2.json'),
      `${JSON.stringify({
        summary: '第 2 轮发现阻断问题',
        decision: 'blocked',
        findings: [
          { title: '列表状态恢复有缺口' },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: 'workflow-review-repair',
                title: '审核回流修复',
                objective: '验证 blocked review 会改为发起修复会话',
                openspecChangeName: '2030-review-repair',
                stage: 'verification',
                runState: 'blocked',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'blocked' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [],
                childSessions: [
                  { id: 'review-2-session', title: '评审2：审核回流修复', stageKey: 'verification', substageKey: 'review_2' },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const launcher = await buildWorkflowLauncherConfig(
      { fullPath: projectPath, path: projectPath },
      'w1',
      'repair_2',
    );

    assert.equal(launcher.workflowAutoStart, 'repair');
    assert.equal(launcher.workflowStageKey, 'repair_2');
    assert.equal(launcher.workflowSubstageKey, 'repair_2');
    assert.equal(launcher.workflowReviewPass, 2);
    assert.equal(launcher.workflowRepairPass, 2);
    assert.match(launcher.sessionSummary, /修复2：审核回流修复/);
    assert.match(launcher.autoPrompt, /review-2\.json/);
    assert.match(launcher.autoPrompt, /列表状态恢复有缺口/);
  });
});

test('buildWorkflowLauncherConfig treats rejected review results as repair work', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowDir = path.join(projectPath, '.ccflow', '1');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const aliasDir = path.join(homeDir, '.config', 'ccflow-alias');
    const { buildWorkflowLauncherConfig } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-continue-reject-repair`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(workflowDir, { recursive: true });
    await fs.mkdir(aliasDir, { recursive: true });
    await fs.writeFile(path.join(aliasDir, 'apply.md'), 'APPLY TEMPLATE FROM HOME\n', 'utf8');
    await fs.writeFile(
      path.join(workflowDir, 'review-1.json'),
      `${JSON.stringify({
        summary: '第 1 轮拒绝通过',
        decision: 'reject',
        findings: [
          { title: '右键菜单缺失' },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
          {
            id: 'w1',
            title: '拒绝后修复',
            openspecChangeName: '2030-review-reject',
            stage: 'review_1',
            childSessions: [
              { id: 'review-1-session', title: '评审1：拒绝后修复', stageKey: 'review_1', substageKey: 'review_1', reviewPassIndex: 1 },
            ],
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const launcher = await buildWorkflowLauncherConfig(
      { fullPath: projectPath, path: projectPath },
      'w1',
      'repair_1',
    );

    assert.equal(launcher.workflowAutoStart, 'repair');
    assert.equal(launcher.workflowStageKey, 'repair_1');
    assert.equal(launcher.workflowSubstageKey, 'repair_1');
    assert.equal(launcher.workflowRepairPass, 1);
    assert.match(launcher.sessionSummary, /修复1：拒绝后修复/);
    assert.match(launcher.autoPrompt, /右键菜单缺失/);
  });
});

test('buildWorkflowLauncherConfig continues from clean review by advancing to the next pass', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowDir = path.join(projectPath, '.ccflow', '1');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const { buildWorkflowLauncherConfig } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-continue-review`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(workflowDir, { recursive: true });
    await fs.writeFile(
      path.join(workflowDir, 'review-1.json'),
      `${JSON.stringify({
        summary: '第 1 轮通过',
        decision: 'clean',
        findings: [],
      }, null, 2)}\n`,
      'utf8',
    );
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: 'workflow-review-continue',
                title: '审核推进',
                objective: '验证 clean review 会进入下一轮审核',
                openspecChangeName: '2030-review-continue',
                stage: 'verification',
                runState: 'running',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'active' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [],
                childSessions: [
                  { id: 'review-1-session', title: '评审1：审核推进', stageKey: 'verification', substageKey: 'review_1' },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const launcher = await buildWorkflowLauncherConfig(
      { fullPath: projectPath, path: projectPath },
      'w1',
      'review_2',
    );

    assert.equal(launcher.workflowAutoStart, 'review');
    assert.equal(launcher.workflowStageKey, 'review_2');
    assert.equal(launcher.workflowSubstageKey, 'review_2');
    assert.equal(launcher.workflowReviewPass, 2);
    assert.match(launcher.sessionSummary, /评审2：审核推进/);
  });
});

test('buildWorkflowLauncherConfig waits for structured review result before continuing', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const { buildWorkflowLauncherConfig } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-continue-waits-review-result`)}`);

    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
          {
            id: 'w1',
            title: '等待审核结果',
            openspecChangeName: '2032-review-wait',
            stage: 'review_1',
            childSessions: [
              { id: 'review-1-session', title: '评审1：等待审核结果', stageKey: 'review_1', substageKey: 'review_1', reviewPassIndex: 1 },
            ],
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const launcher = await buildWorkflowLauncherConfig(
      { fullPath: projectPath, path: projectPath },
      'w1',
      'review_1',
    );

    assert.equal(launcher.workflowAutoStart, 'review');
    assert.equal(launcher.workflowStageKey, 'review_1');
    assert.equal(launcher.workflowSubstageKey, 'review_1');
    assert.equal(launcher.workflowReviewPass, 1);
  });
});

test('buildWorkflowLauncherConfig continues from clean third review by launching archive delivery', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowDir = path.join(projectPath, '.ccflow', '1');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const aliasDir = path.join(homeDir, '.config', 'ccflow-alias');
    const { buildWorkflowLauncherConfig } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-continue-archive`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(workflowDir, { recursive: true });
    await fs.mkdir(aliasDir, { recursive: true });
    await fs.writeFile(path.join(aliasDir, 'archive.md'), 'ARCHIVE TEMPLATE FROM HOME\n', 'utf8');
    await fs.writeFile(
      path.join(workflowDir, 'review-3.json'),
      `${JSON.stringify({
        summary: '第 3 轮通过',
        decision: 'clean',
        findings: [],
      }, null, 2)}\n`,
      'utf8',
    );
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
          {
            id: 'w1',
            title: '审核交付',
            openspecChangeName: '2031-review-archive',
            stage: 'review_3',
            childSessions: [
              { id: 'review-3-session', title: '评审3：审核交付', stageKey: 'review_3', substageKey: 'review_3', reviewPassIndex: 3 },
            ],
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const launcher = await buildWorkflowLauncherConfig(
      { fullPath: projectPath, path: projectPath },
      'w1',
      'archive',
    );

    assert.equal(launcher.workflowAutoStart, 'archive');
    assert.equal(launcher.workflowStageKey, 'archive');
    assert.equal(launcher.workflowSubstageKey, 'delivery_package');
    assert.match(launcher.sessionSummary, /归档：审核交付/);
    assert.match(launcher.autoPrompt, /ARCHIVE TEMPLATE FROM HOME/);
  });
});

test('archive stage stays pending until an archive child session exists', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowDir = path.join(projectPath, '.ccflow', '1');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-archive-pending`)}`);

    await fs.mkdir(workflowDir, { recursive: true });
    for (const passIndex of [1, 2, 3]) {
      await fs.writeFile(
        path.join(workflowDir, `review-${passIndex}.json`),
        `${JSON.stringify({ summary: `第 ${passIndex} 轮通过`, decision: 'clean', findings: [] }, null, 2)}\n`,
        'utf8',
      );
    }
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    const workflowRecord = {
      id: 'w1',
      title: '归档灯状态',
      openspecChangeName: '2032-archive-light',
      stage: 'review_3',
      childSessions: [
        { id: 'review-3-session', title: '评审3：归档灯状态', stageKey: 'review_3', substageKey: 'review_3', reviewPassIndex: 3 },
      ],
    };
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({ version: 1, workflows: [workflowRecord] }, null, 2)}\n`,
      'utf8',
    );

    const reviewedWorkflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, 'w1');
    assert.equal(reviewedWorkflow.stageStatuses.find((stage) => stage.key === 'archive')?.status, 'pending');

    workflowRecord.childSessions.push({
      id: 'archive-session',
      title: '归档：归档灯状态',
      stageKey: 'archive',
      substageKey: 'delivery_package',
    });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({ version: 1, workflows: [workflowRecord] }, null, 2)}\n`,
      'utf8',
    );

    const archivedWorkflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, 'w1');
    assert.equal(archivedWorkflow.stageStatuses.find((stage) => stage.key === 'archive')?.status, 'active');
  });
});

test('review pass stays active until reviewer result artifact exists', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-review-progress`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-review-progress'], { cwd: projectPath });
    await writeOpenSpecTasks(projectPath, '1-review-progress', [true, true]);
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '内部审核',
                objective: '验证阶段会进入 reviewer 子阶段',
                openspecChangeName: '1-review-progress',
                stage: 'verification',
                runState: 'running',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'active' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [
                  { id: 'status-sync', label: 'status-sync.json', stage: 'execution', substageKey: 'status_sync', path: '.ccflow/1/status-sync.json' },
                ],
                childSessions: [
                  { id: 'sess-apply', title: '执行会话', stageKey: 'execution', substageKey: 'node_execution' },
                  { id: 'sess-review-1', title: '审核1', stageKey: 'verification', substageKey: 'review_1' },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const verificationStage = findStageInspection(workflow, 'verification');
    const reviewPass1 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_1');

    assert.equal(workflow.stage, 'review_1');
    assert.ok(verificationStage);
    assert.ok(reviewPass1);
    assert.equal(reviewPass1.status, 'active');
    assert.equal(reviewPass1.summary, '第 1 轮内部审核已生成，可直接查看会话内容。');
  });
});

test('legacy review_pass workflow keeps review links and inserts repair session before rereview', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const { listProjectWorkflows } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-legacy-review-repair`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        schemaVersion: 2,
        workflows: {
          1: {
            title: '审核回流',
            stage: 'review_pass_2',
            stageStatuses: [
              { key: 'planning', label: '规划提案', status: 'completed' },
              { key: 'execution', label: '执行', status: 'pending' },
              { key: 'review_pass_1', label: '初审', status: 'completed' },
              { key: 'review_pass_2', label: '再审', status: 'active' },
              { key: 'review_pass_3', label: '三审', status: 'pending' },
              { key: 'ready_for_acceptance', label: '验收', status: 'pending' },
            ],
            chat: {
              0: {
                sessionId: 'planning-session',
                title: '规划提案',
                provider: 'codex',
                stageKey: 'planning',
                substageKey: 'planner_output',
              },
              1: {
                sessionId: 'review-1-session',
                title: '评审1：审核回流',
                provider: 'codex',
                stageKey: 'review_1',
                reviewPassIndex: 1,
              },
              2: {
                sessionId: 'repair-after-review-1',
                title: 'Active Codex session',
                provider: 'codex',
                stageKey: 'review_1',
              },
            },
          },
        },
      }, null, 2)}\n`,
      'utf8',
    );

    const [workflow] = await listProjectWorkflows(projectPath);
    const reviewStage = findStageInspection(workflow, 'review_1');

    assert.equal(workflow.stage, 'planning');
    assert.deepEqual(workflow.stageStatuses.map((stage) => stage.key), [
      'planning',
      'execution',
      'review_1',
      'repair_1',
      'review_2',
      'repair_2',
      'review_3',
      'repair_3',
      'archive',
    ]);
    assert.equal(reviewStage?.status, 'active');
    assert.deepEqual(reviewStage?.substages.map((substage) => substage.substageKey), ['review_1']);
    const reviewAgentIds = reviewStage?.substages[0].agentSessions.map((session) => session.id);
    assert.ok(reviewAgentIds?.includes('review-1-session'));
    assert.ok(reviewAgentIds?.includes('repair-after-review-1'));
  });
});

test('legacy internal review sessions stored under execution are repaired into verification even when their title mentions OpenSpec', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-review-openspec-title`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-review-openspec-title'], { cwd: projectPath });
    await writeOpenSpecTasks(projectPath, '1-review-openspec-title', [true, true]);
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '内部审核标题修复',
                objective: '确保 reviewer 会话不会被 OpenSpec 关键词误归类',
                openspecChangeName: '1-review-openspec-title',
                stage: 'verification',
                runState: 'running',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'active' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [
                  { id: 'status-sync', label: 'status-sync.json', stage: 'execution', substageKey: 'status_sync', path: '.ccflow/1/status-sync.json' },
                ],
                childSessions: [
                  {
                    id: 'sess-apply-openspec',
                    title: '执行会话',
                    stageKey: 'execution',
                    substageKey: 'node_execution',
                  },
                  {
                    id: 'sess-review-openspec',
                    title: '审核1：OpenSpec 对齐检查',
                    stageKey: 'execution',
                    substageKey: 'internal_review',
                  },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const verificationStage = findStageInspection(workflow, 'verification');
    const reviewPass1 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_1');

    assert.ok(reviewPass1);
    assert.equal(reviewPass1.status, 'active');
    assert.deepEqual(
      reviewPass1.agentSessions.map((session) => session.id),
      ['sess-review-openspec'],
    );
    assert.deepEqual(
      workflow.childSessions
        .filter((session) => session.id === 'sess-review-openspec')
        .map((session) => [session.stageKey, session.substageKey]),
      [['review_1', 'review_1']],
    );
  });
});

test('completed verification stage is blocked until review sessions are fully registered', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-missing-review-sessions`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-missing-review-sessions'], { cwd: projectPath });
    await writeOpenSpecTasks(projectPath, '1-missing-review-sessions', [true, true]);
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '执行完成但缺审核',
                objective: '只有前置执行完成时不能把 verification.review_1 一起标完成',
                openspecChangeName: '1-missing-review-sessions',
                stage: 'execution',
                runState: 'completed',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'completed' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'completed' },
                ],
                artifacts: [
                  { id: 'status-sync', label: 'status-sync.json', stage: 'execution', substageKey: 'status_sync', path: '.ccflow/1/status-sync.json' },
                ],
                childSessions: [
                  { id: 'sess-apply', title: '执行会话', stageKey: 'execution', substageKey: 'node_execution' },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const verificationStage = findStageInspection(workflow, 'verification');
    const reviewPass1 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_1');

    assert.ok(verificationStage);
    assert.equal(verificationStage.status, 'pending');
    assert.ok(reviewPass1);
    assert.equal(reviewPass1.status, 'pending');
  });
});

test('legacy review sessions are repaired into review passes and sorted by pass order', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-review-order-repair`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-review-order-repair'], { cwd: projectPath });
    await writeOpenSpecTasks(projectPath, '1-review-order-repair', [true, true]);
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '修复 reviewer 排序',
                objective: '旧 reviewer 会话不应落到 status_sync，且应按 1 2 3 顺序展示',
                openspecChangeName: '1-review-order-repair',
                stage: 'execution',
                runState: 'running',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'active' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [],
                childSessions: [
                  { id: 'workflow-apply-finished', title: '执行会话', stageKey: 'execution', substageKey: 'node_execution' },
                  { id: 'workflow-review-3', title: '内部审核第 3 轮：最终收敛', stageKey: 'verification', substageKey: 'internal_review' },
                  { id: 'workflow-review-2', title: '继续进行第 2 轮内部审核，检查回归风险', stageKey: 'execution', substageKey: 'status_sync' },
                  { id: 'workflow-review-1', title: '对 openspec apply 结果进行第 1 轮内部审核', stageKey: 'execution', substageKey: 'status_sync' },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const verificationStage = findStageInspection(workflow, 'verification');
    const reviewPass1 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_1');
    const reviewPass2 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_2');
    const reviewPass3 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_3');

    assert.ok(reviewPass1);
    assert.ok(reviewPass2);
    assert.ok(reviewPass3);
    assert.deepEqual(
      reviewPass1.agentSessions.map((session) => session.id),
      ['workflow-review-1'],
    );
    assert.deepEqual(reviewPass2.agentSessions.map((session) => session.id), ['workflow-review-2']);
    assert.deepEqual(reviewPass3.agentSessions.map((session) => session.id), ['workflow-review-3']);
    assert.deepEqual(
      workflow.childSessions
        .filter((session) => session.id.startsWith('workflow-review-'))
        .map((session) => [session.id, session.stageKey, session.substageKey]),
      [
        ['workflow-review-1', 'review_1', 'review_1'],
        ['workflow-review-2', 'review_2', 'review_2'],
        ['workflow-review-3', 'review_3', 'review_3'],
      ],
    );
  });
});

test('legacy generic reviewer sessions assigned to review_3 are redistributed by launch order', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-generic-review-repair`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-generic-review-repair'], { cwd: projectPath });
    await writeOpenSpecTasks(projectPath, '1-generic-review-repair', [true, true]);
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '修复泛化 reviewer 会话',
                objective: '历史 reviewer 会话全落到 review_3 时仍应恢复 1 2 3 三轮展示',
                openspecChangeName: '1-generic-review-repair',
                stage: 'verification',
                runState: 'running',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'active' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                childSessions: [
                  { id: 'review-generic-1', title: '# Workflow Reviewer', summary: '# Workflow Reviewer', stageKey: 'verification', substageKey: 'review_3' },
                  { id: 'review-generic-2', title: '# Workflow Reviewer', summary: '# Workflow Reviewer', stageKey: 'verification', substageKey: 'review_3' },
                  { id: 'review-generic-3', title: '# Workflow Reviewer', summary: '# Workflow Reviewer', stageKey: 'verification', substageKey: 'review_3' },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const verificationStage = findStageInspection(workflow, 'verification');
    const reviewPass1 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_1');
    const reviewPass2 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_2');
    const reviewPass3 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_3');

    assert.deepEqual(reviewPass1?.agentSessions.map((session) => session.id), ['review-generic-1']);
    assert.deepEqual(reviewPass2?.agentSessions.map((session) => session.id), ['review-generic-2']);
    assert.deepEqual(reviewPass3?.agentSessions.map((session) => session.id), ['review-generic-3']);
    assert.deepEqual(
      workflow.childSessions
        .filter((session) => session.id.startsWith('review-generic-'))
        .map((session) => [session.id, session.reviewPassIndex, session.substageKey]),
      [
        ['review-generic-1', 1, 'review_1'],
        ['review-generic-2', 2, 'review_2'],
        ['review-generic-3', 3, 'review_3'],
      ],
    );
  });
});

test('review sessions mislabeled as execution node_execution are repaired into verification review passes', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-review-node-execution-repair`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-review-node-execution-repair'], { cwd: projectPath });
    await writeOpenSpecTasks(projectPath, '1-review-node-execution-repair', [true, true]);
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '修复 execution/node_execution 下的 review 会话',
                objective: '前两轮 review 不应继续挂在 execution.node_execution',
                openspecChangeName: '1-review-node-execution-repair',
                stage: 'verification',
                runState: 'running',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'completed' },
                  { key: 'verification', label: '验证', status: 'active' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                childSessions: [
                  { id: 'workflow-review-1', title: '内部审核第 1 轮：范围覆盖', stageKey: 'execution', substageKey: 'node_execution' },
                  { id: 'workflow-review-2', title: '内部审核第 2 轮：风险回归', stageKey: 'execution', substageKey: 'node_execution' },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const verificationStage = findStageInspection(workflow, 'verification');
    const reviewPass1 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_1');
    const reviewPass2 = verificationStage?.substages.find((substage) => substage.substageKey === 'review_2');

    assert.equal(reviewPass1?.agentSessions.length, 1);
    assert.equal(reviewPass1?.agentSessions[0]?.id, 'workflow-review-1');
    assert.equal(reviewPass2?.agentSessions.length, 1);
    assert.equal(reviewPass2?.agentSessions[0]?.id, 'workflow-review-2');
  });
});

test('legacy execution apply session is repaired into execution node_execution instead of planning', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-execution-session-repair`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-execution-session-repair'], { cwd: projectPath });
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '执行会话修复',
                objective: '执行提案的会话不应继续留在规划层',
                openspecChangeName: '1-execution-session-repair',
                stage: 'execution',
                runState: 'running',
                stageStatuses: [
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'active' },
                  { key: 'verification', label: '验证', status: 'pending' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [],
                childSessions: [
                  {
                    id: 'sess-apply-repaired',
                    title: '执行 OpenSpec 变更中的任务',
                    stageKey: 'planning',
                    substageKey: 'planner_output',
                  },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const executionStage = workflow.stageInspections.find((stage) => stage.stageKey === 'execution');
    const nodeExecution = executionStage?.substages.find((substage) => substage.substageKey === 'node_execution');
    const planningStage = workflow.stageInspections.find((stage) => stage.stageKey === 'planning');
    const plannerOutput = planningStage?.substages.find((substage) => substage.substageKey === 'planner_output');

    assert.ok(nodeExecution);
    assert.deepEqual(
      nodeExecution.agentSessions.map((session) => session.id),
      ['sess-apply-repaired'],
    );
    assert.equal(plannerOutput?.agentSessions?.length || 0, 0);
  });
});

test('future verification and delivery substages stay pending until their stage is actually reached', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-future-gates`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-future-gates'], { cwd: projectPath });
    await fs.mkdir(path.join(projectPath, '.ccflow', '1'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.ccflow', '1', 'verification-evidence.json'), '{}\n', 'utf8');
    await fs.writeFile(path.join(projectPath, '.ccflow', '1', 'delivery-summary.md'), '# delivery\n', 'utf8');
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '未来阶段误打勾',
                objective: '未进入验证与交付阶段时，不应先给子阶段打勾',
                openspecChangeName: '1-future-gates',
                stage: 'execution',
                runState: 'running',
                gateDecision: 'pass',
                finalReadiness: true,
                stageStatuses: [
                  { key: 'discussion', label: '讨论', status: 'skipped' },
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'active' },
                  { key: 'verification', label: '验证', status: 'pending' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [
                  { id: 'verification-evidence', label: 'verification-evidence.json', stage: 'verification', substageKey: 'verification_evidence', path: '.ccflow/1/verification-evidence.json' },
                  { id: 'delivery-summary', label: 'delivery-summary.md', stage: 'ready_for_acceptance', substageKey: 'delivery_package', path: '.ccflow/1/delivery-summary.md' },
                ],
                childSessions: [
                  { id: 'sess-apply', title: '执行会话', stageKey: 'execution', substageKey: 'node_execution' },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const verificationStage = findStageInspection(workflow, 'verification');
    const deliveryStage = workflow.stageInspections.find((stage) => stage.stageKey === 'archive');

    assert.equal(verificationStage?.status, 'pending');
    assert.equal(deliveryStage?.status, 'pending');
    assert.equal(verificationStage?.substages.find((substage) => substage.substageKey === 'review_1')?.status, 'pending');
    assert.equal(verificationStage?.substages.find((substage) => substage.substageKey === 'review_2')?.status, 'pending');
    assert.equal(verificationStage?.substages.find((substage) => substage.substageKey === 'review_3')?.status, 'pending');
    assert.equal(deliveryStage?.substages.find((substage) => substage.substageKey === 'delivery_package')?.status, 'pending');
    assert.equal(deliveryStage?.substages.length, 1);
  });
});

test('future verification and delivery substages stay pending even when booleans and artifacts already exist', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'fixture-project');
    const workflowStorePath = getWorkflowStorePath(projectPath);
    const workflowId = 'w1';
    const { getProjectWorkflow } = await import(`../../server/workflows.js?home=${encodeURIComponent(`${homeDir}-future-boolean-evidence`)}`);

    await fs.mkdir(projectPath, { recursive: true });
    await execFileAsync('openspec', ['new', 'change', '1-future-boolean-evidence'], { cwd: projectPath });
    await fs.mkdir(path.join(projectPath, '.ccflow', '1'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.ccflow', '1', 'verification-evidence.json'), '{}\n', 'utf8');
    await fs.writeFile(path.join(projectPath, '.ccflow', '1', 'delivery-summary.md'), '# delivery\n', 'utf8');
    await fs.mkdir(path.dirname(workflowStorePath), { recursive: true });
    await fs.writeFile(
      workflowStorePath,
      `${JSON.stringify({
        version: 1,
        workflows: [
              {
                id: workflowId,
                title: '未来阶段布尔值',
                objective: '验证 future stage 不会因为布尔值和残留 artifact 提前打勾',
                openspecChangeName: '1-future-boolean-evidence',
                stage: 'execution',
                runState: 'running',
                gateDecision: 'pass',
                finalReadiness: true,
                stageStatuses: [
                  { key: 'discussion', label: '讨论', status: 'skipped' },
                  { key: 'planning', label: '规划', status: 'completed' },
                  { key: 'execution', label: '执行', status: 'active' },
                  { key: 'verification', label: '验证', status: 'pending' },
                  { key: 'ready_for_acceptance', label: '交付', status: 'pending' },
                ],
                artifacts: [
                  { id: 'verification-evidence', label: 'verification-evidence.json', stage: 'verification', substageKey: 'verification_evidence', path: '.ccflow/1/verification-evidence.json' },
                  { id: 'delivery-summary', label: 'delivery-summary.md', stage: 'ready_for_acceptance', substageKey: 'delivery_package', path: '.ccflow/1/delivery-summary.md' },
                ],
                childSessions: [
                  { id: 'sess-apply', title: '执行会话', stageKey: 'execution', substageKey: 'node_execution' },
                ],
              },
            ],
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await getProjectWorkflow({ fullPath: projectPath, path: projectPath }, workflowId);
    const verificationStage = findStageInspection(workflow, 'verification');
    const deliveryStage = workflow.stageInspections.find((stage) => stage.stageKey === 'archive');

    assert.equal(verificationStage?.status, 'pending');
    assert.equal(deliveryStage?.status, 'pending');
    assert.equal(verificationStage?.substages.find((substage) => substage.substageKey === 'review_1')?.status, 'pending');
    assert.equal(verificationStage?.substages.find((substage) => substage.substageKey === 'review_2')?.status, 'pending');
    assert.equal(verificationStage?.substages.find((substage) => substage.substageKey === 'review_3')?.status, 'pending');
    assert.equal(deliveryStage?.substages.find((substage) => substage.substageKey === 'delivery_package')?.status, 'pending');
    assert.equal(deliveryStage?.substages.length, 1);
  });
});
