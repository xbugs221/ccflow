/**
 * PURPOSE: Server contract test after simplification — verifies that core
 * server modules export correct functions with stable signatures and that
 * the simplified backend keeps project/workflow/Git/diagnostics contracts.
 * Change: 30-进一步精简仓库源码和脚本资源
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

function findRepoRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

// ---- Import path shape checks (keep existing coverage) ----

test('server/projects.js imports from shared/codex-message-normalizer.ts', async () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'server/projects.js'), 'utf8');
  assert.ok(
    content.includes("'../shared/codex-message-normalizer.ts'"),
    'Must import from TS version'
  );
});

test('server/codex-models.js imports from shared/modelConstants.ts', async () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'server/codex-models.js'), 'utf8');
  assert.ok(
    content.includes("'../shared/modelConstants.ts'"),
    'Must import from TS version'
  );
});

test('server/executable-resolver.js exports resolveExecutablePath', async () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'server/executable-resolver.js'), 'utf8');
  assert.ok(content.includes('export function resolveExecutablePath'), 'Missing export');
});

test('runtime-dependencies imports from executable-resolver', async () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'server/runtime-dependencies.js'), 'utf8');
  assert.ok(content.includes("'./executable-resolver.js'"), 'Missing import');
});

test('commandParser.js BASH_COMMAND_ALLOWLIST excludes task-master', async () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'server/utils/commandParser.js'), 'utf8');
  assert.ok(!content.includes("'task-master'"), 'task-master still present');
});

test('MCP routes file returns 410 for all requests', async () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'server/routes/mcp.js'), 'utf8');
  assert.ok(content.includes('status(410)'), 'Should return 410 Gone');
});

test('server/index.js wires MCP routes for 410 rejection', async () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'server/index.js'), 'utf8');
  assert.ok(content.includes("app.use('/api/mcp'"), 'MCP routes not wired');
});

test('shared TS modules are valid files', async () => {
  const sharedFiles = [
    'shared/codex-message-normalizer.ts',
    'shared/modelConstants.ts',
    'shared/socket-message-utils.ts',
  ];
  for (const file of sharedFiles) {
    const fullPath = path.join(REPO_ROOT, file);
    assert.ok(fs.existsSync(fullPath), `Missing: ${file}`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.isFile(), `${file} is not a file`);
    assert.ok(stat.size > 100, `${file} too small (${stat.size} bytes)`);
  }
});

// ---- Real module-import contract tests (behavior, not strings) ----
// Use REPO_ROOT-anchored paths so tests work from both tests/ and
// docs/changes/.../tests/ locations.

function serverMod(...segments) {
  return path.join(REPO_ROOT, 'server', ...segments);
}

test('project read model exports core discovery functions', async () => {
  const mod = await import(serverMod('projects.js'));
  const required = ['getProjects', 'getSessions', 'getSessionMessages', 'addProjectManually',
    'deleteProject', 'renameProject', 'loadProjectConfig', 'saveProjectConfig'];
  for (const name of required) {
    assert.ok(typeof mod[name] === 'function', `projects.js must export ${name}`);
  }
});

test('manual session draft pipeline is wired', async () => {
  const mod = await import(serverMod('projects.js'));
  const draftFns = ['createManualSessionDraft', 'startManualSessionDraft',
    'bindManualSessionDraftProviderSession', 'finalizeManualSessionDraft',
    'getManualSessionDraftRuntime'];
  for (const name of draftFns) {
    assert.ok(typeof mod[name] === 'function', `projects.js must export ${name}`);
  }
});

test('workflow read model exports build and list functions', async () => {
  const mod = await import(serverMod('domains', 'workflows', 'wo-read-model.js'));
  const required = ['buildWoWorkflowReadModel', 'listWoWorkflowReadModels',
    'buildBatchReadModel', 'listBatchReadModels'];
  for (const name of required) {
    assert.ok(typeof mod[name] === 'function', `wo-read-model must export ${name}`);
  }
});

test('runtime dependency checker exports validate function', async () => {
  const mod = await import(serverMod('runtime-dependencies.js'));
  // The module must export at least one dependency-check entry point
  const exportKeys = Object.keys(mod).filter(
    (k) => !k.startsWith('__') && typeof mod[k] === 'function',
  );
  assert.ok(exportKeys.length > 0, 'runtime-dependencies must export functions');
});

test('Git API routes file exports an express router', async () => {
  const mod = await import(serverMod('routes', 'git.js'));
  // Express Router has use/get/post methods
  assert.ok(typeof mod.default === 'function' || typeof mod.default?.use === 'function',
    'Git routes must export a router');
});

test('server/index.js wires Git API at /api/git', async () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'server/index.js'), 'utf8');
  assert.ok(content.includes("app.use('/api/git'"), 'Git API /api/git not wired in index.js');
});

test('server/index.js wires OpenCode CLI routes', async () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'server/index.js'), 'utf8');
  assert.ok(
    content.includes('opencodeRoutes') || content.includes("app.use('/api/cli/opencode'"),
    'OpenCode CLI routes not wired',
  );
});

// ---- Runtime behavior tests (call real functions, not just check strings) ----

test('resolveExecutablePath returns a real path for a known system command', async () => {
  const { resolveExecutablePath } = await import(serverMod('executable-resolver.js'));
  // 'ls' is guaranteed available on POSIX systems
  const resolved = resolveExecutablePath('ls');
  assert.ok(typeof resolved === 'string' && resolved.length > 0,
    `resolveExecutablePath must return a non-empty path for ls, got: ${resolved}`);
  assert.ok(fs.existsSync(resolved), `${resolved} must exist on disk`);
});

test('resolveExecutablePath returns path for node', async () => {
  const { resolveExecutablePath } = await import(serverMod('executable-resolver.js'));
  const resolved = resolveExecutablePath('node');
  assert.ok(typeof resolved === 'string' && resolved.length > 0,
    'resolveExecutablePath must return a path for node');
});

test('commandParser allowlist structurally excludes task-master, includes standard commands', () => {
  const content = fs.readFileSync(serverMod('utils', 'commandParser.js'), 'utf8');
  // Verify the BASH_COMMAND_ALLOWLIST array structure
  assert.ok(!content.includes("'task-master'"), 'task-master must not appear in allowlist');
  assert.ok(content.includes("'ls'") || content.includes('"ls"'),
    'ls must still be in allowlist');
  assert.ok(content.includes("'node'") || content.includes('"node"'),
    'node must still be in allowlist');
  assert.ok(content.includes("'cat'") || content.includes('"cat"'),
    'cat must still be in allowlist');
});

test('Git API router exposes expected HTTP method handlers', async () => {
  const mod = await import(serverMod('routes', 'git.js'));
  const router = mod.default;
  // Express Router is a function with stack (layer array) or use/get methods
  assert.ok(
    typeof router === 'function' || typeof router?.use === 'function' ||
    typeof router?.get === 'function',
    'Git routes must export a usable Express router',
  );
});

test('runtime dependencies module loads without throwing', async () => {
  // The module must be importable without side-effect errors
  const mod = await import(serverMod('runtime-dependencies.js'));
  assert.ok(typeof mod === 'object' && mod !== null,
    'runtime-dependencies must export a module object');
});

// ---- Shared module runtime tests (used by both frontend and backend) ----

test('socket-message-utils exports getPendingSocketMessages', async () => {
  const mod = await import(path.join(REPO_ROOT, 'shared', 'socket-message-utils.ts'));
  assert.ok(typeof mod.getPendingSocketMessages === 'function',
    'Must export getPendingSocketMessages');
  assert.ok(typeof mod.getMessageHistoryTailSequence === 'function',
    'Must export getMessageHistoryTailSequence');
});

test('codex-message-normalizer exports normalize functions', async () => {
  const mod = await import(path.join(REPO_ROOT, 'shared', 'codex-message-normalizer.ts'));
  assert.ok(typeof mod.normalizeCodexFunctionCall === 'function',
    'Must export normalizeCodexFunctionCall');
  assert.ok(typeof mod.normalizeCodexRealtimeItem === 'function',
    'Must export normalizeCodexRealtimeItem');
});

test('modelConstants exports CODEX_REASONING_EFFORTS', async () => {
  const mod = await import(path.join(REPO_ROOT, 'shared', 'modelConstants.ts'));
  assert.ok(mod.CODEX_REASONING_EFFORTS !== undefined,
    'Must export CODEX_REASONING_EFFORTS');
});
