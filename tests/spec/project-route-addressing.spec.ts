// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: 验收测试：项目、工作流和会话使用新的可读规范路由。
 * Derived from openspec/changes/2-simplify-project-workflow-routing/specs/project-route-addressing/spec.md
 * and openspec/changes/2-simplify-project-workflow-routing/specs/project-workflow-control-plane/spec.md.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  authenticatePage,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';
import { resolveWoRunStatePath } from '../../server/domains/workflows/wo-runtime-paths.ts';

/**
 * Build the expected project route prefix from the Playwright fixture home.
 *
 * @returns {string}
 */
function buildExpectedProjectRoutePrefix() {
  const homePath = process.env.HOME || process.env.USERPROFILE || '';
  const relativePath = path.relative(homePath, PRIMARY_FIXTURE_PROJECT_PATH).split(path.sep).join('/');
  return `/${relativePath}`;
}

async function rewriteFixtureRunState(partialState) {
  /**
   * Rewrite the fixture wo state so route recovery can verify role and by-id
   * addresses without depending on legacy workflow route indexes.
   */
  const statePath = resolveWoRunStatePath(PRIMARY_FIXTURE_PROJECT_PATH, 'run-fixture');
  const current = JSON.parse(await fs.readFile(statePath, 'utf8'));
  await fs.writeFile(statePath, `${JSON.stringify({ ...current, ...partialState }, null, 2)}\n`, 'utf8');
}

async function resetFixtureRunState() {
  /**
   * Restore the shared fixture run after route-address variants mutate it.
   */
  const statePath = resolveWoRunStatePath(PRIMARY_FIXTURE_PROJECT_PATH, 'run-fixture');
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify({
    run_id: 'run-fixture',
    change_name: '登录升级',
    status: 'running',
    stage: 'review_1',
    stages: { planning: 'completed', execution: 'completed', review_1: 'running' },
    paths: {
      executor_log: '.wo/runs/run-fixture/logs/executor.log',
      summary: 'SUMMARY.md',
      workflow_output: 'workflow-output',
    },
    sessions: {
      planning: 'fixture-project-session',
      execution: 'fixture-project-execution-session',
    },
    processes: [
      { stage: 'planning', role: 'executor', status: 'completed', sessionId: 'fixture-project-session' },
      {
        stage: 'execution',
        role: 'executor',
        status: 'completed',
        sessionId: 'fixture-project-execution-session',
        pid: 4321,
        logPath: '.wo/runs/run-fixture/logs/executor.log',
      },
    ],
  }, null, 2)}\n`, 'utf8');
}

test.describe('项目规范路由寻址', () => {
  test.beforeEach(async ({ page }) => {
    await resetFixtureRunState();
    await authenticatePage(page);
  });

  test('项目主页使用家目录相对路径', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();

    await openFixtureProject(page);

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}$`));
    await expect(page).not.toHaveURL(/\/project\//);
    await expect(page.getByTestId('project-workspace-overview')).toBeVisible();
  });

  test('工作流详情使用稳定的 runId 路由', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();

    await openFixtureProject(page);
    await page.getByTestId('project-workflow-group').getByRole('button', { name: /登录升级/ }).click();

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture$`));
    await expect(page.getByRole('heading', { name: '登录升级' }).last()).toBeVisible();
  });

  test('手动会话使用稳定的 cN 路由', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();

    await openFixtureProject(page);
    await page.getByRole('button', { name: /fixture-project manual-only session/ }).first().click();

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/c\\d+$`));
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toContainText(
      'fixture-project manual-only session assistant turn 01',
    );
  });

  test('新建手动会话后无需刷新即可进入会话路由', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();

    await openFixtureProject(page);
    page.once('dialog', async (dialog) => {
      await dialog.accept('回归验收会话');
    });
    await page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: /新建会话|New Session/i }).click();
    await page.getByTestId('project-new-session-provider-codex').click();

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/c\\d+$`));
    await expect(page.getByTestId('project-workspace-overview')).toHaveCount(0);
    await expect(page.locator('textarea')).toBeVisible();
  });

  test('工作流子会话使用嵌套的 runId/stage 路由', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();

    await openFixtureProject(page);
    await page.goto(`${projectRoutePrefix}/runs/run-fixture/sessions/execution`);

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/execution$`));
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  });

  test('刷新工作流子会话页时不依赖查询参数恢复上下文', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();

    await openFixtureProject(page);
    await page.goto(`${projectRoutePrefix}/runs/run-fixture/sessions/execution`);

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/execution$`));
    await expect(page).not.toHaveURL(/provider=|projectPath=|workflowId=/);

    await page.reload({ waitUntil: 'networkidle' });

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/execution$`));
    await expect(page).not.toHaveURL(/provider=|projectPath=|workflowId=/);
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  });

  test('刷新 role 工作流子会话页时恢复对应 session', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();
    await rewriteFixtureRunState({
      stage: 'review_1',
      status: 'running',
      stages: { planning: 'completed', execution: 'completed', review_1: 'running' },
      processes: [
        { stage: 'review_1', role: 'reviewer', status: 'running', sessionId: 'fixture-project-session' },
        { stage: 'review_1', role: 'executor', status: 'running', sessionId: 'fixture-project-execution-session' },
      ],
    });

    await page.goto(`${projectRoutePrefix}/runs/run-fixture/sessions/review_1/reviewer`);
    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/review_1/reviewer$`));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  });

  test('刷新 by-id 工作流子会话页时恢复对应 session', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();
    await rewriteFixtureRunState({
      stage: 'planning',
      status: 'running',
      stages: { planning: 'running' },
      processes: [
        { stage: 'planning', role: 'executor', status: 'running', sessionId: 'fixture-project-session' },
        { stage: 'planning', role: 'executor', status: 'running', sessionId: 'fixture-project-execution-session' },
      ],
    });

    await page.goto(`${projectRoutePrefix}/runs/run-fixture/sessions/by-id/fixture-project-session`);
    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/by-id/fixture-project-session$`));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  });
});
