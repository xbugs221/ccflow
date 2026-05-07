/**
 * PURPOSE: 验收测试：项目、工作流和会话使用新的可读规范路由。
 * Derived from openspec/changes/2-simplify-project-workflow-routing/specs/project-route-addressing/spec.md
 * and openspec/changes/2-simplify-project-workflow-routing/specs/project-workflow-control-plane/spec.md.
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  authenticatePage,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.js';

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

test.describe('项目规范路由寻址', () => {
  test.beforeEach(async ({ page }) => {
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
    await page.getByTestId('project-workflow-group').getByRole('button', { name: /登录升级/ }).click();
    await page.getByTestId('workflow-stage-planning').getByRole('button', { name: /规划/ }).click();

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/planning$`));
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  });

  test('刷新工作流子会话页时不依赖查询参数恢复上下文', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();

    await openFixtureProject(page);
    await page.getByTestId('project-workflow-group').getByRole('button', { name: /登录升级/ }).click();
    await page.getByTestId('workflow-stage-planning').getByRole('button', { name: /规划/ }).click();

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/planning$`));
    await expect(page).not.toHaveURL(/provider=|projectPath=|workflowId=/);

    await page.reload({ waitUntil: 'networkidle' });

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/runs/run-fixture/sessions/planning$`));
    await expect(page).not.toHaveURL(/provider=|projectPath=|workflowId=/);
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  });
});
