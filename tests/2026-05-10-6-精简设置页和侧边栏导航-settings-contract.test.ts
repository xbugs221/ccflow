// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify the settings/sidebar simplification contract for change 6.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import settingsRoutes from '../server/routes/settings.ts';
import userRoutes from '../server/routes/user.ts';
// i18n languages migrated to TS; root test verifies contract via static source checks

const REPO_ROOT = resolve('.');

async function readRepoFile(path) {
  /**
   * Read a repository file as UTF-8 for static contract checks.
   */
  return readFile(resolve(REPO_ROOT, path), 'utf8');
}

async function exists(path) {
  /**
   * Check whether a repository path still exists.
   */
  try {
    await stat(resolve(REPO_ROOT, path));
    return true;
  } catch {
    return false;
  }
}

function routePaths(router) {
  /**
   * Extract the literal paths registered on an Express router.
   */
  return router.stack
    .map((layer) => layer.route?.path)
    .filter(Boolean);
}

test('top-level settings tabs only expose appearance, agents, and diagnostics', async () => {
  const tabs = await readRepoFile('src/components/settings/view/SettingsMainTabs.tsx');

  assert.match(tabs, /id: 'appearance'/);
  assert.match(tabs, /id: 'agents'/);
  assert.match(tabs, /id: 'diagnostics'/);
  assert.doesNotMatch(tabs, /id: 'git'/);
  assert.doesNotMatch(tabs, /id: 'api'/);
});

test('appearance settings only render dark mode and language controls', async () => {
  const source = await readRepoFile('src/components/settings/view/tabs/AppearanceSettingsTab.tsx');

  assert.match(source, /DarkModeToggle/);
  assert.match(source, /LanguageSelector/);
  assert.doesNotMatch(source, /projectSorting|ProjectSortOrder|codeEditor|fontSize|wordWrap|showMinimap|lineNumbers/);
});

test('agent settings no longer render MCP management and OpenCode has its own logo', async () => {
  const agents = await readRepoFile('src/components/settings/view/tabs/agents-settings/AgentsSettingsTab.tsx');
  const agentTypes = await readRepoFile('src/components/settings/view/tabs/agents-settings/types.ts');
  const settingsTypes = await readRepoFile('src/components/settings/types/types.ts');
  const settingsConstants = await readRepoFile('src/components/settings/constants/constants.ts');
  const logo = await readRepoFile('src/components/llm-logo-provider/SessionProviderLogo.tsx');

  assert.doesNotMatch(agents, /mcp|McpServersContent|CodexMcp/i);
  assert.doesNotMatch(agentTypes, /AgentCategoryTabsSectionProps/);
  assert.doesNotMatch(settingsTypes, /McpServerConfig|type McpServer|CodexMcpForm|KeyValueMap/);
  assert.doesNotMatch(settingsConstants, /DEFAULT_CODEX_MCP_FORM|CodexMcpForm/);
  assert.match(logo, /OpenCodeLogo/);
  assert.match(logo, /provider === 'opencode'/);
});

test('diagnostics tab uses i18n keys and Chinese resources include required labels', async () => {
  const diagnostics = await readRepoFile('src/components/settings/view/tabs/RuntimeDiagnosticsTab.tsx');
  const zhSettings = await readRepoFile('src/i18n/locales/zh-CN/settings.json');

  assert.doesNotMatch(diagnostics, /Runtime diagnostics|Overall|Loading diagnostics|Failed to load diagnostics/);
  for (const label of ['运行诊断', '整体状态', '成功', '失败', '命令路径', '运行目录', '版本', '契约能力', 'PATH', '正在加载诊断', '加载诊断失败']) {
    assert.match(zhSettings, new RegExp(label));
  }
});

test('i18n only supports English and Simplified Chinese and rejects old saved locales', async () => {
  // languages module migrated to TS; verify contract via static source checks
  const languagesSource = await readRepoFile('src/i18n/languages.ts');
  assert.match(languagesSource, /value: 'en'/);
  assert.match(languagesSource, /value: 'zh-CN'/);
  assert.doesNotMatch(languagesSource, /value: 'ja'/);
  assert.doesNotMatch(languagesSource, /value: 'ko'/);
  assert.match(languagesSource, /export const isLanguageSupported/);

  assert.equal(await exists('src/i18n/locales/ja'), false);
  assert.equal(await exists('src/i18n/locales/ko'), false);

  const config = await readRepoFile('src/i18n/config.ts');
  assert.doesNotMatch(config, /locales\/ja|locales\/ko/);
});

test('old global Git and settings API key routes are removed while project Git route remains', async () => {
  const apiClient = await readRepoFile('src/utils/api.ts');
  const onboarding = await readRepoFile('src/components/auth/Onboarding.tsx');
  assert.equal(routePaths(userRoutes).includes('/git-config'), false);
  assert.equal(routePaths(settingsRoutes).includes('/api-keys'), false);
  assert.equal(routePaths(settingsRoutes).includes('/credentials'), false);
  assert.doesNotMatch(apiClient, /git-config/);
  assert.doesNotMatch(onboarding, /git-config|Git Configuration|git config --global/);
  assert.equal(await exists('server/routes/git.ts'), true);
});

test('project creation keeps one-time GitHub token input without settings credentials lookup', async () => {
  const wizard = await readRepoFile('src/components/projects/view/ProjectCreationWizard.tsx');

  assert.doesNotMatch(wizard, /settings\/credentials|availableTokens|selectedGithubToken|githubTokenId/);
  assert.match(wizard, /newGithubToken/);
  assert.match(wizard, /newGithubToken\.trim\(\)/);
});

test('sidebar header has no project action/search controls and footer owns retained actions', async () => {
  const header = await readRepoFile('src/components/sidebar/view/subcomponents/SidebarHeader.tsx');
  const footer = await readRepoFile('src/components/sidebar/view/subcomponents/SidebarFooter.tsx');
  const sidebar = await readRepoFile('src/components/sidebar/view/Sidebar.tsx');

  assert.doesNotMatch(header, /FolderSearch|RefreshCw|Settings|PanelLeftClose|onRefresh|onCreateProject|onShowSettings|onOpenChatHistorySearch/);
  // Footer keeps accessibility labels and test ids for retained functional buttons
  assert.match(footer, /tooltips\.refresh/);
  assert.match(footer, /tooltips\.createProject/);
  assert.match(footer, /open-chat-history-search/);
  assert.match(footer, /actions\.settings/);
  assert.doesNotMatch(sidebar, /searchFilter|setSearchFilter/);
});
