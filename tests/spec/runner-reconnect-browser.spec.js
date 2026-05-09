/**
 * PURPOSE: Browser acceptance test for rendering real runner events after WebSocket reconnect.
 */
import { test, expect } from '@playwright/test';

import {
  authenticatePage,
  openFixtureProject,
} from './helpers/spec-test-helpers.js';

async function openNewProviderSession(page, provider) {
  page.once('dialog', async (dialog) => {
    await dialog.accept(`${provider} reconnect acceptance`);
  });
  await page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: /新建会话|New Session/i }).click();
  await page.getByTestId(`project-new-session-provider-${provider}`).click();
  await expect(page.locator('textarea').first()).toBeVisible();
}

async function sendPromptThenReconnect(page, marker) {
  await page.waitForFunction(() => typeof window.__ccflowTestCloseWebSocket === 'function');
  const chatContainer = page.locator('[data-testid="chat-scroll-container"]').last();
  const fakeResponses = chatContainer.getByText('fake runner response');
  await page.locator('textarea').first().fill(marker);
  await page.locator('form button[type="submit"]').first().click();
  await expect(chatContainer).toContainText(marker);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__ccflowTestCloseWebSocket());
  await expect(fakeResponses.last()).toBeVisible({ timeout: 30_000 });
  await expect(fakeResponses).toHaveCount(1);
  await page.evaluate(() => window.__ccflowTestCloseWebSocket());
  await page.waitForTimeout(3_500);
  await expect(fakeResponses).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await authenticatePage(page);
});

test('Codex and OpenCode runner events render in the real chat after websocket reconnect', async ({ page }) => {
  test.setTimeout(60_000);
  await openFixtureProject(page);

  await openNewProviderSession(page, 'codex');
  await sendPromptThenReconnect(page, 'codex reconnect real runner event');

  await openFixtureProject(page, { reset: false });
  await openNewProviderSession(page, 'opencode');
  await sendPromptThenReconnect(page, 'opencode reconnect real runner event');
});
