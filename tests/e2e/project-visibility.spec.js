/**
 * PURPOSE: Smoke-test project visibility in the browser.
 * Verifies the isolated e2e fixture projects are exposed by the API and rendered in the authenticated shell.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
  PLAYWRIGHT_FIXTURE_HOME,
  PLAYWRIGHT_FIXTURE_PROJECT_PATHS,
  PLAYWRIGHT_FIXTURE_SESSION_IDS,
} from './helpers/playwright-fixture.js';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../server/middleware/auth.js'),
  import('../../server/database/db.js'),
]);

/**
 * Build a valid local auth token for the first active user.
 * This keeps smoke tests independent of hard-coded credentials.
 *
 * @returns {string}
 */
function createLocalAuthToken() {
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }

  return generateToken(user);
}

const AUTH_TOKEN = createLocalAuthToken();

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
  }, AUTH_TOKEN);
});

test('local app loads with authenticated shell', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page).toHaveTitle(/CloudCLI UI/i);
  await expect(page.locator('body')).not.toContainText('Login');
});

test('projects api exposes both fixture project roots', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const payload = await page.evaluate(async (fixtureProjectPath) => {
    const token = window.localStorage.getItem('auth-token');
    const response = await fetch('/api/projects', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await response.json();
    return {
      ok: response.ok,
      status: response.status,
      projectPaths: Array.isArray(data) ? data.map((item) => item.fullPath) : [],
      fixtureProject: Array.isArray(data)
        ? data.find((item) => item.fullPath === fixtureProjectPath) || null
        : null,
    };
  }, PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0]);

  expect(payload.ok).toBeTruthy();
  expect(payload.status).toBe(200);
  expect(payload.projectPaths).toContain(PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0]);
  expect(payload.projectPaths).toContain(PLAYWRIGHT_FIXTURE_PROJECT_PATHS[1]);
  expect(payload.fixtureProject?.sessions?.map((session) => session.summary)).toEqual([
    'fixture-project manual-only session',
  ]);
});

test('sidebar text shows both fixture labels', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).not.toContainText('Loading...');
  await expect(page.locator('body')).toContainText('fixture-project');
  await expect(page.locator('body')).toContainText('.fixture-project');
});

test('worktree session route loads Claude history instead of empty state', async ({ page }) => {
  await page.goto(`/session/${PLAYWRIGHT_FIXTURE_SESSION_IDS[3]}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('matx worktree fixture session');
  await expect(page.locator('body')).not.toContainText('继续您的对话');
});

test('mobile project selection opens session and workflow list in main content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).not.toContainText('Loading...');

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByText('fixture-project', { exact: true }).first().click();
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.getByRole('heading', { name: '手动会话' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '自动工作流' })).toBeVisible();
  await expect(page.getByRole('button', { name: /fixture-project session/ }).first()).toBeVisible();

  const manualSessionPanelOverflow = await page.locator('[data-testid="project-overview-manual-sessions"]').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(manualSessionPanelOverflow.scrollWidth).toBeLessThanOrEqual(manualSessionPanelOverflow.clientWidth + 1);
});

test('manual session order stays pinned to creation time after an older session gets new messages', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();
  await page.getByRole('button', { name: /手动会话/ }).click();

  const manualSessions = page.locator('[data-testid="project-overview-manual-sessions"] .mt-3 > button');
  await expect(manualSessions.nth(0)).toContainText('fixture-project session');
  await expect(manualSessions.nth(1)).toContainText('fixture-project execution fixture session');

  const projectPath = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[0];
  const projectDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.claude',
    'projects',
    projectPath.replace(/\//g, '-'),
  );
  const executionSessionPath = path.join(projectDir, 'fixture-project-execution-session.jsonl');

  fs.appendFileSync(
    executionSessionPath,
    `${JSON.stringify({
      sessionId: 'fixture-project-execution-session',
      cwd: projectPath,
      timestamp: '2026-04-20T18:30:00.000Z',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: 'execution session new follow-up reply',
      },
    })}\n`,
    'utf8',
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();
  await page.getByRole('button', { name: /手动会话/ }).click();

  await expect(manualSessions.nth(0)).toContainText('fixture-project session');
  await expect(manualSessions.nth(1)).toContainText('fixture-project execution fixture session');
});

test('creating a manual session updates the sidebar immediately without a browser reload', async ({ page }) => {
  const sessionLabel = `自动刷新会话-${Date.now()}`;

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept(sessionLabel);
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();

  const manualSessionGroup = page.locator('[data-testid="manual-session-group"]').first();
  await expect(manualSessionGroup).toBeVisible();

  await manualSessionGroup.getByRole('button', { name: /新建/ }).click();

  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+$/);
  await expect(manualSessionGroup.getByRole('button', { name: new RegExp(sessionLabel) }).first()).toBeVisible();
});

test('creating a manual session keeps the default label number aligned with the route number', async ({ page }) => {
  await page.addInitScript(() => {
    window.__lastManualSessionPromptDefault = null;
    window.prompt = (_message, defaultValue = '') => {
      window.__lastManualSessionPromptDefault = String(defaultValue || '');
      return String(defaultValue || '');
    };
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();

  const manualSessionGroup = page.locator('[data-testid="manual-session-group"]').first();
  await expect(manualSessionGroup).toBeVisible();

  await manualSessionGroup.getByRole('button', { name: /新建/ }).click();

  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+$/);

  const routeMatch = page.url().match(/\/c(\d+)$/);
  expect(routeMatch).not.toBeNull();
  const expectedLabel = `会话${routeMatch[1]}`;

  await expect(manualSessionGroup.locator('button').filter({ hasText: expectedLabel }).first()).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__lastManualSessionPromptDefault)).toBe(expectedLabel);
});
