/**
 * PURPOSE: 验收测试：多轮 wo 工作流在卡片和详情页保持紧凑且可跳转。
 * 测试通过真实 fixture run state 进入页面，覆盖用户查看与点击产物的业务路径。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  authenticatePage,
  openFixtureProject,
} from './spec/helpers/spec-test-helpers.js';
import { PLAYWRIGHT_FIXTURE_PROJECT_PATHS } from './e2e/helpers/playwright-fixture.js';
import { resolveWoRunStatePath } from '../server/domains/workflows/wo-runtime-paths.js';

/**
 * Write a multi-round wo state fixture and matching artifact files for UI tests.
 */
function writeMultiRoundWorkflowFixture() {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const reviewOne = '.local/share/wo/run-fixture/review-1.json';
  const reviewTwo = '.local/share/wo/run-fixture/review-2.json';
  const repairOne = '.local/share/wo/run-fixture/repair-1.json';
  for (const relativePath of [reviewOne, reviewTwo, repairOne]) {
    const absolutePath = path.join(projectPath, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, JSON.stringify({ path: relativePath }), 'utf8');
  }

  const statePath = resolveWoRunStatePath(projectPath, 'run-fixture');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  fs.writeFileSync(statePath, `${JSON.stringify({
    ...state,
    status: 'running',
    stage: 'review_2',
    stages: {
      execution: 'completed',
      review_1: 'completed',
      repair_1: 'completed',
      review_2: 'running',
    },
    sessions: {
      'codex:executor': 'executor-session-long-id',
      'codex:reviewer': 'reviewer-session-long-id',
    },
    processes: [
      { stage: 'execution', role: 'executor', status: 'completed', sessionId: 'executor-session-long-id' },
      { stage: 'repair_1', role: 'executor', status: 'completed', sessionId: 'executor-session-long-id' },
      { stage: 'review_2', role: 'reviewer', status: 'running', sessionId: 'reviewer-session-long-id' },
    ],
    paths: {
      review_1: reviewOne,
      review_2: reviewTwo,
      repair_1_summary: repairOne,
    },
  }, null, 2)}\n`, 'utf8');
}

/**
 * Return the project overview workflow card, expanding the section only when
 * the project overview has not already rendered cards.
 */
async function getOverviewWorkflowCard(page) {
  const workflowsPanel = page.getByTestId('project-overview-workflows');
  const workflowCard = workflowsPanel.getByRole('button', { name: /登录升级/ }).first();
  if (await workflowCard.count() === 0) {
    await workflowsPanel.getByRole('button', { name: /自动工作流/ }).click();
  }
  return workflowCard;
}

test.describe('多轮工作流呈现', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
    await openFixtureProject(page);
    writeMultiRoundWorkflowFixture();
    await page.reload({ waitUntil: 'networkidle' });
  });

  test('项目卡片聚合审核和修复轮次', async ({ page }) => {
    const workflowCard = await getOverviewWorkflowCard(page);

    await expect(workflowCard.getByTestId('workflow-stage-progress-review')).toHaveCount(1);
    await expect(workflowCard.getByTestId('workflow-stage-progress-repair')).toHaveCount(1);
    await expect(workflowCard).toContainText('x2');
    await expect(workflowCard).toContainText('x1');
  });

  test('详情角色行显示短会话链接、数字计数和当前轮次产物', async ({ page }) => {
    const workflowCard = await getOverviewWorkflowCard(page);
    await workflowCard.click();

    const executorRow = page.getByTestId('workflow-role-row-executor');
    const reviewerRow = page.getByTestId('workflow-role-row-reviewer');
    await expect(executorRow).toContainText('x2');
    await expect(reviewerRow).toContainText('x2');
    await expect(executorRow).not.toContainText('✓✓');
    await expect(reviewerRow).not.toContainText('✓✓');
    await expect(executorRow.getByRole('button', { name: /^会话$/ })).toBeVisible();
    await expect(reviewerRow.getByRole('button', { name: /^会话$/ })).toBeVisible();
    await expect(executorRow).not.toContainText('executor-session-long-id');
    await expect(reviewerRow).not.toContainText('reviewer-session-long-id');
    await expect(reviewerRow.getByRole('button', { name: 'review-2.json' })).toBeVisible();
    await expect(reviewerRow).not.toContainText('review-1.json');

    await reviewerRow.getByRole('button', { name: 'review-2.json' }).click();
    await expect(page.getByRole('heading', { name: 'review-2.json' })).toBeVisible();

    await reviewerRow.getByRole('button', { name: /^会话$/ }).click();
    await expect(page).toHaveURL(/\/runs\/run-fixture\/sessions\/review_2$/);
  });
});
