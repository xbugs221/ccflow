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

    await expect(page).toHaveURL(/\/project\/[^/]+\/workflow\/w1$/);
    await expect(page.getByTestId('project-workspace-nav')).toBeVisible();
    await expect(page.getByTestId('project-workspace-workflows-group')).toBeVisible();
    await expect(page.getByTestId('project-workspace-manual-sessions-group')).toBeVisible();
    await expect(page.getByTestId('project-list')).toHaveCount(0);
    await expect(page.getByTestId('project-workspace-nav-current-item')).toContainText('登录升级');
  });

  test('工作流子会话不会出现在手动会话分组里', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    const manualGroup = page.getByTestId('project-workspace-manual-sessions-group');
    await expect(manualGroup).toBeVisible();
    await expect(manualGroup).toContainText('fixture-project manual-only session');
    await expect(manualGroup).not.toContainText('子会话 规划');
    await expect(manualGroup).not.toContainText('子会话 执行');
    await expect(manualGroup).not.toContainText('fixture-project execution fixture session');
  });

  test('从项目主页进入手动会话页', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project session/ }).click();

    await expect(page).toHaveURL(/\/project\/[^/]+\/session\/fixture-project-session$/);
    await expect(page.getByTestId('project-workspace-nav')).toBeVisible();
    await expect(page.getByTestId('project-workspace-workflows-group')).toBeVisible();
    await expect(page.getByTestId('project-workspace-manual-sessions-group')).toBeVisible();
    await expect(page.getByTestId('project-workspace-nav-current-item')).toContainText('fixture-project session');
  });

  test('点击左侧项目名返回项目主页', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project session/ }).click();

    await expect(page).toHaveURL(/\/project\/[^/]+\/session\/fixture-project-session$/);
    await page.getByTestId('project-workspace-home-link').click();

    await expect(page).toHaveURL(/\/project\/[^/]+$/);
    await expect(page.getByTestId('project-workspace-overview')).toBeVisible();
  });

  test('移动端打开会话页工作区导航', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixtureProject(page);
    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project session/ }).click();

    await expect(page.getByTestId('project-workspace-nav')).toHaveCount(0);
    await page.getByTestId('project-workspace-drawer-toggle').click();
    await expect(page.getByTestId('project-workspace-drawer')).toBeVisible();
    await expect(page.getByTestId('project-workspace-drawer')).toContainText('需求工作流');
    await expect(page.getByTestId('project-workspace-drawer')).toContainText('手动会话');
  });
});
