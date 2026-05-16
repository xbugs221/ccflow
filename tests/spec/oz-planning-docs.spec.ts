// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: 验收测试：规阶段展示 oz change 四个核心文档链接并可点击打开。
 * 覆盖 active change、无规划会话、归档后刷新场景，验证文档内容和路径正确性。
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  authenticatePage,
  openFixtureProject,
} from './helpers/spec-test-helpers.ts';
import { PLAYWRIGHT_FIXTURE_PROJECT_PATHS } from '../e2e/helpers/playwright-fixture.ts';
import { resolveWoRunStatePath } from '../../server/domains/workflows/wo-runtime-paths.ts';

const OZ_CHANGE_NAME = '2026-05-14-test-planning-docs';

const ACTIVE_PROPOSAL = '# 提案\n\nACTIVE 测试提案内容。\n';
const ACTIVE_DESIGN = '# 设计\n\nACTIVE 测试设计内容。\n';
const ACTIVE_SPEC = '# 规格\n\nACTIVE 测试规格内容。\n';
const ACTIVE_TASK = '# 任务\n\nACTIVE 测试任务内容。\n';
const ARCHIVE_PROPOSAL = '# 提案\n\nARCHIVE 测试提案内容。\n';

/**
 * Create active oz change docs in the fixture project.
 */
function writeActiveOzChangeDocs() {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const changeDir = path.join(projectPath, 'docs', 'changes', OZ_CHANGE_NAME);
  fs.mkdirSync(changeDir, { recursive: true });

  fs.writeFileSync(path.join(changeDir, 'proposal.md'), ACTIVE_PROPOSAL, 'utf8');
  fs.writeFileSync(path.join(changeDir, 'design.md'), ACTIVE_DESIGN, 'utf8');
  fs.writeFileSync(path.join(changeDir, 'spec.md'), ACTIVE_SPEC, 'utf8');
  fs.writeFileSync(path.join(changeDir, 'task.md'), ACTIVE_TASK, 'utf8');
}

/**
 * Write a wo state fixture with change_name and a planning session.
 */
function writeActivePlanningWorkflowFixture() {
  writeWorkflowFixture({ withSession: true });
}

/**
 * Write a wo state fixture with change_name but NO planning session.
 */
function writeActivePlanningWorkflowFixtureNoSession() {
  writeWorkflowFixture({ withSession: false });
}

function writeWorkflowFixture({ withSession }) {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const statePath = resolveWoRunStatePath(projectPath, 'run-fixture');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const baseState = {
    ...state,
    change_name: OZ_CHANGE_NAME,
    status: 'running',
    stage: 'planning',
    stages: { planning: 'active', execution: 'pending' },
  };
  if (withSession) {
    baseState.sessions = { ...baseState.sessions, 'codex:planning': 'planning-session-id' };
  } else {
    // Remove planning session key explicitly so there is no jump-able session link
    if (baseState.sessions) {
      delete baseState.sessions['codex:planning'];
    }
  }
  fs.writeFileSync(statePath, `${JSON.stringify(baseState, null, 2)}\n`, 'utf8');
}

/**
 * Move active oz change to archive, overwrite proposal.md with archive content,
 * and update the wo state.
 */
function archiveOzChangeAndRefreshWorkflow() {
  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const activeDir = path.join(projectPath, 'docs', 'changes', OZ_CHANGE_NAME);
  const archiveDir = path.join(projectPath, 'docs', 'changes', 'archive', OZ_CHANGE_NAME);
  fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
  fs.renameSync(activeDir, archiveDir);

  // Overwrite proposal.md with archive-specific content so tests can verify
  // the archived file is opened, not a stale active-path reference.
  fs.writeFileSync(path.join(archiveDir, 'proposal.md'), ARCHIVE_PROPOSAL, 'utf8');

  // Update the wo state so the backend re-reads after refresh
  const statePath = resolveWoRunStatePath(projectPath, 'run-fixture');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Navigate from the project overview into the workflow detail page.
 * After setting change_name, the workflow card title becomes OZ_CHANGE_NAME.
 */
async function navigateToWorkflowDetail(page) {
  const workflowsPanel = page.getByTestId('project-overview-workflows');
  const workflowCard = workflowsPanel.getByRole('button', { name: OZ_CHANGE_NAME }).first();
  if (await workflowCard.count() === 0) {
    await workflowsPanel.getByRole('button', { name: /自动工作流/ }).click();
  }
  await workflowCard.click();
}

/**
 * Open the workflow detail page for the fixture run (active change, with session).
 */
async function openWorkflowDetailPage(page) {
  await authenticatePage(page);
  await openFixtureProject(page);

  writeActiveOzChangeDocs();
  writeActivePlanningWorkflowFixture();
  await page.reload({ waitUntil: 'networkidle' });

  await navigateToWorkflowDetail(page);
}

/**
 * Open the workflow detail page for the fixture run (active change, NO session).
 */
async function openWorkflowDetailPageNoSession(page) {
  await authenticatePage(page);
  await openFixtureProject(page);

  writeActiveOzChangeDocs();
  writeActivePlanningWorkflowFixtureNoSession();
  await page.reload({ waitUntil: 'networkidle' });

  await navigateToWorkflowDetail(page);
}

test.describe('规阶段 oz 文档链接', () => {
  test('active change 下规行展示四个文档链接并可点击打开 proposal.md', async ({ page }) => {
    test.setTimeout(60000);
    await openWorkflowDetailPage(page);

    const planningRow = page.getByTestId('workflow-role-row-planning');
    await expect(planningRow).toBeVisible();
    await expect(planningRow).toContainText('规');

    const proposalBtn = planningRow.getByRole('button', { name: 'proposal.md' });
    const designBtn = planningRow.getByRole('button', { name: 'design.md' });
    const specBtn = planningRow.getByRole('button', { name: 'spec.md' });
    const taskBtn = planningRow.getByRole('button', { name: 'task.md' });

    await expect(proposalBtn).toBeVisible();
    await expect(designBtn).toBeVisible();
    await expect(specBtn).toBeVisible();
    await expect(taskBtn).toBeVisible();

    // Click proposal.md and verify editor opens with correct active content
    await proposalBtn.click();
    await expect(page.getByRole('heading', { name: 'proposal.md' })).toBeVisible();
    await expect(page.getByText('ACTIVE 测试提案内容')).toBeVisible();
  });

  test('规划会话缺失时仍展示文档链接并可打开文档', async ({ page }) => {
    test.setTimeout(60000);
    await openWorkflowDetailPageNoSession(page);

    const planningRow = page.getByTestId('workflow-role-row-planning');
    await expect(planningRow).toBeVisible();

    // No session link when planning session is absent
    await expect(planningRow.getByRole('button', { name: '会话' })).toHaveCount(0);

    // Document links must still be present and clickable
    const proposalBtn = planningRow.getByRole('button', { name: 'proposal.md' });
    await expect(proposalBtn).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'design.md' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'spec.md' })).toBeVisible();
    await expect(planningRow.getByRole('button', { name: 'task.md' })).toBeVisible();

    // Clicking a doc without a planning session must still open the editor
    await proposalBtn.click();
    await expect(page.getByRole('heading', { name: 'proposal.md' })).toBeVisible();
  });

  test('change 归档后刷新详情页四个链接仍指向归档文档', async ({ page }) => {
    test.setTimeout(60000);
    await openWorkflowDetailPage(page);

    // Verify active docs are visible and openable with active content
    const planningRow = page.getByTestId('workflow-role-row-planning');
    await expect(planningRow.getByRole('button', { name: 'proposal.md' })).toBeVisible();

    await planningRow.getByRole('button', { name: 'proposal.md' }).click();
    await expect(page.getByText('ACTIVE 测试提案内容')).toBeVisible();

    // Archive the change (renames dir to archive + overwrites proposal.md with archive content)
    archiveOzChangeAndRefreshWorkflow();
    // Reload stays on the detail page — docs are already visible there after refresh
    await page.reload({ waitUntil: 'networkidle' });

    // After archive + reload, planning docs must still be visible on the current detail page
    const archivedPlanningRow = page.getByTestId('workflow-role-row-planning');
    await expect(archivedPlanningRow.getByRole('button', { name: 'proposal.md' })).toBeVisible();
    await expect(archivedPlanningRow.getByRole('button', { name: 'design.md' })).toBeVisible();
    await expect(archivedPlanningRow.getByRole('button', { name: 'spec.md' })).toBeVisible();
    await expect(archivedPlanningRow.getByRole('button', { name: 'task.md' })).toBeVisible();

    // Click proposal.md - must open the archived file with archive-specific content
    await archivedPlanningRow.getByRole('button', { name: 'proposal.md' }).click();
    await expect(page.getByRole('heading', { name: 'proposal.md' })).toBeVisible();
    await expect(page.getByText('ARCHIVE 测试提案内容')).toBeVisible();
    // Active content must NOT be shown (proves we are reading from archive, not stale active path)
    await expect(page.getByText('ACTIVE 测试提案内容')).toHaveCount(0);
  });
});
