// @ts-nocheck -- Playwright fixture helpers are intentionally kept loose.
/**
 * PURPOSE: Browser acceptance coverage for OpenCode follow-up user bubbles.
 * The test uses fake co through the real UI, WebSocket, request-file, and
 * durable reload path so repeated sends cannot be hidden by transcript dedupe.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  authenticatePage,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';
import { getProjectLocalConfigPath } from '../../server/project-config-store.ts';

async function setFakeCoOpenCodeAvailable(value) {
  /**
   * Switch fake co OpenCode availability before the browser opens a session.
   */
  const coHome = path.join(process.cwd(), '.tmp', 'playwright-co-home');
  await fs.mkdir(coHome, { recursive: true });
  await fs.writeFile(path.join(coHome, 'opencode-available'), value ? 'true' : 'false', 'utf8');
}

async function openNewOpenCodeSession(page) {
  /**
   * Start a manual OpenCode cN session through the same controls users click.
   */
  page.once('dialog', async (dialog) => {
    await dialog.accept('opencode followup bubble acceptance');
  });
  await page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: /新建会话|New Session/i }).click();
  await page.getByTestId('project-new-session-provider-opencode').click();
  await expect(page.locator('textarea').first()).toBeVisible();
}

async function sendPrompt(page, marker) {
  /**
   * Submit one prompt and wait until fake co writes the assistant response.
   */
  const chatContainer = page.locator('[data-testid="chat-scroll-container"]').last();
  const composerInput = page.getByRole('textbox', { name: /Type your message/i });
  const composerForm = composerInput.locator('xpath=ancestor::form[1]');

  await composerInput.fill(marker);
  await expect(composerForm.locator('button[type="submit"]')).toBeEnabled();
  await composerForm.evaluate((form) => form.requestSubmit());
  await expect(chatContainer).toContainText(marker);
  await expect(chatContainer.getByText(`fake co response: ${marker}`).last()).toBeVisible({ timeout: 20_000 });
  return chatContainer;
}

async function expectRepeatedTurnCounts(chatContainer, marker) {
  /**
   * Verify both repeated user sends and both durable assistant replies render.
   */
  await expect(chatContainer.getByText(marker, { exact: true })).toHaveCount(2);
  await expect(chatContainer.getByText(`fake co response: ${marker}`, { exact: true })).toHaveCount(2);
}

function getCurrentRouteIndex(page) {
  /**
   * Extract the current project cN route index from the browser URL.
   */
  const matched = page.url().match(/\/c(\d+)(?:[?#].*)?$/);
  if (!matched) {
    throw new Error(`Expected a project conversation route, got ${page.url()}`);
  }
  return matched[1];
}

async function readProjectConfig() {
  /**
   * Read the fixture project config so reload waits for persisted route state.
   */
  const configPath = getProjectLocalConfigPath(PRIMARY_FIXTURE_PROJECT_PATH);
  return JSON.parse(await fs.readFile(configPath, 'utf8'));
}

async function waitForDraftStart(page) {
  /**
   * Wait until the first OpenCode submit has claimed and persisted the cN route.
   */
  const routeIndex = getCurrentRouteIndex(page);
  await expect.poll(async () => {
    const config = await readProjectConfig();
    const record = config?.chat?.[routeIndex];
    return Boolean(record?.startRequestId || record?.sessionId);
  }, { timeout: 10_000 }).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await setFakeCoOpenCodeAvailable(true);
  await authenticatePage(page);
  await openFixtureProject(page);
});

test('OpenCode repeated follow-up user bubbles survive durable reload', async ({ page }) => {
  test.setTimeout(60_000);
  await openNewOpenCodeSession(page);

  const marker = 'opencode repeated followup bubble';
  const chatContainer = await sendPrompt(page, marker);
  await waitForDraftStart(page);
  await sendPrompt(page, marker);
  await expectRepeatedTurnCounts(chatContainer, marker);

  const conversationUrl = page.url();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(conversationUrl);
  await expect(page.getByRole('textbox', { name: /Type your message/i })).toBeVisible();

  const reloadedChat = page.locator('[data-testid="chat-scroll-container"]').last();
  await expectRepeatedTurnCounts(reloadedChat, marker);
});
