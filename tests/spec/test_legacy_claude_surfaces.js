/**
 * PURPOSE: Guard against reactivating retired Claude SDK and MCP UI surfaces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const readSource = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const cliPath = fileURLToPath(new URL('../../server/cli.js', import.meta.url));

const readOptionalSource = async (path) => {
  try {
    return await readSource(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
};

test('settings controller no longer calls legacy Claude MCP endpoints', async () => {
  const settingsController = await readSource('src/components/settings/hooks/useSettingsController.ts');
  const settingsView = await readSource('src/components/settings/view/Settings.tsx');

  assert.doesNotMatch(settingsController, /\/api\/mcp/);
  assert.doesNotMatch(settingsView, /ClaudeMcpFormModal|openMcpForm|submitMcpForm/);
});

test('active session helpers do not fall back to Claude provider', async () => {
  const helperSources = await Promise.all([
    readSource('src/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx'),
    readSource('src/components/main-content/view/subcomponents/MainContentTitle.tsx'),
    readSource('src/components/shell/hooks/useShellConnection.ts'),
    readSource('src/utils/workflowSessions.ts'),
    readSource('src/components/main-content/view/subcomponents/sessionActivityState.ts'),
  ]);

  for (const source of helperSources) {
    assert.doesNotMatch(source, /\|\|\s*['"]claude['"]/);
    assert.doesNotMatch(source, /\?\?\s*['"]claude['"]/);
  }
});

test('Claude SDK compatibility module file does not exist and no production imports', async () => {
  const source = await readOptionalSource('server/claude-sdk.js');
  assert.equal(source, '', 'server/claude-sdk.js must not exist');

  // Confirm no production code imports the removed module.
  const { execFileSync } = await import('node:child_process');
  try {
    const grepResult = execFileSync('rg', ['-l', 'claude-sdk', 'server/'], { encoding: 'utf8', cwd: new URL('../../', import.meta.url).pathname, stdio: 'pipe' });
    const files = grepResult.trim().split('\n').filter(Boolean);
    assert.deepEqual(files, [], 'no production code in server/ should reference claude-sdk');
  } catch (err) {
    // rg exits 1 when no matches — that's expected
    assert.equal(err.status, 1, 'rg exited with expected code 1 (no matches)');
  }
});

test('OpenCode settings do not use Claude quota fallback', async () => {
  const accountContent = await readSource('src/components/settings/view/tabs/agents-settings/sections/content/AccountContent.tsx');
  const usageRemaining = await readSource('server/usage-remaining.js');

  assert.match(accountContent, /agent\s*!==\s*'opencode'[\s\S]*<UsageProviderQuota/);
  assert.doesNotMatch(usageRemaining, /provider\s*===\s*'codex'\s*\?\s*'codex'\s*:\s*'claude'/);
  assert.match(usageRemaining, /provider-unsupported/);
});

test('OpenCode chat composer does not reuse Claude model or thinking controls', async () => {
  const modelControls = await readSource('src/components/chat/view/subcomponents/SessionModelControls.tsx');
  const chatComposer = await readSource('src/components/chat/view/subcomponents/ChatComposer.tsx');
  // Note: ChatInputControls.tsx was removed in change 30 (0 imports) -
  // its provider guard is now inlined in the composer.

  assert.doesNotMatch(modelControls, /ClaudeLogo|claudeModel|thinkingModes|sessionControls\.claudeDescription/);
  assert.match(chatComposer, /provider\s*===\s*'codex'\s*&&\s*\(/);
});

test('assistant message labels do not fall back to Claude for OpenCode', async () => {
  const messageComponent = await readSource('src/components/chat/view/subcomponents/MessageComponent.tsx');
  const englishChat = await readSource('src/i18n/locales/en/chat.json');

  assert.match(messageComponent, /provider\s*===\s*'opencode'[\s\S]*messageTypes\.opencode/);
  assert.doesNotMatch(messageComponent, /messageTypes\.claude/);
  assert.doesNotMatch(englishChat, /"claude"\s*:\s*"Claude"/);
});

test('chat state no longer keeps Claude model or thinking-mode persistence', async () => {
  const providerState = await readSource('src/components/chat/hooks/useChatProviderState.ts');
  const chatInterface = await readSource('src/components/chat/view/ChatInterface.tsx');
  const composerState = await readSource('src/components/chat/hooks/useChatComposerState.ts');
  const chatLocale = await readSource('src/i18n/locales/en/chat.json');
  const settingsLocale = await readSource('src/i18n/locales/en/settings.json');

  assert.doesNotMatch(providerState, /claudeModel|claude-model|getDefaultClaudeModel|FALLBACK_CLAUDE/);
  assert.doesNotMatch(chatInterface, /claudeModel|handleSetThinkingMode|thinkingMode/);
  assert.doesNotMatch(composerState, /cbw-thinking-mode|thinkingMode|setThinkingMode/);
  assert.doesNotMatch(chatLocale, /"thinkingMode"|claudeDescription/);
  assert.doesNotMatch(settingsLocale, /claudeDescription/);
});

test('slash command context does not map OpenCode to Claude model', async () => {
  const composerState = await readSource('src/components/chat/hooks/useChatComposerState.ts');

  assert.doesNotMatch(composerState, /provider\s*===\s*'codex'\s*\?\s*codexModel\s*:\s*claudeModel/);
  assert.match(composerState, /model:\s*provider\s*===\s*'codex'\s*\?\s*codexModel\s*:\s*undefined/);
});

test('OpenCode search results display OpenCode instead of Claude fallback', async () => {
  const searchDialog = await readSource('src/components/chat/view/ChatHistorySearchDialog.tsx');

  assert.match(searchDialog, /provider\s*===\s*'opencode'[\s\S]*return\s*'OpenCode'/);
  assert.doesNotMatch(searchDialog, /\?\s*'Codex'\s*:\s*'Claude'/);
});

test('cbw CLI status and help do not advertise Claude runtime configuration', async () => {
  const cliSource = await readSource('server/cli.js');
  const statusOutput = execFileSync(process.execPath, [cliPath, 'status'], { encoding: 'utf8' });
  const helpOutput = execFileSync(process.execPath, [cliPath, 'help'], { encoding: 'utf8' });

  for (const output of [cliSource, statusOutput, helpOutput]) {
    assert.doesNotMatch(output, /CLAUDE_CLI_PATH/);
    assert.doesNotMatch(output, /Claude Projects Folder/);
    assert.doesNotMatch(output, /\.claude\/projects/);
    assert.doesNotMatch(output, /custom Claude CLI path/);
  }
});

test('global chat search no longer scans or returns Claude sessions', async () => {
  const projectsSource = await readSource('server/projects.js');

  assert.doesNotMatch(projectsSource, /extractClaudeSearchableMessages/);
  assert.doesNotMatch(projectsSource, /provider:\s*['"]claude['"]/);
  assert.doesNotMatch(projectsSource, /Claude Session/);
  assert.doesNotMatch(projectsSource, /getSessions\(project\.name,\s*Number\.MAX_SAFE_INTEGER/);
});

test('active frontend empty and tool states do not show Claude copy', async () => {
  const activeSources = await Promise.all([
    readSource('src/components/sidebar/view/subcomponents/SidebarProjectsState.tsx'),
    readSource('src/components/main-content/view/subcomponents/MainContentStateView.tsx'),
    readSource('src/components/shell/view/Shell.tsx'),
    readSource('src/components/chat/tools/components/InteractiveRenderers/AskUserQuestionPanel.tsx'),
    readSource('src/i18n/locales/en/sidebar.json'),
    readSource('src/i18n/locales/en/common.json'),
    readSource('src/i18n/locales/en/chat.json'),
    readSource('src/i18n/locales/zh-CN/sidebar.json'),
    readSource('src/i18n/locales/zh-CN/common.json'),
    readSource('src/i18n/locales/zh-CN/chat.json'),
  ]);

  for (const source of activeSources) {
    assert.doesNotMatch(source, /Claude/);
    assert.doesNotMatch(source, /runClaudeCli/);
  }
});

test('settings locale copy does not expose legacy Claude provider entries', async () => {
  const settingsLocales = await Promise.all([
    readSource('src/i18n/locales/en/settings.json'),
    readSource('src/i18n/locales/zh-CN/settings.json'),
  ]);

  for (const source of settingsLocales) {
    assert.doesNotMatch(source, /Claude/);
    assert.doesNotMatch(source, /Claude\/Codex/);
    assert.doesNotMatch(source, /"claude"\s*:/);
  }
});

test('session token usage no longer exposes Claude parsers', async () => {
  const usageSources = await Promise.all([
    readSource('server/session-token-usage.js'),
    readSource('tests/server/session-token-usage.test.js'),
  ]);

  for (const source of usageSources) {
    assert.doesNotMatch(source, /getClaudeSessionTokenUsage/);
    assert.doesNotMatch(source, /claude-session-jsonl|claude-sdk-model-usage/);
  }
});

test('frontend permission settings no longer expose retired Claude settings APIs', async () => {
  const permissionSources = await Promise.all([
    readOptionalSource('src/components/chat/utils/chatPermissions.ts'),
    readSource('src/components/chat/utils/chatStorage.ts'),
    readSource('src/components/chat/types/types.ts'),
    readSource('src/components/settings/hooks/useSettingsController.ts'),
    readSource('src/components/sidebar/hooks/useSidebarController.ts'),
    readSource('src/components/sidebar/utils/utils.ts'),
    readSource('src/utils/settingsStorage.ts'),
  ]);

  for (const source of permissionSources) {
    assert.doesNotMatch(source, /buildClaudeToolPermissionEntry/);
    assert.doesNotMatch(source, /getClaudePermissionSuggestion/);
    assert.doesNotMatch(source, /grantClaudeToolPermission/);
    assert.doesNotMatch(source, /CLAUDE_SETTINGS_KEY|getClaudeSettings/);
    assert.doesNotMatch(source, /ClaudeSettings|ClaudePermissionSuggestion|PermissionGrantResult/);
    assert.doesNotMatch(source, /claude-settings/);
  }
});

test('browser acceptance specs no longer create positive Claude history fixtures', async () => {
  const browserSpecSources = await Promise.all([
    readSource('tests/e2e/helpers/playwright-fixture.js'),
    readSource('tests/e2e/project-visibility.spec.js'),
    readSource('tests/e2e/history-scroll-preservation.spec.js'),
    readSource('tests/spec/chat-history-full-text-search.spec.js'),
    readSource('tests/spec/chat-history-search-regressions.spec.js'),
    readSource('tests/spec/chat-tool-structured-rendering.spec.js'),
    readSource('tests/spec/chat-file-links-open-in-editor.spec.js'),
    readSource('tests/spec/chat-update-plan-empty-result.spec.js'),
    readSource('tests/spec/chat-history-search-production-routing.spec.js'),
    readSource('tests/spec/project-workflow-control-plane.spec.js'),
    readSource('tests/spec/codex-jsonl-message-rendering.spec.js'),
    readSource('tests/spec/codex-jsonl-single-source-rendering.spec.js'),
  ]);

  for (const source of browserSpecSources) {
    assert.doesNotMatch(source, /writeClaudeSession|buildClaudeTranscript|openFixtureClaudeSession/);
    assert.doesNotMatch(source, /provider:\s*['"]claude['"]/);
    assert.doesNotMatch(source, /\.claude/);
    assert.doesNotMatch(source, /Claude history|Claude session|Claude assistant/);
  }
});
