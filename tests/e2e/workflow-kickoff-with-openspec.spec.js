/**
 * PURPOSE: 验证通过网页 UI 创建工作流并绑定已有 OpenSpec 变更后，
 * 工作流系统能自动检测变更并推进。
 *
 * 测试场景：
 * 1. 在 fixture 项目中准备 OpenSpec 变更文档
 * 2. 用 Playwright 模拟用户打开项目 -> 新建工作流 -> 选择已有 OpenSpec 变更 -> 创建
 * 3. 验证工作流被正确创建并绑定到 OpenSpec 变更
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
  authHeaders,
  getFixtureProject,
} from '../spec/helpers/spec-test-helpers.js';

const OPEN_SPEC_CHANGE_NAME = '25-home-session-card-activity-ui';

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

/**
 * Prepare OpenSpec change documents in the fixture project.
 */
async function prepareOpenSpecChange() {
  const changeRoot = path.join(PRIMARY_FIXTURE_PROJECT_PATH, 'docs', 'changes', OPEN_SPEC_CHANGE_NAME);
  await fs.mkdir(changeRoot, { recursive: true });
  await fs.mkdir(path.join(changeRoot, 'specs'), { recursive: true });

  await fs.writeFile(
    path.join(changeRoot, '.openspec.yaml'),
    'schema: spec-driven\ncreated: 2026-04-28\n',
    'utf8',
  );

  await fs.writeFile(
    path.join(changeRoot, 'proposal.md'),
    '# 提案：优化项目主页会话卡片展示\n\n## 目标\n\n改进项目主页会话卡片的用户体验。\n\n## 变更范围\n\n1. 时间戳格式改为距今时间\n2. 未读状态指示灯\n3. 右键菜单显示文字\n',
    'utf8',
  );

  await fs.writeFile(
    path.join(changeRoot, 'design.md'),
    '# 设计：优化项目主页会话卡片展示\n\n## 时间戳\n\n- 复用 `formatTimeAgo` 函数\n\n## 未读状态指示灯\n\n- 复用 `SidebarSessionItem.tsx` 中的 localStorage 签名机制\n\n## 右键菜单文字\n\n- 修改 `SessionActionIconMenu.tsx`\n',
    'utf8',
  );

  await fs.writeFile(
    path.join(changeRoot, 'tasks.md'),
    '# 任务清单\n\n- [ ] 修改 `SessionActionIconMenu.tsx`\n- [ ] 修改 `ProjectOverviewPanel.tsx`\n',
    'utf8',
  );
}

test('creating a workflow with existing OpenSpec change binds correctly', async ({ page }) => {
  test.setTimeout(60000);
  const projectRoutePrefix = buildExpectedProjectRoutePrefix();
  await openFixtureProject(page);

  // Prepare OpenSpec change AFTER fixture reset in openFixtureProject
  await prepareOpenSpecChange();

  // Click "新建工作流" button in the ProjectOverviewPanel
  await page.getByRole('button', { name: '新建工作流' }).click();

  // Wait for the composer form to appear
  await expect(page.getByText('接手已有 OpenSpec')).toBeVisible();

  // Fill in title and objective
  await page.locator('input[placeholder="例如：支持讨论优先的自动工作流"]').fill('会话卡片展示优化');
  await page.locator('textarea[placeholder="写清楚要解决的问题、预期行为和验收条件"]').fill(
    '将项目主页会话卡片的时间戳改成和左侧导航栏一样的距今时间，并显示状态指示灯，用于区分已读和未读消息，另外，会话卡片右键菜单除了icon还要补充简短的文字描述',
  );

  // Select the prepared OpenSpec change
  await page.getByLabel('接手已有 OpenSpec').selectOption(OPEN_SPEC_CHANGE_NAME);

  // Create workflow
  await page.getByRole('button', { name: '创建工作流' }).click();

  // Verify navigation to workflow detail page
  await expect(page).toHaveURL(new RegExp(`${projectRoutePrefix}/w\\d+$`));
  await expect(page.getByTestId('workflow-stage-tree')).toBeVisible();
  await expect(page.getByTestId('project-workflow-group')).toContainText('会话卡片展示优化');

  // Verify the workflow stage tree shows the Go runner-controlled execution stage.
  await expect(page.getByTestId('workflow-stage-planning')).toBeVisible();
  await expect(page.getByTestId('workflow-stage-execution')).toBeVisible();
  await expect(page.getByText(/Go runner: playwright-run-/)).toBeVisible();
  await expect(page.getByText('阶段: review_1')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('reviewer.log')).toBeVisible();

  // Verify via API that the workflow is bound to the OpenSpec change
  const project = await getFixtureProject(page.context().request);
  const workflowMatch = page.url().match(/w(\d+)$/);
  const workflowId = workflowMatch ? `w${workflowMatch[1]}` : '';

  const workflowResponse = await page.context().request.get(
    `/api/projects/${project.name}/workflows/${workflowId}`,
    { headers: authHeaders() },
  );
  expect(workflowResponse.ok()).toBe(true);
  const workflow = await workflowResponse.json();
  expect(workflow.openspecChangeName).toBe(OPEN_SPEC_CHANGE_NAME);
  expect(workflow.adoptsExistingOpenSpec).toBe(true);
  expect(workflow.openspecChangeDetected).toBe(true);
  expect(workflow.runner).toBe('go');
  expect(workflow.runnerProvider).toBe('codex');
  expect(workflow.runId).toMatch(/^playwright-run-/);
  expect(workflow.stageStatuses.some((stage) => stage.key === 'review_1' && stage.status === 'active')).toBe(true);
  expect(workflow.artifacts.some((artifact) => artifact.relativePath?.includes('/logs/executor.log'))).toBe(true);
  expect(workflow.artifacts.some((artifact) => artifact.relativePath?.includes('/logs/reviewer.log'))).toBe(true);
});
