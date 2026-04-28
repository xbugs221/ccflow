/**
 * PURPOSE: Provide isolated filesystem fixtures for conf.json v2 acceptance tests.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearProjectDirectoryCache,
} from '../../../server/projects.js';

let homeIsolationQueue = Promise.resolve();

/**
 * Run one acceptance test with an isolated HOME and project directory.
 * @param {(ctx: {homeDir: string, projectPath: string}) => Promise<void>} testBody
 * @returns {Promise<void>}
 */
export async function withIsolatedProject(testBody) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-conf-v2-'));
    const projectPath = path.join(homeDir, 'workspace', 'project');

    process.env.HOME = homeDir;
    clearProjectDirectoryCache();
    await fs.mkdir(projectPath, { recursive: true });

    try {
      await testBody({ homeDir, projectPath });
    } finally {
      clearProjectDirectoryCache();
      if (originalHome) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  };

  const runPromise = homeIsolationQueue.then(run, run);
  homeIsolationQueue = runPromise.catch(() => {});
  return runPromise;
}

/**
 * Read the project-local ccflow config JSON.
 * @param {string} projectPath - Project root path.
 * @returns {Promise<object>} Parsed config.
 */
export async function readProjectConf(projectPath) {
  const confPath = path.join(projectPath, '.ccflow', 'conf.json');
  return JSON.parse(await fs.readFile(confPath, 'utf8'));
}

/**
 * Create a minimal Codex transcript with a real first user instruction.
 * @param {string} homeDir - Test HOME directory.
 * @param {string} projectPath - Project root path.
 * @param {string} sessionId - Codex session id.
 * @param {string} firstInstruction - First user instruction.
 * @returns {Promise<string>} Transcript path.
 */
export async function createCodexTranscript(homeDir, projectPath, sessionId, firstInstruction) {
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '25');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-25T08:00:00.000Z',
        payload: { id: sessionId, cwd: projectPath },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-25T08:00:01.000Z',
        payload: { type: 'user_message', message: firstInstruction },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
  return sessionPath;
}
