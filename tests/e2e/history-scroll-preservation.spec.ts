// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify browsing older history does not snap back to the latest tail
 * when the underlying session file receives an external update.
 */
import fs from 'node:fs';
import path from 'node:path';

import { test, expect } from '@playwright/test';
import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
  PLAYWRIGHT_FIXTURE_HOME,
  PLAYWRIGHT_FIXTURE_PROJECT_PATHS,
  PLAYWRIGHT_FIXTURE_SESSION_IDS,
} from './helpers/playwright-fixture.ts';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../server/middleware/auth.ts'),
  import('../../server/database/db.ts'),
]);

const HISTORY_SCROLL_PROJECT_INDEX = 5;
const HISTORY_SCROLL_SESSION_ID = PLAYWRIGHT_FIXTURE_SESSION_IDS[HISTORY_SCROLL_PROJECT_INDEX];
const HISTORY_SCROLL_PROJECT_PATH = PLAYWRIGHT_FIXTURE_PROJECT_PATHS[HISTORY_SCROLL_PROJECT_INDEX];

/**
 * Encode a project path the same way project API routes address project roots.
 *
 * @param {string} projectPath
 * @returns {string}
 */
function encodeClaudeProjectName(projectPath) {
  return projectPath.replace(/\//g, '-');
}

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

/**
 * Append a new assistant message to the fixture session file to trigger `projects_updated`.
 */
function appendAssistantHistoryMessage() {
  const sessionDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.codex',
    'sessions',
    '2026',
    '04',
    '19',
  );
  const sessionPath = path.join(sessionDir, `${HISTORY_SCROLL_SESSION_ID}.jsonl`);

  fs.appendFileSync(
    sessionPath,
    `${JSON.stringify({
      type: 'response_item',
      timestamp: '2026-03-28T16:40:00.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'history scroll externally appended assistant turn' }],
      },
    })}\n`,
    'utf8',
  );
}

const AUTH_TOKEN = createLocalAuthToken();

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
  }, AUTH_TOKEN);
});

test('opening a history session starts at the latest messages', async ({ page }) => {
  await page.goto(`/session/${HISTORY_SCROLL_SESSION_ID}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

  const scrollContainer = page.getByTestId('chat-scroll-container');
  await expect
    .poll(async () => scrollContainer.evaluate(
      (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
    ))
    .toBeLessThanOrEqual(4);
});

test('opening a long history session does not silently load the full transcript', async ({ page }) => {
  const messageRequests = [];
  await page.route(/\/api\/(?:projects\/.*\/sessions|codex\/sessions)\/.*\/messages.*/, async (route) => {
    messageRequests.push(route.request().url());
    await route.continue();
  });

  await page.goto(`/session/${HISTORY_SCROLL_SESSION_ID}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

  const unboundedRequests = messageRequests.filter((url) => {
    const parsedUrl = new URL(url);
    return !parsedUrl.searchParams.has('limit') && !parsedUrl.searchParams.has('afterLine');
  });

  expect(unboundedRequests).toEqual([]);
  expect(messageRequests.some((url) => new URL(url).searchParams.get('limit') === '100')).toBe(true);
});

test('scrolling up through history loads older messages', async ({ page }) => {
  await page.goto(`/session/${HISTORY_SCROLL_SESSION_ID}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');

  const scrollContainer = page.getByTestId('chat-scroll-container');
  await scrollContainer.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });

  // After scrolling up, earlier content should be visible alongside the latest
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 03');
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 12');
});

// This test appends to the fixture file, so it must run after the scroll test above.
test('afterLine API returns only new messages appended after the known count', async ({ request }) => {
  const projectName = encodeClaudeProjectName(HISTORY_SCROLL_PROJECT_PATH);

  // Fetch initial total
  const initialResp = await request.get(
    `/api/projects/${projectName}/sessions/${HISTORY_SCROLL_SESSION_ID}/messages?limit=100&offset=0`,
    { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
  );
  const initial = await initialResp.json();
  const knownTotal = initial.total;

  appendAssistantHistoryMessage();

  // Use afterLine to fetch only new messages
  const incrResp = await request.get(
    `/api/projects/${projectName}/sessions/${HISTORY_SCROLL_SESSION_ID}/messages?afterLine=${knownTotal}`,
    { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
  );
  const incremental = await incrResp.json();

  expect(incremental.total).toBe(knownTotal + 1);
  expect(incremental.messages).toHaveLength(1);
  expect(incremental.messages[0].message.content).toBe('history scroll externally appended assistant turn');
});
