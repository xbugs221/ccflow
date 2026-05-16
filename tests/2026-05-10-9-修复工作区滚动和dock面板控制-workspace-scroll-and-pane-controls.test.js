/**
 * PURPOSE: Verify workspace scroll containers and dock pane controls in a real project workspace.
 * Covers long chat transcripts, project homepage overflow, icon-only tabs, and top-aligned pane controls.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(process.env.HOME || '', '.cbw', 'auth.db');

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../server/middleware/auth.js'),
  import('../server/database/db.js'),
]);

function createLocalAuthToken() {
  /**
   * Create a browser auth token from the local fixture user.
   */
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
    window.localStorage.removeItem('cbw:workspace-layout:v1');
    window.localStorage.removeItem('activeTab');
  }, AUTH_TOKEN);
});

async function openFixtureProject(page) {
  /**
   * Open the real fixture project workspace used by dock layout tests.
   */
  await page.goto('/workspace/fixture-project', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tab-chat"]')).toBeVisible({ timeout: 10_000 });
}

async function openFixtureChat(page) {
  /**
   * Enter a real manual session so the chat transcript and composer are present.
   */
  await openFixtureProject(page);
  const sessionButton = page.locator('button', { hasText: /fixture-project manual-only session/ }).first();
  if (await sessionButton.isVisible().catch(() => false)) {
    await sessionButton.click();
  }
  await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible({ timeout: 10_000 });
}

async function makeScrollable(page, selector) {
  /**
   * Add non-business test filler inside the real scroll owner to force overflow.
   */
  await page.locator(selector).evaluate((container) => {
    const filler = document.createElement('div');
    filler.dataset.testid = 'workspace-scroll-filler';
    filler.style.display = 'block';
    filler.style.flexShrink = '0';
    filler.style.height = '1800px';
    filler.textContent = '滚动验收填充内容';
    container.appendChild(filler);
  });
}

async function expectScrolls(page, selector) {
  /**
   * Scroll the real overflow owner and assert its position changes.
   */
  const locator = page.locator(selector);
  await makeScrollable(page, selector);
  await expect.poll(() => locator.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await locator.evaluate((node) => {
    node.scrollTop = 0;
  });
  await locator.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => locator.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
}

test('chat transcript scrolls while composer stays visible with docks open', async ({ page }) => {
  await openFixtureChat(page);
  await expect(page.locator('[data-testid="dock-panel-bottom"]')).toBeVisible();

  await expectScrolls(page, '[data-testid="chat-scroll-container"]');

  const composer = page.locator('textarea').last();
  await expect(composer).toBeVisible();
  await expect(composer).toBeEditable();
});

test('project overview center scrolls without moving workspace tabs', async ({ page }) => {
  await openFixtureProject(page);
  await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();
  await expect(page.locator('[data-testid="dock-panel-bottom"]')).toBeVisible();

  await expectScrolls(page, '[data-testid="project-workspace-overview"]');

  await expect(page.locator('[data-testid="tab-chat"]')).toBeVisible();
  await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();
});

test('workspace tabs are icon-only but keep accessible names', async ({ page }) => {
  await openFixtureProject(page);

  for (const [tabId, labelPattern] of [
    ['chat', /^(消息|Messages)$/],
    ['shell', /^(终端|Terminal|Shell)$/],
    ['files', /^(文件|Files)$/],
    ['git', /^(源代码管理|Source Control)$/],
  ]) {
    const tab = page.locator(`[data-testid="tab-${tabId}"]`);
    await expect(tab).toHaveAttribute('aria-label', labelPattern);
    await expect(tab).toHaveAttribute('title', labelPattern);
    await expect(tab).toHaveText('');
  }
});

test('dock pane controls are in the pane header and collapse uses top tabs', async ({ page }) => {
  await openFixtureProject(page);

  const bottomDock = page.locator('[data-testid="dock-panel-bottom"]');
  const rightDock = page.locator('[data-testid="dock-panel-right"]');
  await expect(bottomDock.locator('[data-testid="dock-panel-header"] button[title="移动终端"]')).toBeVisible();
  await expect(bottomDock.locator('[data-testid="dock-panel-header"] button[title="全屏"]')).toBeVisible();
  await expect(bottomDock.locator(':scope > button[title="折叠"]')).toHaveCount(0);

  await expect(rightDock.locator('[data-testid="dock-panel-header"] button[title="全屏"]')).toBeVisible();
  await expect(rightDock.locator(':scope > button[title="折叠"]')).toHaveCount(0);

  await page.locator('[data-testid="tab-shell"]').click();
  await page.locator('[data-testid="tab-shell"]').click();
  await expect(bottomDock).not.toBeVisible();
  await page.locator('[data-testid="tab-shell"]').click();
  await expect(bottomDock).toBeVisible();

  await page.locator('[data-testid="tab-files"]').click();
  await page.locator('[data-testid="tab-files"]').click();
  await expect(rightDock).not.toBeVisible();
  await page.locator('[data-testid="tab-files"]').click();
  await expect(rightDock).toBeVisible();
});
