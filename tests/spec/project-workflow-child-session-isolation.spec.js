/**
 * PURPOSE: 验收测试：从已有工作流子会话创建新的工作流时，聊天视图不得串用旧会话消息。
 * Derived from openspec/changes/18-ccflow-bug/specs/project-workflow-control-plane/spec.md
 * and openspec/changes/18-ccflow-bug/specs/project-route-addressing/spec.md.
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

test.describe('工作流子会话隔离', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
  });

  test('从 w1/c1 创建 w2 后，w2/c1 不再展示 w1/c1 的历史消息', async ({ page }) => {
    const projectRoutePrefix = buildExpectedProjectRoutePrefix();

    await openFixtureProject(page);
    await page.getByTestId('project-workflow-group').getByRole('button', { name: /登录升级/ }).click();
    await page.getByTestId('workflow-stage-node-planning').click();

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/w1/c1$`));
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toContainText(
      'fixture-project session assistant turn 01',
    );

    page.once('dialog', async (dialog) => {
      await dialog.accept('隔离验证工作流');
    });
    await page.getByTestId('project-workflow-group').getByRole('button', { name: '新建' }).click();

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/w2/c1$`));
    await expect(page.getByTestId('workflow-stage-tree-preview')).toBeVisible();
    await expect(page.getByTestId('project-workflow-group')).toContainText('隔离验证工作流');
    await expect(page.locator('[data-testid="chat-scroll-container"]')).not.toContainText(
      'fixture-project session assistant turn 01',
    );

    await page.reload({ waitUntil: 'networkidle' });

    await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/w2/c1$`));
    await expect(page.locator('[data-testid="chat-scroll-container"]')).not.toContainText(
      'fixture-project session assistant turn 01',
    );
  });
});
