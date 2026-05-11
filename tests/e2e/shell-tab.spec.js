/**
 * PURPOSE: Verify the main shell tab opens an embedded plain terminal without duplicate shell controls.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(process.env.HOME || '', '.ccflow', 'auth.db');

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../server/middleware/auth.js'),
  import('../../server/database/db.js'),
]);

/**
 * Build a valid local auth token for the first active user.
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
    window.localStorage.removeItem('ccflow:workspace-layout:v1');
    window.localStorage.removeItem('activeTab');
  }, AUTH_TOKEN);
});

/**
 * Open the target project so the shell tab can be exercised against a stable workspace.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openShellProject(page) {
  await page.goto('/workspace/fixture-project', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /^Shell$|^终端$/ })).toBeVisible({ timeout: 10_000 });
}

test('shell tab uses embedded plain shell without disconnect or restart controls', async ({ page }) => {
  await openShellProject(page);

  const bottomDock = page.locator('[data-testid="dock-panel-bottom"]');
  if (!(await bottomDock.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^Shell$|^终端$/ }).click();
  }

  await expect(bottomDock).toBeVisible({ timeout: 10_000 });
  await expect(bottomDock.locator('.xterm')).toBeVisible({ timeout: 10_000 });
  await expect(bottomDock).not.toContainText(/Resume session|恢复会话/);
  await expect(bottomDock).not.toContainText(/Disconnect|断开连接|Restart|重启/);

  await bottomDock.getByRole('button', { name: '新建终端' }).click();
  await expect(bottomDock.locator('[data-testid="terminal-instance"]')).toHaveCount(2);
});
