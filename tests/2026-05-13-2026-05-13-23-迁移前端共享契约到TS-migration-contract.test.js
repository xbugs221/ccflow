/**
 * PURPOSE: Verify TypeScript migration contract for shared and frontend utilities.
 *
 * Change: 2026-05-13-23-迁移前端共享契约到TS
 *
 * This test validates:
 * 1. Frontend-exclusive files migrated to .ts
 * 2. Shared files used by server/node-tests keep .js runtime + gain .d.ts types
 * 3. No server TS runtime introduced
 * 4. TypeScript typecheck covers migrated contracts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const fileExists = async (path) => {
  try {
    await access(resolve(REPO_ROOT, path));
    return true;
  } catch {
    return false;
  }
};

const readSource = (path) => readFile(resolve(REPO_ROOT, path), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Frontend-exclusive files migrated to TypeScript
// ─────────────────────────────────────────────────────────────────────────────

test('src/utils/api.ts exists and provides typed exports', async () => {
  assert.equal(await fileExists('src/utils/api.ts'), true, 'api.ts must exist');
  assert.equal(await fileExists('src/utils/api.js'), false, 'api.js must be removed');

  const source = await readSource('src/utils/api.ts');
  assert.match(source, /export const getAuthToken/);
  assert.match(source, /export const authenticatedFetch/);
  assert.match(source, /export const api/);
  // Verify typed signatures present
  assert.match(source, /\(url: string, options: RequestInit/);
  assert.match(source, /Promise<Response>/);
});

test('src/i18n/config.ts exists and no longer JS', async () => {
  assert.equal(await fileExists('src/i18n/config.ts'), true, 'config.ts must exist');
  assert.equal(await fileExists('src/i18n/config.js'), false, 'config.js must be removed');

  const source = await readSource('src/i18n/config.ts');
  assert.match(source, /import i18n from 'i18next'/);
  assert.match(source, /export default i18n/);
});

test('src/i18n/languages.ts exists with typed Language interface', async () => {
  assert.equal(await fileExists('src/i18n/languages.ts'), true, 'languages.ts must exist');
  assert.equal(await fileExists('src/i18n/languages.js'), false, 'languages.js must be removed');

  const source = await readSource('src/i18n/languages.ts');
  assert.match(source, /export interface Language/);
  assert.match(source, /export const languages: Language\[\]/);
  assert.match(source, /export const isLanguageSupported/);
  // Verify language values
  assert.match(source, /value: 'en'/);
  assert.match(source, /value: 'zh-CN'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Shared files used by server keep .js + gain .d.ts types
// ─────────────────────────────────────────────────────────────────────────────

test('shared/socket-message-utils.js retains runtime + has .d.ts', async () => {
  assert.equal(await fileExists('shared/socket-message-utils.js'), true,
    'socket-message-utils.js must be kept for node test runtime');

  const dts = await readSource('shared/socket-message-utils.d.ts');
  assert.match(dts, /export declare function getMessageHistoryTailSequence/);
  assert.match(dts, /export declare function getPendingSocketMessages/);
  assert.match(dts, /export declare function reduceProjectsUpdatedMessages/);
  assert.match(dts, /export interface ReduceProjectsUpdatedParams/);
  assert.match(dts, /export interface ReduceProjectsUpdatedResult/);
});

test('shared/codex-message-normalizer.js retains runtime + has .d.ts', async () => {
  assert.equal(await fileExists('shared/codex-message-normalizer.js'), true,
    'codex-message-normalizer.js must be kept for server runtime');

  const dts = await readSource('shared/codex-message-normalizer.d.ts');
  assert.match(dts, /export declare function parseCodexJsonMaybe/);
  assert.match(dts, /export declare function normalizeCodexToolOutput/);
  assert.match(dts, /export declare function normalizeCodexRealtimeItem/);
});

test('shared/modelConstants.js retains runtime + has .d.ts', async () => {
  assert.equal(await fileExists('shared/modelConstants.js'), true,
    'modelConstants.js must be kept for server runtime');

  const dts = await readSource('shared/modelConstants.d.ts');
  assert.match(dts, /export declare const CODEX_MODELS/);
  assert.match(dts, /export declare const CODEX_REASONING_EFFORTS/);
  assert.match(dts, /export interface ReasoningEffort/);
});

test('frontend dedup and activity helpers keep .js + gain .d.ts', async () => {
  const dtsFiles = [
    'src/components/chat/utils/messageDedup.d.ts',
    'src/components/chat/utils/sessionMessageDedup.d.ts',
    'src/components/main-content/view/subcomponents/sessionActivityState.d.ts',
  ];

  for (const dtsFile of dtsFiles) {
    assert.equal(await fileExists(dtsFile), true,
      `${dtsFile} must exist to provide type coverage`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. No server TS runtime introduced
// ─────────────────────────────────────────────────────────────────────────────

test('server package scripts do not reference ts-node or tsx', async () => {
  const pkgSource = await readSource('package.json');
  const scriptsSection = pkgSource.match(/"scripts"\s*:\s*\{([^}]+)\}/s)?.[1] || '';

  assert.doesNotMatch(scriptsSection, /ts-node/,
    'server scripts must not use ts-node');
  assert.doesNotMatch(scriptsSection, /\btsx\b/,
    'server scripts must not use tsx');
});

test('server/index.js does not import .ts files', async () => {
  let serverSource;
  try {
    serverSource = await readSource('server/index.js');
  } catch {
    // server/index.js might not exist as a single entry
    return;
  }

  // Allow .js imports but not .ts
  const tsImports = serverSource.match(/require\(['"].*\.ts['"]\)/g) || [];
  const tsDynamic = serverSource.match(/import\(['"].*\.ts['"]\)/g) || [];
  assert.deepEqual([...tsImports, ...tsDynamic], [],
    'server/index.js must not import .ts files directly');
});

test('server files that depend on shared still import .js', async () => {
  const projectsSource = await readSource('server/projects.js');
  assert.match(projectsSource, /codex-message-normalizer\.js/,
    'server/projects.js must continue importing codex-message-normalizer.js');

  const codexModelsSource = await readSource('server/codex-models.js');
  assert.match(codexModelsSource, /modelConstants\.js/,
    'server/codex-models.js must continue importing modelConstants.js');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Frontend import paths updated
// ─────────────────────────────────────────────────────────────────────────────

test('App.tsx and main.jsx import i18n config without .js extension', async () => {
  const appSource = await readSource('src/App.tsx');
  assert.match(appSource, /from ['"]\.\/i18n\/config['"]/);
  assert.doesNotMatch(appSource, /from ['"]\.\/i18n\/config\.js['"]/);

  const mainSource = await readSource('src/main.jsx');
  assert.match(mainSource, /['"]\.\/i18n\/config['"]/);
  assert.doesNotMatch(mainSource, /['"]\.\/i18n\/config\.js['"]/);
});

test('LanguageSelector still imports languages', async () => {
  const selectorSource = await readSource('src/components/settings/view/controls/LanguageSelector.jsx');
  assert.match(selectorSource, /from ['"][^'"]*i18n\/languages['"]/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Node server tests can still import shared runtime
// ─────────────────────────────────────────────────────────────────────────────

test('node test for socket-message-utils imports .js successfully', async () => {
  const mod = await import('../shared/socket-message-utils.js');
  assert.equal(typeof mod.getMessageHistoryTailSequence, 'function');
  assert.equal(typeof mod.getPendingSocketMessages, 'function');
  assert.equal(typeof mod.reduceProjectsUpdatedMessages, 'function');
});

test('node test for model-constants imports .js successfully', async () => {
  const mod = await import('../shared/modelConstants.js');
  assert.ok('CODEX_MODELS' in mod);
  assert.ok('CODEX_REASONING_EFFORTS' in mod);
});
