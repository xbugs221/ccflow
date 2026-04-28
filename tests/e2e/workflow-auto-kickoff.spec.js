/**
 * PURPOSE: Verify workflow creation records a backend-launched planning child
 * session so the detail page exposes a planning link without a manual refresh.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openFixtureProject, PRIMARY_FIXTURE_PROJECT_PATH } from '../spec/helpers/spec-test-helpers.js';

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

test('creating a workflow exposes the backend-launched planning child session', async ({ page }) => {
  const projectRoutePrefix = buildExpectedProjectRoutePrefix();
  await openFixtureProject(page);

  await page.getByRole('button', { name: '新建工作流' }).click();
  await page.getByLabel('摘要').fill('自动规划测试工作流');
  await page.getByLabel('需求正文').fill('验证后端自动创建规划会话并把链接暴露到工作流详情。');
  await page.getByRole('button', { name: '创建工作流' }).click();

  await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/w\\d+$`));
  await expect(page.getByTestId('workflow-stage-tree')).toBeVisible();
  await expect(page.getByTestId('project-workflow-group')).toContainText('自动规划测试工作流');
  await expect(page.getByTestId('workflow-stage-planning').getByRole('button', { name: '规划提案' })).toBeVisible();

  await page.getByTestId('workflow-stage-planning').getByRole('button', { name: '规划提案' }).click();
  await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/w\\d+/c\\d+$`));
  await expect(page.getByTestId('workflow-stage-tree-preview')).toBeVisible();
});
