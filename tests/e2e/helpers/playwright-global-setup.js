/**
 * PURPOSE: Start and stop isolated local CCUI processes for Playwright e2e.
 * This bypasses Playwright's built-in webServer health probe because on this
 * machine a TCP connect to an unused localhost port can hang instead of failing fast.
 */
import { execFileSync, spawn } from 'node:child_process';

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
