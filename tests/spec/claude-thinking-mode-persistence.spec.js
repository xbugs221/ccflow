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

/**
 * Remove provider metadata from the fixture Claude session while keeping it in the Claude session list.
 */
async function serveLegacyClaudeSessionWithoutProvider(page, sessionId) {
  await page.route('**/api/projects', async (route) => {
    const response = await route.fetch();
    const projects = await response.json();
    const nextProjects = projects.map((project) => ({
      ...project,
      sessions: (project.sessions || []).map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        const { __provider, ...legacySession } = session;
        return legacySession;
      }),
    }));

    await route.fulfill({
      response,
      json: nextProjects,
    });
  });
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

test('Claude thinking depth uses inferred provider when session metadata is missing', async ({ page }) => {
  /** Scenario: 旧会话对象没有 __provider，但它仍在项目 Claude sessions 列表中，thinking depth 同步必须按 Claude 处理。 */
  const sessionId = 'fixture-project-manual-session';
  let persistedProvider = '';

  await serveLegacyClaudeSessionWithoutProvider(page, sessionId);
  await page.route('**/api/projects/*/sessions/*/model-state', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      persistedProvider = body?.provider || '';
    }
    await route.continue();
  });

  await openClaudeSession(page);
  await selectThinkingMode(page, 'medium');

  await expect.poll(() => persistedProvider).toBe('claude');
  await expect.poll(
    () => readPersistedThinkingMode(sessionId),
  ).toBe('medium');

  await page.reload({ waitUntil: 'networkidle' });

  await page.getByTestId('session-model-controls-trigger').click();
  await expect(page.getByTestId('session-model-controls-depth')).toHaveValue('medium');
});
