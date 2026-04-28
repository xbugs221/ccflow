/**
 * PURPOSE: Acceptance tests for Claude-compatible thinking mode persistence.
 * Covers Kimi/Claude provider sessions where users expect the selected depth to survive refreshes.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  authenticatePage,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.js';

test.beforeEach(async ({ page }) => {
  await authenticatePage(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('selected-provider', 'claude');
  });
});

/**
 * Open a real fixture Claude session so the composer controls are mounted.
 */
async function openClaudeSession(page) {
  await openFixtureProject(page);
  await page.getByRole('button', { name: /fixture-project manual-only session/ }).first().click();
  await expect(page.locator('textarea')).toBeVisible();
}

/**
 * Select a Claude-compatible thinking mode through the same control users click.
 */
async function selectThinkingMode(page, mode) {
  await page.getByTestId('session-model-controls-trigger').click();
  await page.getByTestId('session-model-controls-depth').selectOption(mode);
}

/**
 * Read the project-local session state written by the shared model-state API.
 */
async function readPersistedThinkingMode(sessionId) {
  const configPath = path.join(PRIMARY_FIXTURE_PROJECT_PATH, '.ccflow', 'conf.json');
  const rawConfig = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(rawConfig);
  const records = Object.values(config.chat || {});
  const record = records.find((entry) => entry?.sessionId === sessionId);
  return record?.thinkingMode || '';
}

test('Claude-compatible thinking depth persists to project config and survives refresh', async ({ page }) => {
  /** Scenario: 用户给 Kimi/Claude 兼容会话选择 High 后，项目 conf.json 落盘；刷新和跨设备读取都继续使用 High。 */
  const sessionId = 'fixture-project-manual-session';

  await openClaudeSession(page);
  await selectThinkingMode(page, 'high');

  await expect.poll(
    () => readPersistedThinkingMode(sessionId),
  ).toBe('high');

  await page.reload({ waitUntil: 'networkidle' });

  await page.getByTestId('session-model-controls-trigger').click();
  await expect(page.getByTestId('session-model-controls-depth')).toHaveValue('high');
});
