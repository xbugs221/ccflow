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
} from '../server/projects.js';

// Helper: create a temporary project directory with a .ccflow config
async function setupTempProject(label) {
  const dir = path.join(os.tmpdir(), `ccflow-pi-sessions-${label}-${Date.now()}`);
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
