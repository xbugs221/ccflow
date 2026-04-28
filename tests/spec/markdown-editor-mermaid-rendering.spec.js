/**
 * PURPOSE: Acceptance tests for Mermaid rendering in workspace markdown preview.
 * Derived from openspec/changes/1-add-markdown-editor-mermaid-rendering/specs/markdown-editor-mermaid-rendering/spec.md.
 */
import { test, expect } from '@playwright/test';
import {
  authenticatePage,
  openFilesTab,
  openFixtureProject,
  resetWorkspaceProject,
  writeWorkspaceTextFile,
} from './helpers/spec-test-helpers.js';

/**
 * Open a markdown file from the workspace and switch the editor into preview mode.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} relativePath
 * @param {string} content
 * @returns {Promise<import('@playwright/test').Locator>}
 */
async function openMarkdownPreview(page, relativePath, content) {
  await writeWorkspaceTextFile(relativePath, content);

  await openFixtureProject(page);
  await openFilesTab(page);
  await page.getByText(relativePath.split('/').at(-1), { exact: true }).click();
  await page.locator('button[title=\"Preview markdown\"]').click();

  return page.locator('.prose').last();
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('markdown preview renders valid mermaid fenced blocks as diagrams', async ({ page }) => {
  /** Scenario: Rendering a Mermaid flowchart in markdown preview */
  const preview = await openMarkdownPreview(
    page,
    'docs/architecture.md',
    [
      '# Architecture',
      '',
      '```mermaid',
      'flowchart LR',
      '  Start[Start] --> Done[Done]',
      '```',
      '',
      'The editor preview should show the diagram above.',
    ].join('\n'),
  );

  await expect(preview.getByText('Architecture', { exact: true })).toBeVisible();
  await expect(preview.locator('svg')).toBeVisible();
  await expect(preview.getByText('Start', { exact: true })).toBeVisible();
  await expect(preview.getByText('Done', { exact: true })).toBeVisible();
});

test('markdown preview keeps non-mermaid fenced blocks as ordinary code content', async ({ page }) => {
  /** Scenario: Keeping ordinary fenced code blocks unchanged */
  const preview = await openMarkdownPreview(
    page,
    'docs/code-sample.md',
    [
      '# Code Sample',
      '',
      '```js',
      'export const format = "plain-code";',
      '```',
    ].join('\n'),
  );

  await expect(preview.getByText('Code Sample', { exact: true })).toBeVisible();
  await expect(preview.getByText('js', { exact: true })).toBeVisible();
  await expect(preview.getByText('export const format = "plain-code";', { exact: true })).toBeVisible();
  await expect(preview.locator('svg')).toHaveCount(0);
});

test('markdown preview shows a visible fallback when a mermaid block is invalid', async ({ page }) => {
  /** Scenario: Showing a fallback for invalid Mermaid source */
  const preview = await openMarkdownPreview(
    page,
    'docs/broken-diagram.md',
    [
      '# Broken Diagram',
      '',
      '```mermaid',
      'flowchart LR',
      '  Start[Start] -->',
      '```',
      '',
      'Preview should still render this paragraph.',
    ].join('\n'),
  );

  await expect(preview.getByText('Broken Diagram', { exact: true })).toBeVisible();
  await expect(preview.getByText('Unable to render Mermaid diagram.', { exact: true })).toBeVisible();
  await expect(preview.getByText('Start[Start] -->', { exact: true })).toBeVisible();
  await expect(preview.getByText('Preview should still render this paragraph.', { exact: true })).toBeVisible();
});
