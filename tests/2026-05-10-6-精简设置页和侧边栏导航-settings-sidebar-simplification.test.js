/**
 * PURPOSE: Browser acceptance coverage for the simplified settings page and sidebar.
 */
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_AUTH_DB } from './e2e/helpers/playwright-fixture.js';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../server/middleware/auth.js'),
  import('../server/database/db.js'),
]);

function createLocalAuthToken() {
  /**
   * Build an auth token for the isolated Playwright user.
   */
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }
  return generateToken(user);
}

const AUTH_TOKEN = createLocalAuthToken();

test.beforeEach(async ({ page }) => {
  await page.route('/api/cli/opencode/status', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        provider: 'anthropic',
        providers: [{ name: 'anthropic', connected: true, source: 'fake' }],
      }),
    });
  });
  await page.route('/api/diagnostics/runtime-dependencies', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        path: '/usr/bin',
        commands: {
          oz: { name: 'oz', path: '/usr/bin/oz', command_path: '/usr/bin/oz', version: { ok: true, output: 'oz-test' }, contract: { ok: true, capabilities: ['proposal'] } },
          wo: { name: 'wo', path: '/usr/bin/wo', command_path: '/usr/bin/wo', home: '/tmp/wo', version: { ok: true, output: 'wo-test' }, contract: { ok: true, capabilities: ['run'] } },
          co: { name: 'co', path: '/usr/bin/co', command_path: '/usr/bin/co', home: '/tmp/co', version: { ok: true, output: 'co-test' }, contract: { ok: true, capabilities: ['opencode'] } },
        },
      }),
    });
  });
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
    window.localStorage.setItem('userLanguage', 'zh-CN');
  }, AUTH_TOKEN);
});

test('settings only exposes appearance agents diagnostics and shows OpenCode provider state', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /设置|Settings/ }).first().click();

  await expect(page.getByRole('tab', { name: '外观' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '智能体' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '诊断' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Git' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /API|令牌/ })).toHaveCount(0);

  await expect(page.getByText('项目排序')).toHaveCount(0);
  await expect(page.getByText('代码编辑器')).toHaveCount(0);

  await page.getByRole('tab', { name: '智能体' }).click();
  await expect(page.getByText('MCP 服务器')).toHaveCount(0);
  await page.getByRole('button', { name: /OpenCode/ }).click();
  await expect(page.getByText(/anthropic/)).toBeVisible();
});

test('OpenCode status failure shows backend error instead of available no-provider copy', async ({ page }) => {
  await page.unroute('/api/cli/opencode/status');
  await page.route('/api/cli/opencode/status', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: false,
        providers: [],
        error: 'opencode missing from service PATH',
      }),
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /设置|Settings/ }).first().click();
  await page.getByRole('tab', { name: '智能体' }).click();
  await page.getByRole('button', { name: /OpenCode/ }).click();

  await expect(page.getByText('错误：opencode missing from service PATH').first()).toBeVisible();
  await expect(page.getByText('OpenCode 可用，尚未连接 provider')).toHaveCount(0);
});

test('OpenCode available without connected providers keeps the no-provider copy', async ({ page }) => {
  await page.unroute('/api/cli/opencode/status');
  await page.route('/api/cli/opencode/status', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: false,
        providers: [{ name: 'anthropic', connected: false, source: 'fake' }],
      }),
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /设置|Settings/ }).first().click();
  await page.getByRole('tab', { name: '智能体' }).click();
  await page.getByRole('button', { name: /OpenCode/ }).click();

  await expect(page.getByText('OpenCode 可用，尚未连接 provider')).toBeVisible();
});

test('diagnostics uses Chinese labels and sidebar actions live in the footer', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  const sidebarHeader = page.locator('.nav-divider').first().locator('..');
  await expect(sidebarHeader.getByRole('button')).toHaveCount(0);
  await expect(page.getByTitle('搜索项目...')).toHaveCount(0);
  await expect(page.locator('input[placeholder="搜索项目..."]')).toHaveCount(0);
  await expect(page.getByTestId('open-chat-history-search').first()).toBeVisible();

  await page.getByRole('button', { name: /设置|Settings/ }).first().click();
  await page.getByRole('tab', { name: '诊断' }).click();
  await expect(page.getByText('运行诊断')).toBeVisible();
  await expect(page.getByText('整体状态')).toBeVisible();
  await expect(page.getByText('命令路径').first()).toBeVisible();
  await expect(page.getByText('运行目录').first()).toBeVisible();
  await expect(page.getByText('版本').first()).toBeVisible();
  await expect(page.getByText('契约能力').first()).toBeVisible();
});
