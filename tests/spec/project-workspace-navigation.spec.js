/**
 * PURPOSE: 验收测试：项目工作区导航壳层与项目作用域路由。
 * Derived from openspec/changes/2030-ccflow-ui/specs/project-workspace-navigation/spec.md.
 */
import { test, expect } from '@playwright/test';
import {
  authenticatePage,
  openFixtureProject,
} from './helpers/spec-test-helpers.js';

test.describe('项目工作区导航壳层', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
  });

  test('打开项目工作区主页', async ({ page }) => {
    await openFixtureProject(page);

    await expect(page).toHaveURL(/\/workspace\/[^/]+$/);
    await expect(page.getByTestId('project-workspace-overview')).toBeVisible();
    await expect(page.getByTestId('project-workspace-nav')).toHaveCount(0);
    await expect(page.getByTestId('project-overview-workflows')).toContainText('登录升级');
    await expect(page.getByTestId('project-overview-manual-sessions')).toContainText('fixture-project manual-only session');
  });

  test('从项目主页进入工作流详情页', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page).toHaveURL(/\/workspace\/fixture-project\/runs\/run-fixture$/);
    await expect(page.getByTestId('project-workspace-nav')).toHaveCount(0);
    await expect(page.getByTestId('project-list')).toBeVisible();
    await expect(page.getByRole('heading', { name: '登录升级' }).last()).toBeVisible();
  });

  test('工作流子会话不会出现在手动会话分组里', async ({ page }) => {
    await openFixtureProject(page);
    await expect(page.getByTestId('project-overview-manual-sessions')).toContainText('fixture-project manual-only session');
    await expect(page.getByTestId('project-overview-manual-sessions')).not.toContainText('codex-runner-execution-thread');
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    const manualGroup = page.getByTestId('manual-session-group');
    await expect(manualGroup).toBeVisible();
    await expect(manualGroup).toContainText('fixture-project manual-only session');
    await expect(manualGroup).not.toContainText('子会话 规划');
    await expect(manualGroup).not.toContainText('子会话 执行');
    await expect(manualGroup).not.toContainText('codex-runner-execution-thread');
  });

  test('工作流详情展示 runner 进程并从详情页进入 runner 子会话', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    const processes = page.getByTestId('workflow-runner-processes');
    await expect(processes).toBeVisible();
    await expect(processes).toContainText('execution');
    await expect(processes).toContainText('completed');
    await expect(processes).toContainText('thread=fixture-project-execution-session');
    await expect(processes).toContainText('pid=4321');
    await processes.getByRole('button', { name: /log/ }).nth(1).click();
    await expect(page.locator('body')).toContainText('executor log fixture');

    await processes.getByRole('button', { name: /thread=fixture-project-execution-session/ }).click();
    await expect(page).toHaveURL(/\/workspace\/fixture-project\/runs\/run-fixture\/sessions\/execution$/);
  });

  test('从项目主页进入手动会话页', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project manual-only session/ }).first().click();

    await expect(page).toHaveURL(/\/workspace\/fixture-project\/c\d+$/);
    await expect(page.getByTestId('project-workspace-nav')).toHaveCount(0);
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toContainText(
      'fixture-project manual-only session assistant turn 01',
    );
  });

  test('点击左侧项目名返回项目主页', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project manual-only session/ }).first().click();

    await expect(page).toHaveURL(/\/workspace\/fixture-project\/c\d+$/);
    await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();

    await expect(page).toHaveURL(/\/workspace\/fixture-project$/);
    await expect(page.getByTestId('project-workspace-overview')).toBeVisible();
  });

  test('移动端打开会话页工作区导航', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixtureProject(page);
    await page.goto(`${new URL(page.url()).origin}/workspace/fixture-project/c3`);

    await expect(page.getByTestId('project-workspace-nav')).toHaveCount(0);
    await page.getByRole('button', { name: /Open menu/i }).click();
    await expect(page.getByTestId('project-list')).toBeVisible();
    await expect(page.getByTestId('project-list')).toContainText('需求工作流');
    await expect(page.getByTestId('project-list')).toContainText('手动会话');
  });
});
