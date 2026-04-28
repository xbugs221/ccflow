/**
 * PURPOSE: Acceptance tests for chat history search regression fixes.
 * Derived from openspec/changes/archive/2026-04-15-11-fix-chat-history-search-regressions/specs/chat-history-full-text-search/spec.md.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.js';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.js';

const CHAT_SEARCH_INPUT = '[data-testid="chat-history-search-input"]';
const CHAT_SEARCH_RESULTS = '[data-testid="chat-history-search-results"]';
const CHAT_SEARCH_RESULT = '[data-testid="chat-history-search-result"]';
const CHAT_SEARCH_LOADING = '[data-testid="chat-history-search-loading"]';
const CHAT_SEARCH_EMPTY = '[data-testid="chat-history-search-empty"]';
const CHAT_SEARCH_ERROR = '[data-testid="chat-history-search-error"]';

/**
 * Encode an absolute project path the same way Claude stores project folders.
 *
 * @param {string} projectPath
 * @returns {string}
 */
function encodeClaudeProjectName(projectPath) {
  return projectPath.replace(/\//g, '-');
}

/**
 * Write one Claude JSONL session file under the Playwright fixture HOME.
 *
 * @param {{ sessionId: string, entries: Array<Record<string, unknown>> }} params
 * @returns {Promise<void>}
 */
async function writeClaudeSession({ sessionId, entries }) {
  const projectDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.claude',
    'projects',
    encodeClaudeProjectName(PRIMARY_FIXTURE_PROJECT_PATH),
  );
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, `${sessionId}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

/**
 * Write one Codex JSONL session file under the Playwright fixture HOME.
 *
 * @param {{ sessionId: string, entries: Array<Record<string, unknown>>, datePath?: string[] }} params
 * @returns {Promise<void>}
 */
async function writeCodexSession({ sessionId, entries, datePath = ['2026', '04', '15'] }) {
  const codexDir = path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', ...datePath);
  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(
    path.join(codexDir, `${sessionId}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

/**
 * Build a minimal Claude transcript with deterministic timestamps.
 *
 * @param {{ sessionId: string, startedAt?: string, messages: Array<{ role: 'user' | 'assistant', content: string }> }} params
 * @returns {Array<Record<string, unknown>>}
 */
function buildClaudeTranscript({ sessionId, startedAt = '2026-04-15T08:00:00.000Z', messages }) {
  const base = new Date(startedAt).getTime();
  return messages.map((message, index) => ({
    sessionId,
    cwd: PRIMARY_FIXTURE_PROJECT_PATH,
    timestamp: new Date(base + index * 1_000).toISOString(),
    parentUuid: index === 0 ? null : `${sessionId}-uuid-${index - 1}`,
    uuid: `${sessionId}-uuid-${index}`,
    type: message.role,
    message: {
      role: message.role,
      content: message.content,
    },
  }));
}

/**
 * Build a minimal Codex transcript that the current parser can read.
 *
 * @param {{ sessionId: string, records: Array<Record<string, unknown>> }} params
 * @returns {Array<Record<string, unknown>>}
 */
function buildCodexTranscript({ sessionId, records }) {
  return [
    {
      timestamp: '2026-04-15T09:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        model: 'gpt-5.5',
      },
    },
    ...records,
  ];
}

/**
 * Run a global chat-history search and return the result rows locator.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} query
 * @returns {Promise<import('@playwright/test').Locator>}
 */
async function runChatSearch(page, query) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator(CHAT_SEARCH_INPUT)).toBeVisible();
  await page.locator(CHAT_SEARCH_INPUT).fill(query);
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');
  return page.locator(CHAT_SEARCH_RESULT);
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('returns a hit when the keyword only exists in the sixth visible Claude session', async ({ page }) => {
  /** Scenario: 关键词仅存在于某项目第六个及之后的 Claude 可见会话 */
  const keyword = 'needle-claude-visible-session-six';

  for (let index = 0; index < 6; index += 1) {
    const sessionId = `claude-search-window-${index}`;
    await writeClaudeSession({
      sessionId,
      entries: buildClaudeTranscript({
        sessionId,
        startedAt: `2026-04-15T08:0${index}:00.000Z`,
        messages: [
          { role: 'user', content: `Session ${index} request.` },
          {
            role: 'assistant',
            content: index === 0
              ? `Only the oldest visible session contains ${keyword}.`
              : `Filler response ${index}.`,
          },
        ],
      }),
    });
  }

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(1);
});

test('opens an orphan Codex search result even when the session is not present in the current project cache', async ({ page }) => {
  /** Scenario: 搜索结果对应的 Codex 会话不在当前项目列表缓存中 */
  const sessionId = 'codex-orphan-search-hit';
  const keyword = 'needle-codex-orphan-hit';
  const targetText = `Detached Codex history stores ${keyword} in this reply.`;

  await writeCodexSession({
    sessionId,
    datePath: ['2025', '12', '31'],
    entries: buildCodexTranscript({
      sessionId,
      records: [
        {
          timestamp: '2026-04-15T09:10:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Recover this detached session.',
          },
        },
        {
          timestamp: '2026-04-15T09:10:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: targetText }],
          },
        },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);
  await results.filter({ hasText: keyword }).first().click();

  await expect(page.locator('.chat-message').filter({ hasText: targetText }).first()).toBeVisible();
});

test('shows a visible loading state while chat search is in flight', async ({ page }) => {
  /** Scenario: 搜索请求进行中 */
  await page.route('**/api/chat/search**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, results: [] }),
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(CHAT_SEARCH_INPUT).fill('needle-loading-state');
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');

  await expect(page.locator(CHAT_SEARCH_LOADING)).toBeVisible();
});

test('shows an explicit empty state when chat search returns no matches', async ({ page }) => {
  /** Scenario: 搜索无命中 */
  await page.route('**/api/chat/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, results: [] }),
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(CHAT_SEARCH_INPUT).fill('needle-empty-state');
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');

  await expect(page.locator(CHAT_SEARCH_EMPTY)).toBeVisible();
});

test('shows an explicit error state when chat search fails', async ({ page }) => {
  /** Scenario: 搜索请求失败 */
  await page.route('**/api/chat/search**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'fixture search failure' }),
    });
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(CHAT_SEARCH_INPUT).fill('needle-error-state');
  await page.locator(CHAT_SEARCH_INPUT).press('Enter');

  await expect(page.locator(CHAT_SEARCH_ERROR)).toContainText('fixture search failure');
});
