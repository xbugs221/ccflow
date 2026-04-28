/**
 * PURPOSE: Acceptance tests for cross-session full-text chat history search.
 * Derived from openspec/changes/1-add-chat-history-full-text-search/specs/chat-history-full-text-search/spec.md.
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
const CHAT_SEARCH_HIGHLIGHT = '.chat-search-highlight';

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
 * @param {{
 *   sessionId: string,
 *   entries: Array<Record<string, unknown>>,
 * }} params
 * @returns {Promise<void>}
 */
async function writeClaudeSession({ sessionId, entries }) {
  const projectDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.claude',
    'projects',
    encodeClaudeProjectName(PRIMARY_FIXTURE_PROJECT_PATH),
  );
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);

  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

/**
 * Write one Codex JSONL session file under the Playwright fixture HOME.
 *
 * @param {{
 *   sessionId: string,
 *   entries: Array<Record<string, unknown>>,
 * }} params
 * @returns {Promise<void>}
 */
async function writeCodexSession({ sessionId, entries }) {
  const codexDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.codex',
    'sessions',
    '2026',
    '04',
    '14',
  );
  const sessionPath = path.join(codexDir, `${sessionId}.jsonl`);

  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

/**
 * Build a minimal Claude transcript with stable ordering and timestamps.
 *
 * @param {{
 *   sessionId: string,
 *   messages: Array<{ role: 'user' | 'assistant', content: string }>
 * }} params
 * @returns {Array<Record<string, unknown>>}
 */
function buildClaudeTranscript({ sessionId, messages }) {
  return messages.map((message, index) => ({
    sessionId,
    cwd: PRIMARY_FIXTURE_PROJECT_PATH,
    timestamp: `2026-04-14T08:00:${String(index).padStart(2, '0')}.000Z`,
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
 * @param {{
 *   sessionId: string,
 *   records: Array<Record<string, unknown>>
 * }} params
 * @returns {Array<Record<string, unknown>>}
 */
function buildCodexTranscript({ sessionId, records }) {
  return [
    {
      timestamp: '2026-04-14T09:00:00.000Z',
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
  await expect(page.locator(CHAT_SEARCH_RESULTS)).toBeVisible();
  return page.locator(CHAT_SEARCH_RESULT);
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('returns a hit when the keyword only exists in an older Claude assistant message', async ({ page }) => {
  /** Scenario: 关键词命中旧 Claude 会话中的助手消息 */
  const sessionId = 'claude-search-assistant-hit';
  const keyword = 'needle-claude-assistant-legacy';

  await writeClaudeSession({
    sessionId,
    entries: buildClaudeTranscript({
      sessionId,
      messages: [
        { role: 'user', content: 'Please help me review the previous implementation.' },
        { role: 'assistant', content: `The hidden reference is ${keyword} and only appears in this old reply.` },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(1);
  await expect(results.filter({ hasText: /Claude/i })).toHaveCount(1);
});

test('returns a hit when the keyword only exists in a Codex user message', async ({ page }) => {
  /** Scenario: 关键词命中 Codex 会话中的用户消息 */
  const sessionId = 'codex-search-user-hit';
  const keyword = 'needle-codex-user-only';

  await writeCodexSession({
    sessionId,
    entries: buildCodexTranscript({
      sessionId,
      records: [
        {
          timestamp: '2026-04-14T09:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: `Remember this term: ${keyword}`,
          },
        },
        {
          timestamp: '2026-04-14T09:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Acknowledged.' }],
          },
        },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(1);
  await expect(results.filter({ hasText: /Codex/i })).toHaveCount(1);
});

test('returns hits for visible reasoning or tool text in the transcript', async ({ page }) => {
  /** Scenario: 关键词命中 transcript 中的工具或 reasoning 文本 */
  const sessionId = 'codex-search-reasoning-hit';
  const keyword = 'needle-reasoning-visible';

  await writeCodexSession({
    sessionId,
    entries: buildCodexTranscript({
      sessionId,
      records: [
        {
          timestamp: '2026-04-14T09:10:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Find the relevant note.',
          },
        },
        {
          timestamp: '2026-04-14T09:10:02.000Z',
          type: 'response_item',
          payload: {
            type: 'reasoning',
            summary: [{ text: `Reasoning summary contains ${keyword} for audit purposes.` }],
          },
        },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(1);
});

test('returns separate message-level results when the same keyword hits multiple sessions', async ({ page }) => {
  /** Scenario: 同一关键词命中多个会话 */
  const keyword = 'needle-multi-session';

  await writeClaudeSession({
    sessionId: 'claude-multi-session-a',
    entries: buildClaudeTranscript({
      sessionId: 'claude-multi-session-a',
      messages: [
        { role: 'user', content: 'Session A request.' },
        { role: 'assistant', content: `A result mentions ${keyword} in Claude.` },
      ],
    }),
  });

  await writeCodexSession({
    sessionId: 'codex-multi-session-b',
    entries: buildCodexTranscript({
      sessionId: 'codex-multi-session-b',
      records: [
        {
          timestamp: '2026-04-14T09:20:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Session B request.',
          },
        },
        {
          timestamp: '2026-04-14T09:20:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: `Codex also stores ${keyword} here.` }],
          },
        },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(2);
});

test('returns separate message-level results when the same keyword appears in multiple messages of one session', async ({ page }) => {
  /** Scenario: 同一会话中同词命中多条消息 */
  const sessionId = 'claude-same-session-multi-hit';
  const keyword = 'needle-same-session-many';

  await writeClaudeSession({
    sessionId,
    entries: buildClaudeTranscript({
      sessionId,
      messages: [
        { role: 'user', content: 'Initial request without the keyword.' },
        { role: 'assistant', content: `First answer contains ${keyword}.` },
        { role: 'user', content: 'Follow-up.' },
        { role: 'assistant', content: `Second answer also contains ${keyword}.` },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);

  await expect(results.filter({ hasText: keyword })).toHaveCount(2);
});

test('clicking a search result scrolls directly to a hit that is already loaded', async ({ page }) => {
  /** Scenario: 命中消息已在当前加载窗口中 */
  const sessionId = 'claude-click-loaded-hit';
  const keyword = 'needle-click-loaded';
  const targetText = `The loaded hit contains ${keyword} and should be immediately visible.`;

  await writeClaudeSession({
    sessionId,
    entries: buildClaudeTranscript({
      sessionId,
      messages: [
        { role: 'user', content: 'Show the latest item.' },
        { role: 'assistant', content: targetText },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);
  await results.filter({ hasText: keyword }).first().click();

  const targetMessage = page.locator('.chat-message').filter({ hasText: targetText }).first();
  await expect(targetMessage).toBeVisible();
  await expect(targetMessage).toBeInViewport();
});

test('clicking a search result auto-loads older history until the hit message is available', async ({ page }) => {
  /** Scenario: 命中消息不在当前加载窗口中 */
  const sessionId = 'claude-click-unloaded-hit';
  const keyword = 'needle-click-unloaded';
  const messages = [{ role: 'user', content: 'Start session.' }];

  for (let index = 0; index < 12; index += 1) {
    messages.push({
      role: index === 2 ? 'assistant' : 'user',
      content: index === 2
        ? `Older hidden target contains ${keyword} and requires loading more history.`
        : `Filler message ${index}`,
    });
  }

  await writeClaudeSession({
    sessionId,
    entries: buildClaudeTranscript({ sessionId, messages }),
  });

  const results = await runChatSearch(page, keyword);
  await results.filter({ hasText: keyword }).first().click();

  const targetMessage = page.locator('.chat-message').filter({ hasText: keyword }).first();
  await expect(targetMessage).toBeVisible();
  await expect(targetMessage).toBeInViewport();
});

test('opening a search result highlights every match occurrence inside the target message', async ({ page }) => {
  /** Scenario: 搜索结果打开后高亮命中词 */
  /** Scenario: 同一条消息中关键词出现多次 */
  const sessionId = 'claude-highlight-repeated-hit';
  const keyword = 'needle-highlight-repeat';
  const repeatedMessage = `${keyword} appears here, and ${keyword} appears again in the same reply.`;

  await writeClaudeSession({
    sessionId,
    entries: buildClaudeTranscript({
      sessionId,
      messages: [
        { role: 'user', content: 'Open the highlighted reply.' },
        { role: 'assistant', content: repeatedMessage },
      ],
    }),
  });

  const results = await runChatSearch(page, keyword);
  await results.filter({ hasText: keyword }).first().click();

  const targetMessage = page.locator('.chat-message').filter({ hasText: repeatedMessage }).first();
  await expect(targetMessage).toBeVisible();
  await expect(targetMessage.locator(CHAT_SEARCH_HIGHLIGHT)).toHaveCount(2);
});
