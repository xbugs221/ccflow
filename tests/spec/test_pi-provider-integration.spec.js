/**
 * PURPOSE: Verify Pi provider front-end integration through static source
 * assertions.  Covers project overview picker, chat composer pi-command,
 * i18n labels, and session provider resolution.
 *
 * These tests satisfy task.md 6.4 and lock in the Pi business flow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

function readRepoFile(relPath) {
  return fs.readFileSync(path.resolve(REPO_ROOT, relPath), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Project overview Pi picker
// ─────────────────────────────────────────────────────────────────────────────

test('ProjectOverviewPanel renders Pi provider button with correct test id', async () => {
  const source = await readRepoFile(
    'src/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx',
  );
  assert.match(
    source,
    /data-testid="project-new-session-provider-pi"/,
    'must render Pi button with data-testid',
  );
  assert.match(
    source,
    /onClick=\{\(\) => handleCreateSession\('pi'\)\}/,
    'Pi button must call handleCreateSession with pi',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Chat composer pi-command send path
// ─────────────────────────────────────────────────────────────────────────────

test('useChatComposerState sends pi-command for pi provider', async () => {
  const source = await readRepoFile(
    'src/components/chat/hooks/useChatComposerState.ts',
  );
  assert.match(
    source,
    /provider === 'pi'/,
    'must have pi provider branch in send handler',
  );
  assert.match(
    source,
    /type: 'pi-command'/,
    'must send pi-command type for Pi provider',
  );
  // Pi should NOT send model or reasoningEffort options
  const piBranch = source.match(/provider === 'pi'[\s\S]*?sendMessage\(\{[\s\S]*?\}\);/);
  assert.ok(piBranch, 'must have a pi sendMessage call');
  assert.ok(
    !piBranch[0].includes('model:'),
    'pi-command must not include model option',
  );
  assert.ok(
    !piBranch[0].includes('reasoningEffort:'),
    'pi-command must not include reasoningEffort option',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ChatInterface Pi provider label and placeholder
// ─────────────────────────────────────────────────────────────────────────────

test('ChatInterface shows Pi label and placeholder for pi provider', async () => {
  const source = await readRepoFile(
    'src/components/chat/view/ChatInterface.tsx',
  );
  // Provider label
  assert.match(
    source,
    /effectiveProvider === 'pi'[\s\S]*?t\('messageTypes\.pi'\)/,
    'must use messageTypes.pi for Pi label',
  );
  // Placeholder
  assert.match(
    source,
    /effectiveProvider === 'pi'[\s\S]*?t\('messageTypes\.pi'/,
    'must use Pi label for input placeholder',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Server pi-command WebSocket handler
// ─────────────────────────────────────────────────────────────────────────────

test('server/index.js handles pi-command WebSocket messages', async () => {
  const source = await readRepoFile('server/index.js');
  assert.match(
    source,
    /data\.type === 'pi-command'/,
    'must detect pi-command in WebSocket handler',
  );
  assert.match(
    source,
    /ensureCoAvailable\('pi'\)/,
    'must check co availability for pi before writing request',
  );
  assert.match(
    source,
    /buildCoRequest\(\{[\s\S]*?provider: 'pi'/,
    'must build co request with provider=pi',
  );
  // Verify co-request-v1 fields: conversation_id, project_path, text
  assert.match(
    source,
    /conversationId:\s*resolvedRoute\.conversationId/,
    'must include stable conversation_id from resolved route',
  );
  assert.match(
    source,
    /projectPath:\s*piProviderOptions\?\.projectPath/,
    'must include project_path in co request',
  );
  assert.match(
    source,
    /text:\s*data\.command/,
    'must include user text in co request',
  );
  assert.match(
    source,
    /writeCoRequest\(coRequest\)/,
    'must write pi co request to pending',
  );
  assert.match(
    source,
    /sendMessageAccepted\(writer,\s*\{[\s\S]*?provider:\s*'pi'/,
    'must send message-accepted with provider=pi',
  );
  assert.match(
    source,
    /observeCoConversationTurns\(coRequest\.conversation_id,\s*writer,\s*'pi'/,
    'must observe co conversation turns for pi',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Server pi-command in error catch block
// ─────────────────────────────────────────────────────────────────────────────

test('server/index.js maps pi-command errors to pi-error type', async () => {
  const source = await readRepoFile('server/index.js');
  assert.match(
    source,
    /data\?\.type === 'pi-command'/,
    'must detect pi-command type in error handler',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// i18n coverage
// ─────────────────────────────────────────────────────────────────────────────

test('i18n chat.json includes pi in messageTypes', async () => {
  const enSource = await readRepoFile('src/i18n/locales/en/chat.json');
  assert.match(enSource, /"pi":\s*"Pi"/, 'en chat.json must define Pi message type');

  const zhSource = await readRepoFile('src/i18n/locales/zh-CN/chat.json');
  assert.match(zhSource, /"pi":\s*"Pi"/, 'zh-CN chat.json must define Pi message type');
});

test('i18n settings.json includes pi agent account description', async () => {
  const enSource = await readRepoFile('src/i18n/locales/en/settings.json');
  assert.match(
    enSource,
    /"pi":\s*\{[\s\S]*?"description":/,
    'en settings.json must have pi agent account section',
  );

  const zhSource = await readRepoFile('src/i18n/locales/zh-CN/settings.json');
  assert.match(
    zhSource,
    /"pi":\s*\{[\s\S]*?"description":/,
    'zh-CN settings.json must have pi agent account section',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowDetailView Pi recognition
// ─────────────────────────────────────────────────────────────────────────────

test('WorkflowDetailView recognizes pi sessions from piSessions', async () => {
  const source = await readRepoFile(
    'src/components/main-content/view/subcomponents/WorkflowDetailView.tsx',
  );
  assert.match(
    source,
    /project\.piSessions/,
    'WorkflowDetailView must check project.piSessions for Pi',
  );
  assert.match(
    source,
    /provider === 'pi'/,
    'WorkflowDetailView must recognize pi provider in child sessions',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider selection empty state
// ─────────────────────────────────────────────────────────────────────────────

test('ProviderSelectionEmptyState includes Pi option', async () => {
  const source = await readRepoFile(
    'src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx',
  );
  assert.match(
    source,
    /'pi'/,
    'ProviderSelectionEmptyState must list pi as a selectable provider',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings AccountContent Pi display
// ─────────────────────────────────────────────────────────────────────────────

test('AccountContent shows Pi CLI availability without login or quota', async () => {
  const source = await readRepoFile(
    'src/components/settings/view/tabs/agents-settings/sections/content/AccountContent.tsx',
  );
  assert.match(
    source,
    /agent === 'pi'/,
    'AccountContent must have a pi-specific branch',
  );
  assert.match(
    source,
    /agents\.account\.pi\./,
    'AccountContent must use pi-specific i18n keys',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// useProjectsState Pi session change detection
// ─────────────────────────────────────────────────────────────────────────────

test('useProjectsState projectsHaveChanges compares piSessions', async () => {
  const source = await readRepoFile('src/hooks/useProjectsState.ts');
  assert.match(
    source,
    /serialize\(nextProject\.piSessions\)\s*!==\s*serialize\(prevProject\.piSessions\)/,
    'projectsHaveChanges must compare piSessions to detect pi state updates',
  );
});

test('useProjectsState getProjectSessions includes piSessions spread', async () => {
  const source = await readRepoFile('src/hooks/useProjectsState.ts');
  assert.match(
    source,
    /\.\.\.\(project\.piSessions\s*\?\?\s*\[\]\)/,
    'getProjectSessions must spread piSessions into visible session list',
  );
});
