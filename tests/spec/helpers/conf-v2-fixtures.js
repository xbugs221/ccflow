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
    const originalPath = process.env.PATH;
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-conf-v2-'));
    const binDir = path.join(homeDir, 'bin');
    const projectPath = path.join(homeDir, 'workspace', 'project');

    process.env.HOME = homeDir;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
    clearProjectDirectoryCache();
    await fs.mkdir(projectPath, { recursive: true });
    await writeFakeGoWorkflowTools(binDir);

    try {
      await testBody({ homeDir, projectPath });
    } finally {
      clearProjectDirectoryCache();
      process.env.PATH = originalPath || '';
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
 * Write fake Go workflow CLIs for conf-v2 tests that create workflows.
 */
async function writeFakeGoWorkflowTools(binDir) {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'ox'),
    [
      '#!/bin/sh',
      'PATH="/usr/bin:/bin:$PATH"',
      'changes_dir="$PWD/docs/changes"',
      'if [ "$1" = "--version" ]; then echo ox-conf-test; exit 0; fi',
      'if [ "$1" = "list" ]; then',
      "  printf '{\"changes\":['",
      '  first=1',
      '  if [ -d "$changes_dir" ]; then',
      '    for entry in "$changes_dir"/*; do',
      '      [ -d "$entry" ] || continue',
      '      [ "$(basename "$entry")" = "archive" ] && continue',
      '      if [ "$first" -eq 0 ]; then printf ","; fi',
      '      first=0',
      "      printf '{\"name\":\"%s\"}' \"$(basename \"$entry\")\"",
      '    done',
      '  fi',
      "  printf ']}\\n'",
      '  exit 0',
      'fi',
      'if [ "$1" = "status" ]; then',
      '  if [ -d "$changes_dir/$2" ]; then printf \'{"name":"%s","status":"active"}\\n\' "$2"; else exit 1; fi',
      '  exit 0',
      'fi',
      'echo \'{}\'',
    ].join('\n'),
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(binDir, 'mc'),
    [
      '#!/bin/sh',
      'PATH="/usr/bin:/bin:$PATH"',
      'run_id="conf-test-run-$(date +%s%N)"',
      'if [ "$1" = "--version" ]; then echo mc-conf-test; exit 0; fi',
      'if [ "$1" = "run" ]; then',
      '  change=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--change" ]; then shift; change="$1"; fi',
      '    shift || break',
      '  done',
      '  run_dir="$PWD/.ccflow/runs/$run_id"',
      '  mkdir -p "$run_dir/logs"',
      '  echo log > "$run_dir/logs/executor.log"',
      '  cat > "$run_dir/state.json" <<JSON',
      '{"runId":"$run_id","changeName":"$change","status":"running","stage":"execution","stages":{"execution":"running"},"paths":{"executor_log":".ccflow/runs/$run_id/logs/executor.log"},"sessions":{},"error":""}',
      'JSON',
      '  printf \'{"runId":"%s","changeName":"%s","status":"running","stage":"execution"}\\n\' "$run_id" "$change"',
      '  exit 0',
      'fi',
      'echo "usage: mc run resume status abort --json --run-id --change"',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/**
 * Create a valid docs/ OpenSpec change for Go-backed workflow tests.
 */
export async function writeActiveOpenSpecChange(projectPath, changeName = 'conf-v2-change') {
  const changeRoot = path.join(projectPath, 'docs', 'changes', changeName);
  await fs.mkdir(path.join(changeRoot, 'specs'), { recursive: true });
  await fs.writeFile(path.join(changeRoot, 'proposal.md'), '# proposal\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'design.md'), '# design\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [ ] conf v2 workflow\n', 'utf8');
  return changeName;
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
