/**
 * PURPOSE: 验收测试：项目内需求工作流控制面。
 * Derived from openspec/changes/2028-integrate-hybrid-control-plane-into-ccflow/specs/project-workflow-control-plane/spec.md.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  authHeaders,
  authenticatePage,
  getFixtureProject,
  openFixtureProject,
} from './helpers/spec-test-helpers.js';
import { PLAYWRIGHT_FIXTURE_HOME, PLAYWRIGHT_FIXTURE_PROJECT_PATHS } from '../e2e/helpers/playwright-fixture.js';

/**
 * Write one synthetic Claude session fixture so acceptance tests can exercise
 * real project-discovery behavior with more than five visible sessions.
 *
 * @param {string} projectPath
 * @param {string} sessionId
 * @param {string} sessionTitle
 * @param {string} timestamp
 */
function writeSyntheticClaudeSession(projectPath, sessionId, sessionTitle, timestamp) {
  const projectDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.claude',
    'projects',
    projectPath.replace(/\//g, '-'),
  );
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);
  const lines = [
    {
      sessionId,
      cwd: projectPath,
      timestamp,
      parentUuid: null,
      uuid: `${sessionId}-user-1`,
      type: 'user',
      message: {
        role: 'user',
        content: sessionTitle,
      },
    },
    {
      sessionId,
      cwd: projectPath,
      timestamp: new Date(new Date(timestamp).getTime() + 1000).toISOString(),
      type: 'assistant',
      message: {
        role: 'assistant',
        content: `${sessionTitle} assistant turn 01`,
      },
    },
  ];

  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
}

/**
 * Force one fixture workflow into a target stage so acceptance tests can
 * exercise the matching control-plane CTA with real persisted state.
 *
 * @param {string} workflowId
 * @param {{ stage: string, runState: string, stageStatuses: Array<{ key: string, label: string, status: string }>, openspecChangeDetected?: boolean, openspecChangeName?: string, adoptsExistingOpenSpec?: boolean, gateDecision?: string, finalReadiness?: boolean }} nextState
 */
function rewriteFixtureWorkflowState(workflowId, nextState) {
  const projectConfPath = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    'workspace',
    'fixture-project',
    '.ccflow',
    'conf.json',
  );
  const config = JSON.parse(fs.readFileSync(projectConfPath, 'utf8'));
  const workflowIndex = String(workflowId).replace(/^w/, '');
  const workflow = config.workflows?.[workflowIndex];

  if (workflow) {
    const nextWorkflow = {
      ...workflow,
      stage: nextState.stage,
      runState: nextState.runState,
      stageStatuses: nextState.stageStatuses,
      openspecChangeDetected: nextState.openspecChangeDetected,
      gateDecision: nextState.gateDecision,
      finalReadiness: nextState.finalReadiness,
    };
    if ('openspecChangeName' in nextState) {
      nextWorkflow.openspecChangeName = nextState.openspecChangeName;
    }
    if ('adoptsExistingOpenSpec' in nextState) {
      nextWorkflow.adoptsExistingOpenSpec = nextState.adoptsExistingOpenSpec;
    }
    config.workflows[workflowIndex] = nextWorkflow;
  }

  fs.writeFileSync(projectConfPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * Replace one fixture workflow child-session list so routing assertions can
 * exercise review links with real persisted workflow state.
 *
 * @param {string} workflowId
 * @param {Array<Record<string, unknown>>} childSessions
 */
function rewriteFixtureWorkflowChildSessions(workflowId, childSessions) {
  const projectConfPath = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    'workspace',
    'fixture-project',
    '.ccflow',
    'conf.json',
  );
  const config = JSON.parse(fs.readFileSync(projectConfPath, 'utf8'));
  const workflowIndex = String(workflowId).replace(/^w/, '');
  const workflow = config.workflows?.[workflowIndex];

  if (workflow) {
    const chat = Object.fromEntries(childSessions.map((session, index) => ([
      String(session.routeIndex || index + 1),
      {
        title: session.title,
        summary: session.summary,
        provider: session.provider,
        stageKey: session.stageKey,
        sessionId: session.id,
      },
    ])));
    config.workflows[workflowIndex] = {
      ...workflow,
      childSessions,
      chat,
    };
  }

  fs.writeFileSync(projectConfPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

test.describe('项目内需求工作流控制面', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('项目右侧正文展示默认折叠的自动工作流与手动会话入口', async ({ page }) => {
    await openFixtureProject(page);

    await expect(page.getByRole('button', { name: '新建工作流' })).toBeVisible();
    await expect(page.getByRole('button', { name: /新建会话|New Session/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: '手动会话' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '自动工作流' })).toBeVisible();
    await expect(page.getByTestId('project-overview-manual-sessions')).toBeVisible();
    await expect(page.getByTestId('project-overview-workflows')).toBeVisible();
    await expect(page.getByRole('button', { name: /登录升级/ })).toHaveCount(0);
  });

  test('项目主页手动会话超过 5 个时仍展示全部已加载卡片', async ({ page }) => {
    const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
    for (let index = 0; index < 5; index += 1) {
      const sequence = String(index + 1).padStart(2, '0');
      writeSyntheticClaudeSession(
        projectPath,
        `fixture-project-overflow-session-${sequence}`,
        `fixture-project overflow session ${sequence}`,
        `2026-04-17T${String(10 + index).padStart(2, '0')}:00:00.000Z`,
      );
    }

    await openFixtureProject(page);
    const manualSessionsPanel = page.getByTestId('project-overview-manual-sessions');
    const manualSessionCards = manualSessionsPanel.getByRole('button').filter({ hasText: /条消息/ });

    await expect(manualSessionsPanel).toContainText('7 个可直接进入的会话');
    await expect(manualSessionCards).toHaveCount(7);
    await expect(manualSessionsPanel).toContainText('fixture-project session');
    await expect(manualSessionsPanel).toContainText('fixture-project execution fixture session');
    await expect(manualSessionsPanel).toContainText('fixture-project overflow session 05');
  });

  test('项目主页手动会话卡片支持多选后批量标记和隐藏', async ({ page }) => {
    await openFixtureProject(page);
    const manualSessionsPanel = page.getByTestId('project-overview-manual-sessions');
    const firstSessionCard = page.getByRole('button', { name: /fixture-project session/ }).first();
    const secondSessionCard = page.getByRole('button', { name: /fixture-project execution fixture session/ }).first();

    await page.getByTestId('project-overview-session-selection-toggle').click();
    await firstSessionCard.click();
    await secondSessionCard.click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('project-overview-session-bulk-toolbar')).toContainText('已选 2 个');

    await page.getByTestId('project-overview-bulk-pending').click();
    await expect(manualSessionsPanel.getByText('待处理')).toHaveCount(2);

    await page.getByTestId('project-overview-bulk-hide').click();
    await expect(page.getByRole('button', { name: /fixture-project session/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /fixture-project execution fixture session/ })).toHaveCount(0);
  });

  test('手动会话详情也支持跟随最新进度', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project session/ }).click();
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toContainText(
      'fixture-project session assistant turn 01',
    );
    await expect(page.getByTestId('chat-follow-latest')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('chat-follow-latest').click();
    await expect(page.getByTestId('chat-follow-latest')).toHaveAttribute('aria-pressed', 'true');
  });

  test('项目主页点击新建会话会先选择 provider 并在首条消息后切到真实 session', async ({ page }) => {
    await openFixtureProject(page);

    await page.getByRole('button', { name: /新建会话|New Session/i }).click();
    await expect(page.getByTestId('project-new-session-provider-picker')).toBeVisible();
    await expect(page.getByTestId('project-new-session-provider-claude')).toBeVisible();
    await expect(page.getByTestId('project-new-session-provider-codex')).toBeVisible();
    await page.getByTestId('project-new-session-provider-codex').click();

    await expect(page).toHaveURL(/\/session\/new-session-/);
    await expect(page).toHaveURL(/provider=codex/);

    await page.locator('textarea').first().fill('请创建一个新的 codex 会话');
    await page.locator('form button[type="submit"]').last().click();

    await expect(page).not.toHaveURL(/\/session\/new-session-/);
    await expect(page).toHaveURL(/\/session\/[0-9a-f-]+$/);
  });

  test('控制面工作流详情展示阶段与子会话入口', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByRole('heading', { name: '登录升级' })).toBeVisible();
    await expect(page.getByTestId('workflow-follow-latest')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('阶段进度')).toHaveCount(0);
    await page.getByTestId('workflow-follow-latest').click();
    await expect(page.getByTestId('workflow-follow-latest')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('workflow-stage-planning').getByRole('button', { name: /规划/ }).click();
    await expect(page.getByTestId('workflow-substage-planner_output')).toBeVisible();
    await page.getByTestId('workflow-stage-execution').getByRole('button', { name: /执行/ }).click();
    await expect(page.getByTestId('workflow-substage-node_execution')).toContainText('子会话 执行');
    await expect(page.getByText('阶段树')).toBeVisible();
    await expect(page.getByTestId('workflow-substage-status_sync')).toContainText('SUMMARY.md');
    await expect(page.getByTestId('workflow-stage-tree')).not.toContainText('已完成');
    await expect(page.getByText('全部子会话')).toHaveCount(0);
    await expect(page.getByText('全部产物')).toHaveCount(0);

    await page.getByTestId('workflow-substage-planner_output').getByRole('link', { name: /子会话.*规划/ }).click();
    await expect(page).toHaveURL(/\/session\//);
    await expect(page).toHaveURL(/workflowId=w1/);
    await expect(page).toHaveURL(/projectName=/);
    await expect(page).toHaveURL(/provider=(claude|codex)/);
  });

  test('打开规划会话会直接进入已有 planning 子会话', async ({ page }) => {
    rewriteFixtureWorkflowState('w1', {
      stage: 'planning',
      runState: 'planning',
      stageStatuses: [
        { key: 'planning', label: 'Planning', status: 'active' },
        { key: 'execution', label: 'Execution', status: 'pending' },
        { key: 'verification', label: 'Verification', status: 'pending' },
        { key: 'ready_for_acceptance', label: 'Ready for acceptance', status: 'pending' },
      ],
    });

    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();
    await page.getByRole('button', { name: '打开规划会话' }).click();

    await expect(page).toHaveURL(/\/session\/fixture-project-session/);
    await expect(page).not.toHaveURL(/\/session\/new-session-/);
    await expect(page).toHaveURL(/provider=claude/);
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toContainText(
      'fixture-project session assistant turn 01',
    );
  });

  test('指定 OpenSpec 变更后不显示手动开始执行入口', async ({ page }) => {
    rewriteFixtureWorkflowState('w1', {
      stage: 'planning',
      runState: 'planning',
      openspecChangeDetected: true,
      stageStatuses: [
        { key: 'planning', label: 'Planning', status: 'completed' },
        { key: 'execution', label: 'Execution', status: 'pending' },
        { key: 'verification', label: 'Verification', status: 'pending' },
        { key: 'ready_for_acceptance', label: 'Ready for acceptance', status: 'pending' },
      ],
    });

    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByRole('button', { name: '开始执行' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续推进' })).toHaveCount(0);
  });

  test('新建工作流后会直接进入 planning 子会话并显示只读流程图预览', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: '新建工作流' }).click();
    await page.getByPlaceholder('例如：支持讨论优先的自动工作流').fill('自动触发规划讨论');
    await page.getByLabel('需求正文').fill('验证新建工作流后会暴露后端创建的规划会话。');
    await page.getByRole('button', { name: '创建工作流' }).click();

    await expect(page).toHaveURL(/\/project\/[^/]+\/workflow\/[^/]+\/session\/[^/]+$/);
    await expect(page.getByTestId('workflow-stage-tree-preview')).toBeVisible();
  });

  test('工作流产物可直接打开文件或目录', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByTestId('workflow-substage-verification_evidence')).toContainText('workflow-output');

    await page.getByRole('button', { name: /执行/ }).click();
    await expect(page.getByTestId('workflow-substage-status_sync')).toContainText('SUMMARY.md');
    await page.getByTestId('workflow-substage-status_sync').getByRole('button', { name: /SUMMARY.md/ }).click();
    await expect(page.locator('body')).toContainText('Workflow summary fixture');

    await page.getByTestId('workflow-substage-verification_evidence').getByRole('button', { name: /workflow-output/ }).click();
    await expect(page.locator('body')).toContainText('result.txt');
  });

  test('2030 需求工作流详情默认落在项目作用域详情路由', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page).toHaveURL(/\/project\/[^/]+\/workflow\/w1$/);
    await expect(page.getByRole('heading', { name: '登录升级' })).toBeVisible();
    await expect(page.locator('[data-testid=\"chat-scroll-container\"]')).toHaveCount(0);
  });

  test('2030 工作流详情页显示正文流程图，工作流子会话页显示只读流程图预览', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByTestId('workflow-stage-tree')).toBeVisible();
    await expect(page.getByTestId('workflow-stage-mini-map')).toHaveCount(0);

    await page.getByTestId('workflow-stage-planning').getByRole('button').click();
    await expect(page).toHaveURL(/\/project\/[^/]+\/session\/fixture-project-session/);
    await expect(page.getByTestId('workflow-stage-tree-preview')).toBeVisible();

    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project session/ }).click();
    await expect(page.getByTestId('workflow-stage-tree-preview')).toHaveCount(0);
  });

  test('人工审核后可从工作流详情继续推进下一轮审核', async ({ page }) => {
    const project = await getFixtureProject(page.request);
    const response = await page.request.post(
      `/api/projects/${encodeURIComponent(project.name)}/workflows/w1/child-sessions`,
      {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        data: {
          sessionId: 'workflow-review-1',
          title: '内部审核第 1 轮：需求与范围覆盖',
          summary: '人工审核已完成第 1 轮',
          provider: 'codex',
          stageKey: 'review_1',
          url: '/session/workflow-review-1',
        },
      },
    );
    expect(response.ok()).toBeTruthy();

    const projectRouteId = encodeURIComponent(project.fullPath || project.path || project.name)
      .replace(/_/g, '%5F')
      .replace(/%2F/gi, '_');
    await page.goto(`/project/${projectRouteId}?workflowId=w1`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: '登录升级' })).toBeVisible();
    await expect(page.getByRole('button', { name: '继续推进' })).toBeVisible();
    await page.getByRole('button', { name: '继续推进' }).click();

    await expect(page).toHaveURL(/\/session\/new-session-/);
    await expect(page).toHaveURL(/workflowId=w1/);
    await expect(page).toHaveURL(new RegExp(`projectPath=${encodeURIComponent(project.fullPath)}`));
    await expect(page).toHaveURL(/workflowStageKey=review_2/);
  });

  test('工作流详情里的三轮审核链接会打开各自对应的内部会话', async ({ page }) => {
    rewriteFixtureWorkflowChildSessions('w1', [
      {
        id: 'fixture-project-session',
        title: '子会话 规划',
        summary: '需求分解与计划确认',
        provider: 'claude',
        stageKey: 'planning',
      },
      {
        id: 'fixture-project-execution-session',
        title: '子会话 执行',
        summary: '实现与运行状态同步',
        provider: 'claude',
        stageKey: 'execution',
      },
      {
        id: 'workflow-review-1',
        title: '内部审核第 1 轮：范围覆盖',
        summary: '审核第 1 轮',
        provider: 'codex',
        stageKey: 'review_1',
      },
      {
        id: 'workflow-review-2',
        title: '内部审核第 2 轮：风险回归',
        summary: '审核第 2 轮',
        provider: 'codex',
        stageKey: 'review_2',
      },
      {
        id: 'workflow-review-3',
        title: '内部审核第 3 轮：最终收敛',
        summary: '审核第 3 轮',
        provider: 'codex',
        stageKey: 'review_3',
      },
    ]);

    await openFixtureProject(page);
    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project manual-only session/ }).click();
    await expect(page).toHaveURL(/\/session\/fixture-project-manual-session/);

    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await page.getByTestId('workflow-substage-review_1').getByRole('button', { name: /需求与范围覆盖/ }).click();
    await expect(page).toHaveURL(/\/session\/workflow-review-1/);
    await expect(page).toHaveURL(/provider=codex/);

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '登录升级' })).toBeVisible();
    await page.getByTestId('workflow-substage-review_2').getByRole('button', { name: /实现风险与回归/ }).click();
    await expect(page).toHaveURL(/\/session\/workflow-review-2/);
    await expect(page).toHaveURL(/provider=codex/);

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '登录升级' })).toBeVisible();
    await page.getByTestId('workflow-substage-review_3').getByRole('button', { name: /验收与交付闭环/ }).click();
    await expect(page).toHaveURL(/\/session\/workflow-review-3/);
    await expect(page).toHaveURL(/provider=codex/);
  });

  test('新建会话占位路由在 projectName 错误时仍优先使用 projectPath 选中项目', async ({ page }) => {
    const project = await getFixtureProject(page.request);
    const wrongProjectName = `${project.fullPath}-wrong`.replace(/\//g, '-');
    const sessionSummary = '路径优先回归会话';
    const sessionUrl = `/session/new-session-route-path-priority?projectName=${encodeURIComponent(wrongProjectName)}&projectPath=${encodeURIComponent(project.fullPath)}&provider=codex&sessionSummary=${encodeURIComponent(sessionSummary)}`;

    await authenticatePage(page);
    await page.goto(sessionUrl, { waitUntil: 'domcontentloaded' });

    const sessionHeading = page.getByRole('heading', { name: sessionSummary });
    await expect(sessionHeading).toBeVisible();
    await expect(sessionHeading.locator('xpath=following-sibling::div[1]')).toHaveText(project.displayName || project.name);
  });

  test('阶段树会显示当前停留原因和缺失产物提示', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await page.getByRole('button', { name: /验收/ }).click();
    await expect(page.getByRole('button', { name: /delivery-summary\.md/ })).toBeVisible();
    await expect(page.getByText('delivery-summary.md 尚未生成。')).toBeVisible();
  });

  test('收尾工作流只显示一个归档入口并允许选择验收决策', async ({ page }) => {
    await openFixtureProject(page);

    rewriteFixtureWorkflowState('w1', {
      stage: 'archive',
      runState: 'blocked',
      gateDecision: 'pending',
      finalReadiness: false,
      stageStatuses: [
        { key: 'planning', label: 'Planning', status: 'completed' },
        { key: 'execution', label: 'Execution', status: 'completed' },
        { key: 'review_1', label: '初审', status: 'completed' },
        { key: 'repair_1', label: '初修', status: 'completed' },
        { key: 'review_2', label: '再审', status: 'completed' },
        { key: 'repair_2', label: '再修', status: 'completed' },
        { key: 'review_3', label: '三审', status: 'completed' },
        { key: 'repair_3', label: '三修', status: 'completed' },
        { key: 'archive', label: '归档', status: 'active' },
      ],
    });
    rewriteFixtureWorkflowChildSessions('w1', [
      {
        id: 'archive-session-old',
        routeIndex: 11,
        title: '归档会话',
        summary: '旧归档会话',
        provider: 'codex',
        stageKey: 'archive',
      },
      {
        id: 'archive-session-new',
        routeIndex: 12,
        title: '归档会话',
        summary: '最新归档会话',
        provider: 'codex',
        stageKey: 'archive',
      },
    ]);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByTestId('workflow-stage-archive').getByRole('button', { name: '归档' })).toHaveCount(1);
    await expect(page.getByText('验收状态')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续推进' })).toHaveCount(0);
    await expect(page.getByTestId('workflow-gate-decision-pass')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('workflow-gate-decision-pass').click();
    await expect(page.getByTestId('workflow-gate-decision-pass')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('workflow-gate-decision-needs_repair').click();
    await expect(page.getByTestId('workflow-gate-decision-needs_repair')).toHaveAttribute('aria-pressed', 'true');
  });

  test('刷新后保留工作流控制面状态', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page.getByText('阶段进度')).toHaveCount(0);
    await expect(page.getByTestId('workflow-stage-tree')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: '登录升级' })).toBeVisible();
    await expect(page.getByText('阶段进度')).toHaveCount(0);
    await expect(page.getByTestId('workflow-stage-tree')).toBeVisible();
  });

  test('项目列表保持字母序并显示项目级活跃状态与未读绿点', async ({ page }) => {
    await expect(page.getByTestId('project-list-item-alpha')).toBeVisible();
    await expect(page.getByTestId('project-list-item-fixture-project')).toBeVisible();
    await expect(page.getByTestId('project-list-item-zeta')).toBeVisible();
    await expect(page.getByTestId('project-list-item-fixture-project')).not.toContainText('workflows');
    await expect(page.getByTestId('project-list-item-fixture-project')).not.toContainText('/home/');

    await expect(page.getByTestId('project-list')).toHaveAttribute(
      'data-project-order',
      'alpha,fixture-project,zeta',
    );
    await expect(
      page
        .getByRole('button', { name: /^fixture-project\b/i })
        .first()
        .locator('[data-testid="project-list-item-fixture-project-active-dot"]'),
    ).toBeVisible();
    await expect(page.getByTestId('project-list-item-fixture-project-unread-dot')).toBeVisible();
    await expect(page.getByTestId('project-list')).toHaveAttribute(
      'data-project-order',
      'alpha,fixture-project,zeta',
    );
  });

  test('左侧项目点击后可再次点击收起已展开内容', async ({ page }) => {
    await openFixtureProject(page);

    const projectSurface = page.getByTestId('project-list-item-fixture-project-desktop-surface');
    await expect(projectSurface).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('project-workflow-group')).toBeVisible();
    await expect(page.getByTestId('manual-session-group')).toBeVisible();

    await projectSurface.click();
    await expect(projectSurface).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('project-workflow-group')).toHaveCount(0);
    await expect(page.getByTestId('manual-session-group')).toHaveCount(0);

    await projectSurface.click();
    await expect(projectSurface).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('project-workflow-group')).toBeVisible();
    await expect(page.getByTestId('manual-session-group')).toBeVisible();
  });

  test('桌面端项目操作默认隐藏并通过右键打开', async ({ page }) => {
    await expect(page.getByTestId('project-list-item-fixture-project-context-menu')).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/project\//);

    await page.getByTestId('project-list-item-fixture-project-desktop-surface').click({ button: 'right' });

    await expect(page).not.toHaveURL(/\/project\//);
    await expect(page.getByTestId('project-list-item-fixture-project-context-menu')).toBeVisible();
    await page.getByTestId('project-list-item-fixture-project-rename-action').click();
    await expect(page.locator('[data-testid="project-list-item-fixture-project"] input:visible')).toHaveCount(1);
  });

  test('移动端项目操作默认隐藏并通过长按打开', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open menu' }).click();

    await expect(page.getByTestId('project-list-item-fixture-project-context-menu')).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/project\//);

    await page.getByTestId('project-list-item-fixture-project-mobile-surface').dispatchEvent('touchstart');
    await expect(page.getByTestId('project-list-item-fixture-project-context-menu')).toBeVisible();
    await page.getByTestId('project-list-item-fixture-project-mobile-surface').dispatchEvent('touchend');

    await expect(page).not.toHaveURL(/\/project\//);
    await expect(page.getByTestId('project-list-item-fixture-project-context-menu')).toBeVisible();
    await expect(page.getByTestId('project-list-item-fixture-project-rename-action')).toBeVisible();
    await expect(page.getByTestId('project-list-item-fixture-project-delete-action')).toBeVisible();
  });

  test('在项目会话内再次点击左侧项目会回到项目主页', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project session/ }).click();
    await expect(page).toHaveURL(/\/session\//);

    await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();
    await expect(page).toHaveURL(/\/project\//);
    await expect(page.getByRole('heading', { name: '自动工作流' })).toBeVisible();
  });

  test('查看后清除项目未读绿点', async ({ page }) => {
    await expect(page.getByTestId('project-list-item-fixture-project-unread-dot')).toBeVisible();

    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();
    await expect(page.getByTestId('workflow-last-update')).toBeVisible();

    await page.getByRole('button', { name: /标记为已读/ }).click();
    await expect(page.getByTestId('project-list-item-fixture-project-unread-dot')).toHaveCount(0);
  });

  test('项目主页的工作流和会话右键菜单支持收藏、待处理、隐藏及恢复', async ({ page }) => {
    await openFixtureProject(page);

    const sidebarSessionCard = page.getByTestId('manual-session-group').getByRole('button', { name: /fixture-project session/ }).first();
    await sidebarSessionCard.click({ button: 'right' });
    await expect(page.getByTestId('sidebar-session-context-rename')).toHaveText('');
    await expect(page.getByTestId('sidebar-session-context-favorite')).toHaveText('');
    await expect(page.getByTestId('sidebar-session-context-pending')).toHaveText('');
    await expect(page.getByTestId('sidebar-session-context-hide')).toHaveText('');
    await expect(page.getByTestId('sidebar-session-context-delete')).toHaveText('');
    await page.keyboard.press('Escape');

    const workflowCard = page.getByRole('button', { name: /登录升级/ }).first();
    await workflowCard.click({ button: 'right' });
    await page.getByTestId('project-overview-context-favorite').click();
    await expect(page.getByTestId('project-overview-workflows')).toContainText('收藏');

    await workflowCard.click({ button: 'right' });
    await page.getByTestId('project-overview-context-pending').click();
    await expect(page.getByTestId('project-overview-workflows')).toContainText('待处理');

    const sessionCard = page.getByRole('button', { name: /fixture-project session/ }).first();
    await sessionCard.click({ button: 'right' });
    await page.getByTestId('project-overview-context-pending').click();
    await expect(page.getByTestId('project-overview-manual-sessions')).toContainText('待处理');

    await sessionCard.click({ button: 'right' });
    await page.getByTestId('project-overview-context-hide').click();
    await expect(page.getByRole('button', { name: /fixture-project session/ })).toHaveCount(0);

    await workflowCard.click({ button: 'right' });
    await page.getByTestId('project-overview-context-hide').click();
    await expect(page.getByRole('button', { name: /登录升级/ })).toHaveCount(0);

    await page.getByRole('button', { name: /显示已隐藏项/ }).click();
    await expect(page.getByRole('button', { name: /fixture-project session/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /登录升级/ })).toBeVisible();

    await page.getByRole('button', { name: /fixture-project session/ }).first().click({ button: 'right' });
    await page.getByTestId('project-overview-context-hide').click();
    await expect(page.getByRole('button', { name: /fixture-project session/ })).toBeVisible();

    await page.getByRole('button', { name: /登录升级/ }).first().click({ button: 'right' });
    await page.getByTestId('project-overview-context-hide').click();
    await expect(page.getByRole('button', { name: /登录升级/ })).toBeVisible();
  });
});
