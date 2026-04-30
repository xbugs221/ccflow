/**
 * PURPOSE: 验收测试：工作流各阶段 provider 选择。
 * Derived from openspec/changes/26-workflow-stage-provider-selection/specs/workflow-stage-provider-selection/spec.md
 * and openspec/changes/26-workflow-stage-provider-selection/specs/project-workflow-control-plane/spec.md.
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

const PROJECT_CONF_PATH = path.join(
  PLAYWRIGHT_FIXTURE_HOME,
  'workspace',
  'fixture-project',
  '.ccflow',
  'conf.json',
);

/**
 * Rewrite the fixture workflow state for provider-related assertions.
 */
function rewriteFixtureWorkflowState(nextState) {
  const config = JSON.parse(fs.readFileSync(PROJECT_CONF_PATH, 'utf8'));
  const workflow = config.workflows?.['1'];
  if (workflow) {
    Object.assign(workflow, nextState);
    if (Object.prototype.hasOwnProperty.call(nextState, 'chat')) {
      delete workflow.childSessions;
    }
  }
  fs.writeFileSync(PROJECT_CONF_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * Remove provider history that would otherwise make a fixture stage look started.
 */
function removeFixtureClaudeSession(sessionId) {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS.find((candidate) => candidate.endsWith('/fixture-project'));
  const encodedProjectPath = String(projectPath || '').replace(/\//g, '-');
  fs.rmSync(
    path.join(PLAYWRIGHT_FIXTURE_HOME, '.claude', 'projects', encodedProjectPath, `${sessionId}.jsonl`),
    { force: true },
  );
}

test.describe('工作流阶段 provider 选择', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('创建工作流时传入 stageProviders，API 归一化到 providers 并精简持久化', async ({ page }) => {
    const project = await getFixtureProject(page.request);
    const response = await page.request.post(
      `/api/projects/${encodeURIComponent(project.name)}/workflows`,
      {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        data: {
          title: 'provider 选择测试',
          objective: '验证 provider 持久化到 stageStatuses',
          stageProviders: {
            planning: 'claude',
            execution: 'codex',
            archive: 'claude',
          },
        },
      },
    );
    expect(response.ok()).toBeTruthy();

    const workflow = await response.json();
    expect(workflow.stageProviders).toBeUndefined();
    expect(workflow.stageStatuses).toContainEqual(
      expect.objectContaining({ key: 'planning', provider: 'claude' }),
    );
    expect(workflow.stageStatuses).toContainEqual(
      expect.objectContaining({ key: 'execution', provider: 'codex' }),
    );
    expect(workflow.stageStatuses).toContainEqual(
      expect.objectContaining({ key: 'archive', provider: 'claude' }),
    );

    // Verify persistence via conf.json
    const config = JSON.parse(fs.readFileSync(PROJECT_CONF_PATH, 'utf8'));
    const created = Object.values(config.workflows || {}).find(
      (w) => w.title === 'provider 选择测试',
    );
    expect(created).toBeDefined();
    expect(created).not.toHaveProperty('stageProviders');
    expect(created).not.toHaveProperty('stageStatuses');
    expect(created.providers).toEqual(expect.objectContaining({
      planning: 'claude',
      archive: 'claude',
    }));
  });

  test('创建表单只提交显式配置的 stageProviders', async ({ page }) => {
    let capturedPayload = null;
    await page.route('**/api/projects/*/workflows', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      capturedPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: `captured-${Date.now()}`,
          title: capturedPayload.title,
          objective: capturedPayload.objective,
          stageProviders: capturedPayload.stageProviders || {},
          stageStatuses: [],
        }),
      });
    });

    await openFixtureProject(page);

    await page.getByRole('button', { name: '新建工作流' }).click();
    await page.getByLabel('摘要').fill('未展开阶段配置');
    await page.getByLabel('需求正文').fill('验证未展开时不提交 stageProviders');
    await page.getByRole('button', { name: '创建' }).click();
    await expect.poll(() => capturedPayload?.title).toBe('未展开阶段配置');
    expect(capturedPayload).not.toHaveProperty('stageProviders');

    capturedPayload = null;
    await page.getByRole('button', { name: '新建工作流' }).click();
    await page.getByLabel('摘要').fill('只改 planning provider');
    await page.getByLabel('需求正文').fill('验证只提交显式修改阶段');
    await page.getByText('阶段配置').click();
    await page.getByTestId('workflow-stage-provider-planning').selectOption('claude');
    await page.getByRole('button', { name: '创建' }).click();
    await expect.poll(() => capturedPayload?.title).toBe('只改 planning provider');
    expect(capturedPayload.stageProviders).toEqual({ planning: 'claude' });
  });

  test('旧工作流默认全部 codex', async ({ page }) => {
    const project = await getFixtureProject(page.request);
    const response = await page.request.get(
      `/api/projects/${encodeURIComponent(project.name)}/workflows/w1`,
      { headers: authHeaders() },
    );
    expect(response.ok()).toBeTruthy();

    const workflow = await response.json();
    // Old workflow has no stageProviders field; all stages default to codex
    for (const stage of workflow.stageStatuses || []) {
      expect(stage.provider || 'codex').toBe('codex');
    }
  });

  test('launcher-config 返回阶段对应的 provider', async ({ page }) => {
    const project = await getFixtureProject(page.request);

    // Set explicit stage provider ownership on the fixture workflow
    rewriteFixtureWorkflowState({
      stageStatuses: [
        { key: 'planning', label: '规划提案', status: 'active', provider: 'claude' },
        { key: 'execution', label: '执行', status: 'pending', provider: 'codex' },
      ],
      chat: {},
    });

    const planningResponse = await page.request.post(
      `/api/projects/${encodeURIComponent(project.name)}/workflows/w1/launcher-config`,
      {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        data: { stage: 'planning' },
      },
    );
    expect(planningResponse.ok()).toBeTruthy();
    const planningLauncher = await planningResponse.json();
    expect(planningLauncher.provider).toBe('claude');

    const executionResponse = await page.request.post(
      `/api/projects/${encodeURIComponent(project.name)}/workflows/w1/launcher-config`,
      {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        data: { stage: 'execution' },
      },
    );
    expect(executionResponse.ok()).toBeTruthy();
    const executionLauncher = await executionResponse.json();
    expect(executionLauncher.provider).toBe('codex');

    // Default for unconfigured stage
    const archiveResponse = await page.request.post(
      `/api/projects/${encodeURIComponent(project.name)}/workflows/w1/launcher-config`,
      {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        data: { stage: 'archive' },
      },
    );
    expect(archiveResponse.ok()).toBeTruthy();
    const archiveLauncher = await archiveResponse.json();
    expect(archiveLauncher.provider).toBe('codex');
  });

  test('launcher-config 复用已有阶段会话时返回会话 provider', async ({ page }) => {
    const project = await getFixtureProject(page.request);
    rewriteFixtureWorkflowState({
      stageStatuses: [
        { key: 'planning', label: '规划提案', status: 'completed' },
        { key: 'execution', label: '执行', status: 'active', provider: 'claude' },
      ],
      chat: {
        '2': {
          title: '子会话 执行',
          summary: '执行修复',
          provider: 'codex',
          stageKey: 'execution',
          sessionId: 'fixture-project-execution-session',
        },
      },
    });

    const response = await page.request.post(
      `/api/projects/${encodeURIComponent(project.name)}/workflows/w1/launcher-config`,
      {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        data: { stage: 'execution' },
      },
    );
    expect(response.ok()).toBeTruthy();
    const launcher = await response.json();
    expect(launcher.provider).toBe('codex');
    expect(launcher.sessionId).toBe('fixture-project-execution-session');
  });

  test('stage-providers API 拒绝修改已启动阶段', async ({ page }) => {
    const project = await getFixtureProject(page.request);
    rewriteFixtureWorkflowState({
      stage: 'planning',
      stageStatuses: [
        { key: 'planning', label: '规划提案', status: 'active', provider: 'claude' },
        { key: 'execution', label: '执行', status: 'pending', provider: 'codex' },
      ],
      chat: {
        '1': {
          title: '子会话 规划',
          summary: '需求分解与计划确认',
          provider: 'claude',
          stageKey: 'planning',
          sessionId: 'fixture-project-session',
        },
      },
    });

    const response = await page.request.put(
      `/api/projects/${encodeURIComponent(project.name)}/workflows/w1/stage-providers`,
      {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        data: { stageProviders: { planning: 'codex' } },
      },
    );
    expect(response.status()).toBe(409);

    const workflowResponse = await page.request.get(
      `/api/projects/${encodeURIComponent(project.name)}/workflows/w1`,
      { headers: authHeaders() },
    );
    expect(workflowResponse.ok()).toBeTruthy();
    const workflow = await workflowResponse.json();
    expect(workflow.stageProviders).toBeUndefined();
    expect(workflow.stageStatuses).toContainEqual(
      expect.objectContaining({ key: 'planning', provider: 'claude' }),
    );
  });

  test('创建表单提供阶段配置折叠面板', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: '新建工作流' }).click();

    await expect(page.getByText('阶段配置')).toBeVisible();
    await page.getByText('阶段配置').click();

    // Each stage should have a provider select
    await expect(page.getByTestId('workflow-stage-provider-planning')).toBeVisible();
    await expect(page.getByTestId('workflow-stage-provider-execution')).toBeVisible();
    await expect(page.getByTestId('workflow-stage-provider-archive')).toBeVisible();
  });

  test('工作流详情页仅未启动阶段显示 provider 下拉', async ({ page }) => {
    removeFixtureClaudeSession('fixture-project-execution-session');
    rewriteFixtureWorkflowState({
      stage: 'planning',
      runState: 'running',
      stageStatuses: [
        { key: 'planning', label: '规划提案', status: 'active', provider: 'claude' },
        { key: 'execution', label: '执行', status: 'active', provider: 'codex' },
        { key: 'review_1', label: '初审', status: 'blocked', provider: 'claude' },
        { key: 'repair_1', label: '初修', status: 'failed', provider: 'codex' },
        { key: 'review_2', label: '再审', status: 'pending' },
        { key: 'repair_2', label: '再修', status: 'pending' },
        { key: 'review_3', label: '三审', status: 'pending' },
        { key: 'repair_3', label: '三修', status: 'pending' },
        { key: 'archive', label: '归档', status: 'pending' },
      ],
      chat: {
        '1': {
          title: '子会话 规划',
          summary: '需求分解与计划确认',
          provider: 'claude',
          stageKey: 'planning',
          sessionId: 'fixture-project-session',
        },
      },
    });

    await openFixtureProject(page, { reset: false });
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    // Planning has an active session → provider badge (read-only)
    const planningStage = page.getByTestId('workflow-stage-planning');
    await expect(planningStage.getByTestId('workflow-stage-provider-badge')).toContainText('claude');
    await expect(planningStage.locator('select')).toHaveCount(0);

    // Started stages without sessions follow the backend lock rule.
    const executionStage = page.getByTestId('workflow-stage-execution');
    await expect(executionStage.getByTestId('workflow-stage-provider-badge')).toContainText('codex');
    await expect(executionStage.locator('select')).toHaveCount(0);
  });

  test('手动推进按 launcher payload 的 provider 启动会话', async ({ page }) => {
    removeFixtureClaudeSession('fixture-project-execution-session');
    rewriteFixtureWorkflowState({
      stage: 'planning',
      runState: 'running',
      openspecChangeDetected: true,
      stageStatuses: [
        { key: 'planning', label: '规划提案', status: 'completed', provider: 'claude' },
        { key: 'execution', label: '执行', status: 'pending' },
        { key: 'review_1', label: '初审', status: 'pending' },
        { key: 'repair_1', label: '初修', status: 'pending' },
        { key: 'review_2', label: '再审', status: 'pending' },
        { key: 'repair_2', label: '再修', status: 'pending' },
        { key: 'review_3', label: '三审', status: 'pending' },
        { key: 'repair_3', label: '三修', status: 'pending' },
        { key: 'archive', label: '归档', status: 'pending' },
      ],
      chat: {
        '1': {
          title: '子会话 规划',
          summary: '需求分解与计划确认',
          provider: 'claude',
          stageKey: 'planning',
          sessionId: 'fixture-project-session',
        },
      },
    });

    await openFixtureProject(page, { reset: false });
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    // Planning completed with openspecChangeDetected → continue goes to execution
    await page.getByRole('button', { name: '继续推进' }).click();

    // Should use provider from launcher payload (planning = claude, but execution defaults to codex)
    await expect(page).toHaveURL(/\/workspace\/fixture-project\/w1\/c\d+/);
    const config = JSON.parse(fs.readFileSync(PROJECT_CONF_PATH, 'utf8'));
    const executionChat = Object.values(config.workflows?.['1']?.chat || {}).find(
      (chat) => chat?.stageKey === 'execution',
    );
    expect(executionChat).toEqual(expect.objectContaining({ provider: 'codex' }));
  });
});
