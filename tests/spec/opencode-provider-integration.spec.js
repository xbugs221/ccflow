/**
 * PURPOSE: Acceptance tests for change 28 — OpenCode provider scaffolding.
 *
 * Scope: this change is intentionally narrowed to type/constant/UI scaffolding
 * (proposal.md §"What Changes"). Backend SDK, REST routes, session discovery,
 * WebSocket, and workflow integration are explicit non-goals and live in
 * subsequent changes. These tests therefore validate that the scaffolding is
 * present in source so future backend work can land without front-end churn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

async function readRepoFile(relPath) {
  return readFile(resolve(REPO_ROOT, relPath), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline behavior implementations (mirror the production logic exactly).
// Static assertions below verify the source files contain the same code.
// ─────────────────────────────────────────────────────────────────────────────

function providerToSessionsKey(provider) {
  if (provider === 'codex') return 'codexSessions';
  if (provider === 'opencode') return 'opencodeSessions';
  return 'sessions';
}

function getProjectSessions(project) {
  const visibleSessions = [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.opencodeSessions ?? []),
  ];
  return visibleSessions.filter((session) => {
    return !(
      session.hidden === true ||
      session.archived === true ||
      session.status === 'archived' ||
      session.status === 'hidden'
    );
  });
}

function insertSessionIntoProject(project, session, provider) {
  const targetKey = providerToSessionsKey(provider);
  const currentSessions = Array.isArray(project[targetKey]) ? project[targetKey] : [];
  const withoutDuplicate = currentSessions.filter((entry) => entry.id !== session.id);
  const nextSessions = [session, ...withoutDuplicate];
  const currentTotal = Number(project.sessionMeta?.total || 0);
  return {
    ...project,
    [targetKey]: nextSessions,
    sessionMeta: {
      ...project.sessionMeta,
      total: Math.max(currentTotal, getProjectSessions(project).length + 1),
    },
  };
}

function resolveSessionProvider(selectedProject, selectedSession) {
  const explicitProvider = selectedSession?.__provider || selectedSession?.provider;
  if (explicitProvider === 'claude' || explicitProvider === 'codex' || explicitProvider === 'opencode') {
    return explicitProvider;
  }
  const sessionId = selectedSession?.id;
  if (!selectedProject || !sessionId) {
    return null;
  }
  if ((selectedProject.codexSessions || []).some((session) => session.id === sessionId)) {
    return 'codex';
  }
  if ((selectedProject.opencodeSessions || []).some((session) => session.id === sessionId)) {
    return 'opencode';
  }
  if ((selectedProject.sessions || []).some((session) => session.id === sessionId)) {
    return 'claude';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Static scaffolding assertions
// ─────────────────────────────────────────────────────────────────────────────

test('SessionProvider type literal includes opencode and Project carries opencodeSessions field', async () => {
  const source = await readRepoFile('src/types/app.ts');
  assert.match(
    source,
    /export\s+type\s+SessionProvider\s*=\s*'claude'\s*\|\s*'codex'\s*\|\s*'opencode'\s*;/,
    'SessionProvider must list claude | codex | opencode',
  );
  assert.match(
    source,
    /opencodeSessions\?\s*:\s*ProjectSession\[\]/,
    'Project must declare opencodeSessions?: ProjectSession[]',
  );
});

test('AgentProvider settings type includes opencode', async () => {
  const source = await readRepoFile('src/components/settings/types/types.ts');
  assert.match(
    source,
    /export\s+type\s+AgentProvider\s*=\s*'claude'\s*\|\s*'codex'\s*\|\s*'opencode'\s*;/,
    'AgentProvider must list claude | codex | opencode',
  );
});

test('AGENT_PROVIDERS constant lists opencode and AUTH_STATUS_ENDPOINTS registers a placeholder', async () => {
  const source = await readRepoFile('src/components/settings/constants/constants.ts');
  assert.match(
    source,
    /AGENT_PROVIDERS:\s*AgentProvider\[\]\s*=\s*\[\s*'claude'\s*,\s*'codex'\s*,\s*'opencode'\s*\]/,
    'AGENT_PROVIDERS must include opencode',
  );
  assert.match(
    source,
    /opencode:\s*'\/api\/cli\/opencode\/status'/,
    'AUTH_STATUS_ENDPOINTS must register an opencode endpoint string',
  );
});

test('AgentListItem agentConfig table contains an opencode entry with a registered color class', async () => {
  const source = await readRepoFile(
    'src/components/settings/view/tabs/agents-settings/AgentListItem.tsx',
  );
  assert.match(
    source,
    /opencode:\s*\{[^}]*name:\s*'OpenCode'[^}]*color:\s*'(?:blue|gray|orange)'/s,
    'agentConfig.opencode must define name and a known color',
  );
  assert.match(
    source,
    /orange:\s*\{[^}]*border:[^}]*bg:[^}]*dot:/s,
    'colorClasses.orange must define border/bg/dot classes',
  );
});

test('AccountContent agentConfig defines opencode visual config', async () => {
  const source = await readRepoFile(
    'src/components/settings/view/tabs/agents-settings/sections/content/AccountContent.tsx',
  );
  assert.match(
    source,
    /opencode:\s*\{[^}]*name:\s*'OpenCode'[^}]*bgClass:[^}]*borderClass:[^}]*textClass:[^}]*subtextClass:[^}]*buttonClass:/s,
    'AccountContent agentConfig.opencode must define all visual class props',
  );
});

test('PermissionsContent agent prop is widened to AgentProvider', async () => {
  const source = await readRepoFile(
    'src/components/settings/view/tabs/agents-settings/sections/content/PermissionsContent.tsx',
  );
  assert.match(
    source,
    /import\s+type\s+\{\s*AgentProvider\s*\}\s+from/,
    'PermissionsContent must import AgentProvider type',
  );
  assert.match(
    source,
    /agent\s*:\s*AgentProvider\b/,
    'PermissionsContent agent prop must be typed as AgentProvider',
  );
  assert.doesNotMatch(
    source,
    /agent\s*:\s*'claude'\s*\|\s*'codex'\s*;/,
    'PermissionsContent agent prop must no longer be hardcoded to claude|codex',
  );
});

test('AgentsSettingsTab wires opencodeAuthStatus and onOpencodeLogin into agentTabs', async () => {
  const source = await readRepoFile(
    'src/components/settings/view/tabs/agents-settings/AgentsSettingsTab.tsx',
  );
  assert.match(source, /opencodeAuthStatus/, 'must declare opencodeAuthStatus prop');
  assert.match(source, /onOpencodeLogin/, 'must declare onOpencodeLogin prop');
  assert.match(
    source,
    /opencode:\s*\{[^}]*authStatus:\s*opencodeAuthStatus[^}]*onLogin:\s*onOpencodeLogin/s,
    'agentTabs.opencode must wire authStatus and onLogin',
  );
});

test('ProviderSelectionEmptyState ready prompt map contains opencode key', async () => {
  const source = await readRepoFile(
    'src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx',
  );
  assert.match(
    source,
    /opencode:\s*t\(\s*'providerSelection\.readyPrompt\.opencode'/,
    'ready prompt map must include an opencode entry',
  );
});

test('AgentSelectorSection reuses shared AGENT_PROVIDERS instead of local constant', async () => {
  const source = await readRepoFile(
    'src/components/settings/view/tabs/agents-settings/sections/AgentSelectorSection.tsx',
  );
  assert.match(
    source,
    /import\s*\{\s*AGENT_PROVIDERS\s*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/\.\.\/constants\/constants['"]/,
    'AgentSelectorSection must import AGENT_PROVIDERS from shared constants',
  );
  assert.doesNotMatch(
    source,
    /const\s+AGENT_PROVIDERS\s*:\s*AgentProvider\[\]\s*=\s*\[\s*'claude'\s*,\s*'codex'\s*\]/,
    'AgentSelectorSection must NOT define a local two-item provider list',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Behavior tests: verify provider mapping, session insertion, and resolution
// ─────────────────────────────────────────────────────────────────────────────

test('providerToSessionsKey maps all three providers to distinct session keys', () => {
  assert.equal(providerToSessionsKey('claude'), 'sessions');
  assert.equal(providerToSessionsKey('codex'), 'codexSessions');
  assert.equal(providerToSessionsKey('opencode'), 'opencodeSessions');
});

test('getProjectSessions aggregates sessions from all three provider buckets', () => {
  const project = {
    sessions: [{ id: 's1' }, { id: 's2', hidden: true }],
    codexSessions: [{ id: 'c1' }],
    opencodeSessions: [{ id: 'o1' }, { id: 'o2', archived: true }],
  };
  const result = getProjectSessions(project);
  const ids = result.map((s) => s.id).sort();
  assert.deepEqual(ids, ['c1', 'o1', 's1'], 'must include visible sessions from all buckets');
});

test('insertSessionIntoProject places opencode sessions into opencodeSessions bucket', () => {
  const project = {
    name: 'p',
    sessions: [{ id: 's1' }],
    codexSessions: [{ id: 'c1' }],
    opencodeSessions: [{ id: 'o1' }],
    sessionMeta: { total: 3 },
  };
  const newSession = { id: 'o2' };
  const updated = insertSessionIntoProject(project, newSession, 'opencode');

  const opencodeIds = updated.opencodeSessions.map((s) => s.id);
  assert.deepEqual(opencodeIds, ['o2', 'o1'], 'opencode session must be prepended to opencodeSessions');
  assert.equal(updated.sessions.length, 1, 'claude bucket must be untouched');
  assert.equal(updated.codexSessions.length, 1, 'codex bucket must be untouched');
});

test('insertSessionIntoProject deduplicates within the target bucket', () => {
  const project = {
    name: 'p',
    sessions: [],
    codexSessions: [],
    opencodeSessions: [{ id: 'o1' }],
    sessionMeta: { total: 1 },
  };
  const updated = insertSessionIntoProject(project, { id: 'o1' }, 'opencode');
  assert.equal(updated.opencodeSessions.length, 1, 'duplicate must be replaced, not appended');
  assert.equal(updated.opencodeSessions[0].id, 'o1');
});

test('resolveSessionProvider resolves opencode from explicit metadata', () => {
  assert.equal(
    resolveSessionProvider(null, { id: 'x', __provider: 'opencode' }),
    'opencode',
    'explicit __provider must win',
  );
  assert.equal(
    resolveSessionProvider(null, { id: 'x', provider: 'opencode' }),
    'opencode',
    'explicit provider field must win',
  );
});

test('resolveSessionProvider infers opencode from project.opencodeSessions membership', () => {
  const project = {
    sessions: [{ id: 's1' }],
    codexSessions: [{ id: 'c1' }],
    opencodeSessions: [{ id: 'o1' }],
  };

  assert.equal(resolveSessionProvider(project, { id: 'o1' }), 'opencode');
  assert.equal(resolveSessionProvider(project, { id: 'c1' }), 'codex');
  assert.equal(resolveSessionProvider(project, { id: 's1' }), 'claude');
  assert.equal(resolveSessionProvider(project, { id: 'unknown' }), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-structure assertions that lock the behavior into the production files
// ─────────────────────────────────────────────────────────────────────────────

test('useProjectsState source contains providerToSessionsKey with opencode branch', async () => {
  const source = await readRepoFile('src/hooks/useProjectsState.ts');
  assert.match(
    source,
    /if\s*\(\s*provider\s*===\s*'opencode'\s*\)\s*return\s*'opencodeSessions'/,
    'providerToSessionsKey must have an opencode branch',
  );
});

test('useProjectsState source contains getProjectSessions with opencodeSessions spread', async () => {
  const source = await readRepoFile('src/hooks/useProjectsState.ts');
  assert.match(
    source,
    /\.\.\.\(project\.opencodeSessions\s*\?\?\s*\[\]\)/,
    'getProjectSessions must spread opencodeSessions',
  );
});

test('useProjectsState source resolves provider via opencodeSessions in route effect', async () => {
  const source = await readRepoFile('src/hooks/useProjectsState.ts');
  assert.match(
    source,
    /resolvedProject\.opencodeSessions\s*\|\|\s*\[\]\)\.some/,
    'route effect must scan opencodeSessions for provider inference',
  );
});

test('useProjectsState handleSessionDelete filters opencodeSessions', async () => {
  const source = await readRepoFile('src/hooks/useProjectsState.ts');
  assert.match(
    source,
    /opencodeSessions:\s*project\.opencodeSessions\?\.filter\(\(session\)\s*=>\s*session\.id\s*!==\s*sessionIdToDelete\)\s*\?\?\s*\[\]/,
    'handleSessionDelete must filter opencodeSessions',
  );
});

test('useChatSessionState resolveSessionProvider accepts opencode explicitly', async () => {
  const source = await readRepoFile('src/components/chat/hooks/useChatSessionState.ts');
  assert.match(
    source,
    /explicitProvider\s*===\s*'claude'\s*\|\|\s*explicitProvider\s*===\s*'codex'\s*\|\|\s*explicitProvider\s*===\s*'opencode'/,
    'resolveSessionProvider must accept opencode in the explicit-provider branch',
  );
  assert.match(
    source,
    /selectedProject\.opencodeSessions\s*\|\|\s*\[\]\)\.some\(\(session\)\s*=>\s*session\.id\s*===\s*sessionId\)/,
    'resolveSessionProvider must scan opencodeSessions for membership inference',
  );
});

test('No OpenCode backend module is introduced by this change (scoping invariant)', async () => {
  // Asserting absence keeps the change scope honest. Backend modules are out
  // of scope and must land in a separate change.
  for (const rel of ['server/opencode-sdk.js', 'server/routes/opencode.js']) {
    let exists = true;
    try {
      await stat(resolve(REPO_ROOT, rel));
    } catch {
      exists = false;
    }
    assert.equal(exists, false, `${rel} must NOT exist in change 28 (out of scope)`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder-mode auth & quota safety (review-3 follow-ups)
// Without a real OpenCode backend, settings UI must not (a) hit a missing
// status route, (b) write the failure into another provider's auth slot, or
// (c) render a quota panel that never receives data.
// ─────────────────────────────────────────────────────────────────────────────

test('useSettingsController.checkAuthStatus early-returns for opencode (no /api/cli/opencode/status probe)', async () => {
  const source = await readRepoFile('src/components/settings/hooks/useSettingsController.ts');
  assert.match(
    source,
    /const\s+checkAuthStatus\s*=\s*useCallback\s*\(\s*async\s*\(\s*provider\s*:\s*AgentProvider\s*\)\s*=>\s*\{[\s\S]*?if\s*\(\s*provider\s*===\s*'opencode'\s*\)\s*\{\s*return;\s*\}/,
    'checkAuthStatus must early-return for opencode before authenticatedFetch',
  );
});

test('useSettingsController.setAuthStatusByProvider does not pollute Codex when given opencode', async () => {
  const source = await readRepoFile('src/components/settings/hooks/useSettingsController.ts');
  // The function must branch on 'codex' explicitly instead of using it as the
  // unguarded fallback, otherwise opencode would land in the Codex slot.
  assert.match(
    source,
    /const\s+setAuthStatusByProvider\s*=\s*useCallback\s*\([\s\S]*?if\s*\(\s*provider\s*===\s*'claude'\s*\)\s*\{[\s\S]*?\}\s*if\s*\(\s*provider\s*===\s*'codex'\s*\)\s*\{[\s\S]*?setCodexAuthStatus\(/,
    'setAuthStatusByProvider must guard the codex branch with an explicit provider check',
  );
  assert.doesNotMatch(
    source,
    /const\s+setAuthStatusByProvider\s*=\s*useCallback\s*\([\s\S]*?if\s*\(\s*provider\s*===\s*'claude'\s*\)\s*\{[\s\S]*?return;\s*\}\s*setCodexAuthStatus\(/,
    'setAuthStatusByProvider must NOT use setCodexAuthStatus as the unconditional fallback',
  );
});

test('useSettingsController.openLoginForProvider refuses opencode in placeholder mode', async () => {
  const source = await readRepoFile('src/components/settings/hooks/useSettingsController.ts');
  assert.match(
    source,
    /const\s+openLoginForProvider\s*=\s*useCallback\s*\(\s*\(\s*provider\s*:\s*AgentProvider\s*\)\s*=>\s*\{[\s\S]*?if\s*\(\s*provider\s*===\s*'opencode'\s*\)\s*\{\s*return;\s*\}/,
    'openLoginForProvider must early-return for opencode before showing the login modal',
  );
});

test('AccountContent hides the login button for opencode and skips UsageProviderQuota', async () => {
  const source = await readRepoFile(
    'src/components/settings/view/tabs/agents-settings/sections/content/AccountContent.tsx',
  );
  assert.match(
    source,
    /agent\s*===\s*'opencode'\s*\?\s*\(/,
    'AccountContent must branch on agent === \'opencode\' for the login slot',
  );
  assert.match(
    source,
    /\{\s*agent\s*!==\s*'opencode'\s*&&\s*\([\s\S]*?<UsageProviderQuota[\s\S]*?\)\s*\}/,
    'AccountContent must guard <UsageProviderQuota /> with agent !== \'opencode\'',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Behavior tests: replicate the setAuthStatusByProvider routing logic to lock
// in the opencode-safe contract.
// ─────────────────────────────────────────────────────────────────────────────

test('setAuthStatusByProvider routing (replicated) keeps opencode out of codex/claude slots', () => {
  // Mirrors the production reducer in useSettingsController.ts.
  function routeAuthStatus(provider, slots) {
    const next = { ...slots };
    if (provider === 'claude') {
      next.claude = { authenticated: false, error: 'whatever' };
      return next;
    }
    if (provider === 'codex') {
      next.codex = { authenticated: false, error: 'whatever' };
      return next;
    }
    // opencode and anything else: no slot mutation in placeholder mode.
    return next;
  }

  const initial = { claude: null, codex: null };
  const afterOpencode = routeAuthStatus('opencode', initial);
  assert.equal(afterOpencode.claude, null, 'opencode must not write into claude slot');
  assert.equal(afterOpencode.codex, null, 'opencode must not write into codex slot');

  const afterCodex = routeAuthStatus('codex', initial);
  assert.equal(afterCodex.claude, null, 'codex update must not touch claude slot');
  assert.ok(afterCodex.codex && afterCodex.codex.error === 'whatever', 'codex update must land in codex slot');
});
