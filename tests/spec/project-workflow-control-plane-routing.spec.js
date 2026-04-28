/**
 * PURPOSE: 验收测试：需求工作流详情路由与会话流程图预览交互。
 * Derived from openspec/changes/2030-ccflow-ui/specs/project-workflow-control-plane/spec.md.
 */
import { test, expect } from '@playwright/test';
import {
  authenticatePage,
  openFixtureProject,
} from './helpers/spec-test-helpers.js';

test.describe('需求工作流详情路由与会话流程图预览', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
  });

  test('项目工作区导航按需求工作流与手动会话分组显示', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    const nav = page.getByTestId('project-workspace-nav');
    await expect(nav).toBeVisible();
    await expect(nav.getByTestId('project-workspace-workflows-group')).toBeVisible();
    await expect(nav.getByTestId('project-workspace-manual-sessions-group')).toBeVisible();
    await expect(nav.getByTestId('project-workspace-workflows-group')).toContainText('登录升级');
    await expect(nav.getByTestId('project-workspace-manual-sessions-group')).toContainText('fixture-project session');
  });

  test('工作流详情展示正文流程图，工作流会话展示只读流程图预览', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();

    await expect(page).toHaveURL(/\/project\/[^/]+\/workflow\/w1$/);
    await expect(page.getByRole('heading', { name: '登录升级' })).toBeVisible();
    await expect(page.getByTestId('workflow-stage-mini-map')).toHaveCount(0);
    await expect(page.getByTestId('workflow-stage-tree')).toBeVisible();

    await page.getByTestId('workflow-stage-planning').getByRole('button').click();
    await expect(page).toHaveURL(/\/project\/[^/]+\/session\/fixture-project-session/);
    await expect(page.getByTestId('workflow-stage-tree-preview')).toBeVisible();
  });

  test('手动会话详情不展示工作流流程图预览', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project session/ }).click();

    await expect(page).toHaveURL(/\/project\/[^/]+\/session\/fixture-project-session$/);
    await expect(page.locator('[data-testid=\"chat-scroll-container\"]')).toContainText(
      'fixture-project session assistant turn 01',
    );
    await expect(page.getByTestId('workflow-stage-tree-preview')).toHaveCount(0);
  });
});
