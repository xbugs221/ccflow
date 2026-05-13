/**
 * PURPOSE: Verify settings UI reads OpenCode provider state through the real
 * backend status endpoint and the service process PATH.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticatePage } from './spec/helpers/spec-test-helpers.js';

const MODE_FILE = path.join(process.cwd(), '.tmp', 'playwright-opencode-mode');

async function setFakeOpenCodeMode(mode) {
  /**
   * Switch the fake opencode behavior used by the already running test server.
   */
  await fs.mkdir(path.dirname(MODE_FILE), { recursive: true });
  await fs.writeFile(MODE_FILE, mode, 'utf8');
}

async function openOpenCodeSettings(page) {
  /**
   * Navigate through the real settings UI to the OpenCode agent panel.
   */
  await authenticatePage(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('userLanguage', 'zh-CN');
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /设置|Settings/ }).first().click();
  await page.getByRole('tab', { name: '智能体' }).click();
  await page.getByRole('button', { name: /OpenCode/ }).click();
}

test('settings shows OpenCode providers and API metadata from service PATH fake CLI', async ({ page }) => {
  await setFakeOpenCodeMode('providers');
  await openOpenCodeSettings(page);

  await expect(page.getByText('DeepSeek', { exact: true })).toBeVisible();
  await expect(page.getByText('Kimi For Coding', { exact: true })).toBeVisible();
  await expect(page.getByText('API').first()).toBeVisible();
  await expect(page.getByText('已断开')).toHaveCount(0);
});

test('settings shows OpenCode available without bound providers', async ({ page }) => {
  await setFakeOpenCodeMode('empty');
  await openOpenCodeSettings(page);

  await expect(page.getByText('OpenCode 可用，尚未绑定 provider').first()).toBeVisible();
  await expect(page.getByText('已断开')).toHaveCount(0);
});

test('settings shows provider read failure without reporting CLI disconnected', async ({ page }) => {
  await setFakeOpenCodeMode('fail');
  await openOpenCodeSettings(page);

  await expect(page.getByText('OpenCode 可用，provider 状态读取失败')).toBeVisible();
  await expect(page.getByText('OpenCode 可用，尚未绑定 provider')).toHaveCount(0);
  await expect(page.getByText(/failed to read opencode auth list/).first()).toBeVisible();
  await expect(page.getByText('已断开')).toHaveCount(0);
});
