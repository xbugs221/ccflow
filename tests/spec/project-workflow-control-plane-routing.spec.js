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

    await expect(page).toHaveURL(/\/workspace\/fixture-project\/w1$/);
    await expect(page.getByRole('heading', { name: '登录升级' }).last()).toBeVisible();
    await expect(page.getByTestId('workflow-stage-mini-map')).toHaveCount(0);
    await expect(page.getByTestId('workflow-stage-tree')).toBeVisible();

    await page.getByTestId('workflow-stage-planning').getByRole('button', { name: '规划提案' }).click();
    await expect(page).toHaveURL(/\/workspace\/fixture-project\/w1\/c1$/);
    await expect(page.getByTestId('workflow-stage-tree-preview')).toBeVisible();
  });

  test('工作流会话流程图预览可以拖动到不遮挡正文的位置', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /自动工作流/ }).click();
    await page.getByRole('button', { name: /登录升级/ }).click();
    await page.getByTestId('workflow-stage-planning').getByRole('button', { name: '规划提案' }).click();

    const miniMap = page.getByTestId('workflow-minimap');
    const dragHandle = page.getByTestId('workflow-minimap-drag-handle');
    await expect(page.getByTestId('workflow-stage-tree-preview')).toBeVisible();

    const beforeBox = await miniMap.boundingBox();
    const handleBox = await dragHandle.boundingBox();
    expect(beforeBox).not.toBeNull();
    expect(handleBox).not.toBeNull();

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 - 220,
      handleBox.y + handleBox.height / 2 + 140,
      { steps: 6 },
    );
    await page.mouse.up();

    const afterBox = await miniMap.boundingBox();
    expect(afterBox).not.toBeNull();
    expect(afterBox.x).toBeLessThan(beforeBox.x - 100);
    expect(afterBox.y).toBeGreaterThan(beforeBox.y + 80);
  });

  test('手动会话详情不展示工作流流程图预览', async ({ page }) => {
    await openFixtureProject(page);
    await page.getByRole('button', { name: /手动会话/ }).click();
    await page.getByRole('button', { name: /fixture-project session/ }).click();

    await expect(page).toHaveURL(/\/workspace\/fixture-project\/c1$/);
    await expect(page.locator('[data-testid=\"chat-scroll-container\"]')).toContainText(
      'fixture-project session assistant turn 01',
    );
    await expect(page.getByTestId('workflow-stage-tree-preview')).toHaveCount(0);
  });
});
