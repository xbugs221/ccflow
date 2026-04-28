/**
 * PURPOSE: Acceptance tests for assistant-message workspace file references.
 * Derived from openspec/changes/chat-file-links-open-in-editor/specs/chat-file-links-open-in-editor/spec.md.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.js';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
  resolveWorkspacePath,
  writeWorkspaceTextFile,
} from './helpers/spec-test-helpers.js';

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
 * Create a Claude-format session fixture containing one assistant markdown reply.
 *
 * @param {{ sessionId: string, assistantContent: string }} params
 * @returns {Promise<void>}
 */
async function writeAssistantLinkSession({ sessionId, assistantContent }) {
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
    [
      JSON.stringify({
        sessionId,
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        timestamp: '2026-04-14T08:00:00.000Z',
        parentUuid: null,
        uuid: `${sessionId}-user-1`,
        type: 'user',
        message: {
          role: 'user',
          content: 'Show me the relevant file.',
        },
      }),
      JSON.stringify({
        sessionId,
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        timestamp: '2026-04-14T08:00:01.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: assistantContent,
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('absolute workspace file links open the referenced file in the embedded editor', async ({ page }) => {
  /** Scenario: Opening an absolute workspace file reference */
  const relativePath = 'src/absolute-link-target.ts';
  const absolutePath = resolveWorkspacePath(relativePath);
  const sessionId = 'fixture-absolute-file-link-session';

  await writeWorkspaceTextFile(relativePath, 'export const absoluteLink = true;\n');
  await writeAssistantLinkSession({
    sessionId,
    assistantContent: `Open [absolute-link-target.ts](${absolutePath}) for the implementation details.`,
  });

  await page.goto(`/session/${sessionId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'absolute-link-target.ts' })).toBeVisible();

  await page.getByRole('link', { name: 'absolute-link-target.ts' }).click();

  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}$`));
  await expect(page.getByRole('heading', { name: 'absolute-link-target.ts' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();
});

test('project-relative workspace file links resolve against the selected project root', async ({ page }) => {
  /** Scenario: Opening a project-relative workspace file reference */
  const relativePath = 'docs/relative-link-target.md';
  const sessionId = 'fixture-relative-file-link-session';

  await writeWorkspaceTextFile(relativePath, '# Relative Link Target\n');
  await writeAssistantLinkSession({
    sessionId,
    assistantContent: 'Review [relative-link-target.md](docs/relative-link-target.md) before editing.',
  });

  await page.goto(`/session/${sessionId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'relative-link-target.md' })).toBeVisible();

  await page.getByRole('link', { name: 'relative-link-target.md' }).click();

  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}$`));
  await expect(page.getByText('relative-link-target.md', { exact: true })).toBeVisible();
  await expect(page.locator('text=docs/relative-link-target.md')).toBeVisible();
});

test('workspace file links with line suffixes still open the file in the embedded editor', async ({ page }) => {
  /** Scenario: Opening a file reference that includes a line suffix */
  const relativePath = 'src/line-suffix-target.ts';
  const absolutePath = resolveWorkspacePath(relativePath);
  const sessionId = 'fixture-line-suffix-file-link-session';

  await writeWorkspaceTextFile(relativePath, 'export const firstLine = 1;\nexport const secondLine = 2;\n');
  await writeAssistantLinkSession({
    sessionId,
    assistantContent: `Inspect [line-suffix-target.ts](${absolutePath}#L2) for the second export.`,
  });

  await page.goto(`/session/${sessionId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'line-suffix-target.ts' })).toBeVisible();

  await page.getByRole('link', { name: 'line-suffix-target.ts' }).click();

  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}$`));
  await expect(page.getByText('line-suffix-target.ts', { exact: true })).toBeVisible();
  await expect(page.locator('text=export const secondLine = 2;')).toBeVisible();
});

test('clicking a workspace file reference keeps the current chat route active while opening the editor sidebar', async ({ page }) => {
  /** Scenario: Clicking a workspace file reference from an assistant reply */
  const relativePath = 'src/sidebar-route-target.ts';
  const sessionId = 'fixture-sidebar-route-file-link-session';

  await writeWorkspaceTextFile(relativePath, 'export const sidebarRoute = true;\n');
  await writeAssistantLinkSession({
    sessionId,
    assistantContent: 'Open [sidebar-route-target.ts](src/sidebar-route-target.ts) without leaving this chat.',
  });

  await page.goto(`/session/${sessionId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'sidebar-route-target.ts' })).toBeVisible();

  await page.getByRole('link', { name: 'sidebar-route-target.ts' }).click();

  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}$`));
  await expect(page.getByText('sidebar-route-target.ts', { exact: true })).toBeVisible();
  await expect(page.locator('text=src/sidebar-route-target.ts')).toBeVisible();
});

test('external links keep normal browser navigation instead of opening the editor', async ({ page }) => {
  /** Scenario: Opening an external documentation link */
  const sessionId = 'fixture-external-link-session';

  await writeAssistantLinkSession({
    sessionId,
    assistantContent: 'See [OpenAI docs](https://platform.openai.com/docs/overview) for external guidance.',
  });

  await page.goto(`/session/${sessionId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'OpenAI docs' })).toBeVisible();

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('link', { name: 'OpenAI docs' }).click(),
  ]);

  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}$`));
  await expect(page.getByRole('button', { name: /Save/i })).toHaveCount(0);
  await expect.poll(() => popup.url()).toMatch(/^https:\/\/platform\.openai\.com\/docs\/overview/);
  await popup.close();
});
