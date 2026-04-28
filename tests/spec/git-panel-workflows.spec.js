/**
 * PURPOSE: Acceptance tests for Git panel workflow upgrades.
 * Derived from openspec/changes/upgrade-git-panel-workflows/specs/git-panel-workflows/spec.md.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  authHeaders,
  authenticatePage,
  breakOriginRemote,
  createMixedGitChanges,
  git,
  initGitWorkspaceFixture,
  openGitTab,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.js';

test.beforeEach(async ({ page }) => {
  await authenticatePage(page);
  await initGitWorkspaceFixture();
});

test('branches workflow shows separate local and remote branch sections', async ({ page }) => {
  /** Scenario: Viewing local and remote sections */
  await openFixtureProject(page);
  await openGitTab(page);
  await page.getByRole('button', { name: /^Branches$/i }).click();
  const localSection = page.locator('section').filter({ hasText: /^Local/ }).first();

  await expect(page.getByText('Local', { exact: true })).toBeVisible();
  await expect(page.getByText('Remote', { exact: true })).toBeVisible();
  await expect(localSection.getByText('main', { exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText(/current/i);
});

test('user can create and switch to a new branch from the git panel', async ({ page }) => {
  /** Scenario: Creating and switching to a new branch */
  await openFixtureProject(page);
  await openGitTab(page);
  await page.getByRole('button', { name: /^Branches$/i }).click();
  const localSection = page.locator('section').filter({ hasText: /^Local/ }).first();
  await page.getByRole('button', { name: /New branch/i }).click();
  await page.getByLabel('Branch Name').fill('release/ui-refresh');
  await page.getByRole('button', { name: /Create Branch/i }).click();

  await expect(localSection.getByText('release/ui-refresh', { exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText(/current/i);
});

test('current branch cannot be deleted from the git panel', async ({ page }) => {
  /** Scenario: Rejecting deletion of the current branch */
  await openFixtureProject(page);
  await openGitTab(page);
  await page.getByRole('button', { name: /^Branches$/i }).click();

  await expect(page.getByTitle(/Delete main/i)).toHaveCount(0);
});

test('non-current branch deletion removes the branch from the local branch section', async ({ page }) => {
  /** Scenario: Deleting a non-current branch */
  await openFixtureProject(page);
  await openGitTab(page);
  await page.getByRole('button', { name: /^Branches$/i }).click();
  await expect(page.getByText('stale-ui', { exact: true })).toBeVisible();

  await page.getByTitle(/Delete stale-ui/i).click();
  await page.getByRole('button', { name: /^Delete$/i }).click();

  await expect(page.getByText('stale-ui', { exact: true })).toHaveCount(0);
});

test('changes workflow separates staged and unstaged files with a visible count', async ({ page }) => {
  /** Scenario: Viewing staged and unstaged sections */
  await createMixedGitChanges();

  await openFixtureProject(page);
  await openGitTab(page);

  await expect(page.locator('body')).toContainText(/Staged/i);
  await expect(page.locator('body')).toContainText(/Unstaged/i);
  await expect(page.locator('body')).toContainText('src/staged.js');
  await expect(page.locator('body')).toContainText('README.md');
  await expect(page.locator('body')).toContainText(/\b2\b/);
});

test('failed fetch shows a dismissible inline error banner', async ({ page }) => {
  /** Scenario: Fetch failure shows an inline error banner */
  breakOriginRemote();

  await openFixtureProject(page);
  await openGitTab(page);
  await page.getByRole('button', { name: /Fetch/i }).click();

  await expect(page.locator('body')).toContainText(/fetch/i);
  await expect(page.getByRole('button', { name: /Dismiss/i })).toBeVisible();

  await page.getByRole('button', { name: /Dismiss/i }).click();
  await expect(page.getByRole('button', { name: /Dismiss/i })).toHaveCount(0);
});

test('hyphenated projects still show branch data in the git panel', async ({ page, request }) => {
  /** Scenario: A project path contains hyphens and the Git panel must still resolve the repository root */
  const projectPath = path.join(path.dirname(PRIMARY_FIXTURE_PROJECT_PATH), 'hyphenated-git-panel-project');
  await fs.rm(projectPath, { recursive: true, force: true });
  await fs.mkdir(projectPath, { recursive: true });
  await fs.writeFile(path.join(projectPath, 'README.md'), '# hyphen fixture\n', 'utf8');

  git(['init', '-b', 'main'], projectPath);
  git(['config', 'user.email', 'playwright@example.com'], projectPath);
  git(['config', 'user.name', 'Playwright'], projectPath);
  git(['add', '.'], projectPath);
  git(['commit', '-m', 'Initial commit'], projectPath);

  const createProjectResponse = await request.post('/api/projects/create', {
    headers: authHeaders({ 'content-type': 'application/json' }),
    data: { path: projectPath },
  });
  expect(createProjectResponse.ok()).toBeTruthy();

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^hyphenated-git-panel-project\b/i }).click();
  await openGitTab(page);

  await expect(page.locator('body')).toContainText('main');
  await expect(page.locator('body')).not.toContainText('Not a git repository');
  await expect(page.locator('body')).not.toContainText('Git operation failed');
});
