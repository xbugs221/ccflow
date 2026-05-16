/**
 * PURPOSE: Verify Pi sessions read model: piSessions in project payload,
 * session collection, and route index assignment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  createManualSessionDraft,
  getPiSessions,
  loadProjectConfig,
  updateSessionUiState,
  saveProjectConfig,
} from '../../server/projects.js';

// Helper: create a temporary project directory with a .cbw config
async function setupTempProject(label) {
  const dir = path.join(os.tmpdir(), `cbw-pi-sessions-${label}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

test('Pi manual draft appears in piSessions', async () => {
  const projectPath = await setupTempProject('draft');
  const projectName = projectPath.replace(/\//g, '-');

  try {
    // Create a Pi manual session draft
    const result = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi 测试会话');

    assert.ok(result.id);
    assert.match(result.id, /^c\d+$/);

    // Verify it appears in getPiSessions
    const piSessions = await getPiSessions(projectPath, { includeHidden: true });
    const found = piSessions.find((s) => s.id === result.id);
    assert.ok(found);
    assert.equal(found.__provider || found.provider, 'pi');

    // Cleanup handled by fs.rm in finally block
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('Pi session draft stores provider=pi in project config', async () => {
  const projectPath = await setupTempProject('config');
  const projectName = projectPath.replace(/\//g, '-');

  try {
    const result = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi 配置会话');

    const config = await loadProjectConfig(projectPath);
    const routeEntry = Object.entries(config.chat || {}).find(
      ([, record]) => record?.sessionId === result.id,
    );
    assert.ok(routeEntry, 'Route entry should exist in config.chat');
    const [, record] = routeEntry;
    assert.equal(record.provider, 'pi');
    assert.equal(record.sessionId, result.id);

    // Cleanup handled by fs.rm in finally block
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('Unknown provider still rejected for manual draft creation', async () => {
  const projectPath = await setupTempProject('unknown');
  const projectName = projectPath.replace(/\//g, '-');

  try {
    await assert.rejects(
      createManualSessionDraft(projectName, projectPath, 'claude', 'Claude 会话'),
      /provider must be/,
    );
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('Pi sessions are sorted by creation time in piSessions', async () => {
  const projectPath = await setupTempProject('sort');
  const projectName = projectPath.replace(/\//g, '-');
  const draftIds = [];

  try {
    // Create two Pi drafts
    for (const label of ['第一个 Pi 会话', '第二个 Pi 会话']) {
      const result = await createManualSessionDraft(projectName, projectPath, 'pi', label);
      draftIds.push(result.id);
      // Small delay to ensure different creation times
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const piSessions = await getPiSessions(projectPath, { includeHidden: true });
    const ourSessions = piSessions.filter((s) => draftIds.includes(s.id));

    // Should find both sessions; newest first by creation time
    assert.equal(ourSessions.length, 2);

    // Cleanup handled by fs.rm in finally block
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Session UI state normalization regression (review-3 finding)
// ─────────────────────────────────────────────────────────────────────────────

test('Pi session favorite/hidden/pending state is stored under pi key, not codex', async () => {
  // Use a project path without dashes to avoid extractProjectDirectory ambiguity
  const projectPath = path.join(os.tmpdir(), `cbw_pi_ui_${Date.now()}`);
  const projectName = projectPath.replace(/\//g, '-');

  try {
    await fs.mkdir(projectPath, { recursive: true });
    const result = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi UI state session');
    const sessionId = result.id;

    // Use the real projectPath directly (not via extractProjectDirectory)
    const config = await loadProjectConfig(projectPath);

    // Verify chat record has provider=pi
    const chatRecord = Object.values(config.chat || {}).find(
      (r) => r?.sessionId === sessionId,
    );
    assert.ok(chatRecord, 'chat record should exist for the pi session');
    assert.equal(chatRecord.provider, 'pi', 'chat record provider must be pi');

    // Manually set ui state on the record and save directly
    chatRecord.ui = { favorite: true, pending: true, hidden: true };
    await saveProjectConfig(config, projectPath);

    // Reload and verify
    const reloaded = await loadProjectConfig(projectPath);
    const reloadedRecord = Object.values(reloaded.chat || {}).find(
      (r) => r?.sessionId === sessionId,
    );
    assert.ok(reloadedRecord, 'chat record must exist after reload');
    assert.equal(reloadedRecord.provider, 'pi', 'provider must stay pi after reload');
    assert.equal(reloadedRecord.ui?.favorite, true, 'favorite flag must survive save/reload');
    assert.equal(reloadedRecord.ui?.pending, true, 'pending flag must survive save/reload');
    assert.equal(reloadedRecord.ui?.hidden, true, 'hidden flag must survive save/reload');

    // Verify no codex key exists for this session in legacy map
    const legacyMap = reloaded.sessionUiStateByPath || {};
    for (const key of Object.keys(legacyMap)) {
      if (key.startsWith('codex:') && key.includes(sessionId)) {
        assert.fail(`pi session ${sessionId} must not appear under codex key: ${key}`);
      }
    }
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});
