/**
 * PURPOSE: Start and stop isolated local CCUI processes for Playwright e2e.
 * This bypasses Playwright's built-in webServer health probe because on this
 * machine a TCP connect to an unused localhost port can hang instead of failing fast.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Create fake opsx/mc binaries for the isolated Playwright server process.
 * The scripts operate on real fixture docs/changes and .ccflow/runs files.
 * @param {string} cwd - Repository root.
 * @returns {string} Directory to prepend to PATH.
 */
function ensureWorkflowToolFixtures(cwd) {
  const binDir = path.join(cwd, '.tmp', 'playwright-workflow-bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, 'opsx'),
    [
      '#!/bin/sh',
      'changes_dir="$PWD/docs/changes"',
      'case "$1" in',
      '  --version) echo "opsx-playwright";;',
      '  list)',
      "    printf '{\"changes\":['",
      '    first=1',
      '    if [ -d "$changes_dir" ]; then',
      '      for entry in "$changes_dir"/*; do',
      '        [ -d "$entry" ] || continue',
      '        [ "$(basename "$entry")" = "archive" ] && continue',
      '        if [ "$first" -eq 0 ]; then printf ","; fi',
      '        first=0',
      "        printf '{\"name\":\"%s\"}' \"$(basename \"$entry\")\"",
      '      done',
      '    fi',
      "    printf ']}\\n';;",
      '  status)',
      '    if [ -d "$changes_dir/$2" ]; then printf \'{"name":"%s","status":"active"}\\n\' "$2"; else exit 1; fi;;',
      '  instructions) echo \'{"schemaName":"spec-driven","state":"ready","contextFiles":[],"progress":{"total":0,"completed":0,"remaining":0},"tasks":[]}\';;',
      '  validate) echo \'{"ok":true}\';;',
      '  archive) mkdir -p "$changes_dir/archive"; mv "$changes_dir/$2" "$changes_dir/archive/2026-05-06-$2"; echo \'{"ok":true}\';;',
      '  *) echo \'{}\';;',
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(binDir, 'mc'),
    [
      '#!/bin/sh',
      'run_id="playwright-run-$(date +%s%N)"',
      'if [ "$1" = "--version" ]; then echo "mc-playwright"; exit 0; fi',
      'if [ "$1" = "contract" ]; then echo \'{"version":"mc-playwright","json":true,"capabilities":["list-changes","run","resume","status","abort"]}\'; exit 0; fi',
      'if [ "$1" = "list-changes" ]; then opsx list --json; exit 0; fi',
      'if [ "$1" = "run" ]; then',
      '  change=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--change" ]; then shift; change="$1"; fi',
      '    shift || break',
      '  done',
      '  run_dir="$PWD/.ccflow/runs/$run_id"',
      '  mkdir -p "$run_dir/logs"',
      '  echo "playwright runner log" > "$run_dir/logs/executor.log"',
      '  cat > "$run_dir/state.json" <<JSON',
      '{"runId":"$run_id","changeName":"$change","status":"running","stage":"execution","stages":{"execution":"running"},"paths":{"executor_log":".ccflow/runs/$run_id/logs/executor.log"},"sessions":{},"error":""}',
      'JSON',
      '  printf \'{"runId":"%s","changeName":"%s","status":"running","stage":"execution"}\\n\' "$run_id" "$change"',
      '  (',
      '    sleep 2',
      '    echo "playwright review log" > "$run_dir/logs/reviewer.log"',
      '    cat > "$run_dir/state.json" <<JSON',
      '{"runId":"$run_id","changeName":"$change","status":"running","stage":"review_1","stages":{"execution":"completed","review_1":"running"},"paths":{"executor_log":".ccflow/runs/$run_id/logs/executor.log","reviewer_log":".ccflow/runs/$run_id/logs/reviewer.log"},"sessions":{},"error":""}',
      'JSON',
      '  ) >/dev/null 2>&1 &',
      '  exit 0',
      'fi',
      'if [ "$1" = "resume" ] || [ "$1" = "status" ] || [ "$1" = "abort" ]; then echo "usage: mc $1 --json --run-id"; exit 0; fi',
      'echo "usage: mc run resume status abort --json --run-id --change"',
    ].join('\n'),
    { mode: 0o755 },
  );
  return binDir;
}

/**
 * Check whether a URL responds successfully with a short hard timeout.
 * @param {string} url - URL to probe.
 * @returns {boolean} True when curl receives a successful response.
 */
function isUrlReady(url) {
  try {
    execFileSync(
      'curl',
      ['--silent', '--show-error', '--fail', '--noproxy', '*', '--max-time', '1', url],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait until a URL becomes reachable or throw after timeout.
 * @param {string} url - URL to wait for.
 * @param {number} timeoutMs - Maximum wait time.
 * @param {{ label?: string, child?: import('node:child_process').ChildProcess, stdout?: () => string, stderr?: () => string }} [options]
 */
async function waitForUrl(url, timeoutMs, options = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (isUrlReady(url)) {
      return;
    }

    if (options.child && options.child.exitCode !== null) {
      const stdout = options.stdout?.() || '';
      const stderr = options.stderr?.() || '';
      throw new Error(
        `${options.label || 'Child process'} exited before ${url} became ready.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const stdout = options.stdout?.() || '';
  const stderr = options.stderr?.() || '';
  throw new Error(`Timed out waiting for ${url}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

/**
 * Terminate a spawned process with escalation.
 * @param {import('node:child_process').ChildProcess} child - Spawned process.
 */
async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);

  if (child.exitCode === null && !child.killed) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
}

/**
 * Bootstrap the isolated API server and Vite dev server before tests.
 */
export default async function globalSetup() {
  const cwd = process.cwd();
  const host = process.env.PLAYWRIGHT_HOST || '127.0.0.1';
  const serverPort = process.env.PLAYWRIGHT_SERVER_PORT || '4101';
  const vitePort = process.env.PLAYWRIGHT_VITE_PORT || '6174';
  const serverUrl = `http://${host}:${serverPort}/api/auth/status`;
  const viteUrl = `http://${host}:${vitePort}/`;
  const childEnv = {
    ...process.env,
    PORT: serverPort,
    VITE_PORT: vitePort,
  };
  childEnv.PATH = `${ensureWorkflowToolFixtures(cwd)}:${childEnv.PATH || ''}`;

  let serverProcess = null;
  let viteProcess = null;
  let serverSpawnError = null;
  let viteSpawnError = null;
  let serverStdout = '';
  let serverStderr = '';
  let viteStdout = '';
  let viteStderr = '';

  if (!isUrlReady(serverUrl)) {
    serverProcess = spawn('pnpm', ['run', 'server'], {
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    serverProcess.on('error', (error) => { serverSpawnError = error; });
    serverProcess.stdout?.on('data', (chunk) => { serverStdout += chunk.toString(); });
    serverProcess.stderr?.on('data', (chunk) => { serverStderr += chunk.toString(); });
  }

  await waitForUrl(serverUrl, 30_000, {
    label: 'Server process',
    child: serverProcess,
    stdout: () => serverStdout,
    stderr: () => [serverStderr, serverSpawnError?.stack || serverSpawnError?.message || ''].filter(Boolean).join('\n'),
  });

  if (!isUrlReady(viteUrl)) {
    viteProcess = spawn('pnpm', ['exec', 'vite', '--host', host, '--port', vitePort], {
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    viteProcess.on('error', (error) => { viteSpawnError = error; });
    viteProcess.stdout?.on('data', (chunk) => { viteStdout += chunk.toString(); });
    viteProcess.stderr?.on('data', (chunk) => { viteStderr += chunk.toString(); });
  }

  await waitForUrl(viteUrl, 30_000, {
    label: 'Vite process',
    child: viteProcess,
    stdout: () => viteStdout,
    stderr: () => [viteStderr, viteSpawnError?.stack || viteSpawnError?.message || ''].filter(Boolean).join('\n'),
  });

  return async () => {
    await stopProcess(viteProcess);
    await stopProcess(serverProcess);
  };
}
