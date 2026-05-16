/**
 * PURPOSE: Verify wo v1 batch workflow grouping stays read-only while child
 * runs remain navigable from the project overview.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { resolveWoBatchesRoot, resolveWoRunsRoot } from '../../server/domains/workflows/wo-runtime-paths.ts';
import {
  authenticatePage,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';
import { ensurePlaywrightFixture } from '../e2e/helpers/playwright-fixture.ts';

async function writeBatchState() {
  /**
   * PURPOSE: Build the real wo v1 batch state shape where run_ids is a
   * change-name keyed object and current_index is zero-based.
   */
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  const batchDir = path.join(resolveWoBatchesRoot(PRIMARY_FIXTURE_PROJECT_PATH), 'batch-fixture');
  await fs.mkdir(batchDir, { recursive: true });
  await fs.writeFile(path.join(batchDir, 'state.json'), `${JSON.stringify({
    batch_id: 'batch-fixture',
    status: 'running',
    current_index: 0,
    changes: ['登录升级'],
    run_ids: {
      '登录升级': 'run-fixture',
    },
    error: '',
  }, null, 2)}\n`, 'utf8');
}

async function writeSessionsOnlyWorkflowState() {
  /**
   * PURPOSE: Model a workflow-owned session that is only present in wo
   * state.sessions, proving it is excluded from manual session lists.
   */
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  const runDir = path.join(resolveWoRunsRoot(PRIMARY_FIXTURE_PROJECT_PATH), 'run-sessions-only');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    run_id: 'run-sessions-only',
    change_name: 'sessions-only-filter',
    status: 'running',
    stage: 'execution',
    stages: {
      execution: 'running',
    },
    sessions: {
      'codex:executor': 'fixture-project-manual-session',
    },
    paths: {},
    error: '',
  }, null, 2)}\n`, 'utf8');
}

test.describe('wo batch readonly workflows', () => {
  test.beforeEach(async ({ page }) => {
    await authenticatePage(page);
  });

  test('batch group shows display progress and child run click opens detail', async ({ page }) => {
    await writeBatchState();
    await openFixtureProject(page, { reset: false });

    const batchGroup = page.getByTestId('batch-group-batch-fixture');
    await expect(batchGroup).toBeVisible();
    await expect(batchGroup.getByTestId('batch-header-batch-fixture')).toContainText('批量任务 b1');
    await expect(batchGroup.getByTestId('batch-header-batch-fixture')).toContainText('1/1');
    await expect(batchGroup.getByRole('button', { name: /登录升级/ })).toBeVisible();

    await batchGroup.getByRole('button', { name: /登录升级/ }).click();
    await expect(page).toHaveURL(/\/runs\/run-fixture$/);
    await expect(page.getByTestId('workflow-role-summary')).toBeVisible();

    await page.getByTestId('workflow-role-row-executor').getByRole('button', { name: 'SUMMARY.md' }).click();
    await expect(page.getByText('Workflow summary fixture')).toBeVisible();
  });

  test('sessions only present in wo state sessions are hidden from manual sessions', async ({ page }) => {
    await writeSessionsOnlyWorkflowState();
    await openFixtureProject(page, { reset: false });

    await expect(page.getByTestId('project-overview-manual-sessions')).not.toContainText(
      'fixture-project manual-only session',
    );
  });
});
