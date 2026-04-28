/**
 * PURPOSE: Verify the main shell tab opens a fresh plain terminal and can be disconnected/reconnected.
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
  }, AUTH_TOKEN);
});

/**
 * Click the first visible button whose text matches the provided pattern.
 *
 * @param {import('@playwright/test').Page} page
 * @param {RegExp} pattern
 */
async function clickVisibleButton(page, pattern) {
  await page.waitForFunction(
    (source) => {
      const matcher = new RegExp(source, 'i');
      return Array.from(document.querySelectorAll('button')).some((node) => {
        const text = (node.textContent || '').trim();
        return matcher.test(text) && node.offsetParent !== null;
      });
    },
    pattern.source,
    { timeout: 20_000 },
  );

  await page.evaluate((source) => {
    const matcher = new RegExp(source, 'i');
    const button = Array.from(document.querySelectorAll('button')).find((node) => {
      const text = (node.textContent || '').trim();
      return matcher.test(text) && node.offsetParent !== null;
    });

    if (!button) {
      throw new Error(`visible button not found: ${source}`);
    }

    button.click();
  }, pattern.source);
}

/**
 * Open the target project so the shell tab can be exercised against a stable workspace.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openShellProject(page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await clickVisibleButton(page, /fixture-project|ccflow/);
  await expect(page.getByRole('button', { name: /^Shell$|^终端$/ })).toBeVisible({ timeout: 10_000 });
}

test('shell tab uses plain shell controls and supports disconnect/reconnect', async ({ page }) => {
  await openShellProject(page);

  await clickVisibleButton(page, /^Shell$|^终端$/);

  await expect(page.locator('.xterm')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('body')).toContainText(/New Session|新会话/, { timeout: 10_000 });
  await expect(page.locator('body')).not.toContainText(/Resume session|恢复会话/);

  await clickVisibleButton(page, /^Disconnect$|^断开连接$/);

  await expect(page.locator('body')).toContainText(/Continue in Shell|在 Shell 中继续/, { timeout: 10_000 });
  await clickVisibleButton(page, /^Continue in Shell$|^在 Shell 中继续$/);

  await expect(page.locator('body')).toContainText(/Disconnect|断开连接/, { timeout: 10_000 });
});
