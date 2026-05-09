/**
 * PURPOSE: Manage durable Codex/OpenCode turn runtime files and event replay.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SERVER_DIR, '..');
const DEFAULT_RUNTIME_ROOT = path.join(APP_ROOT, '.ccflow', 'runtime', 'turns');
const TURN_ID_PREFIX = 't_';
const ALLOWED_PROVIDERS = new Set(['codex', 'opencode']);
const TURN_FIELDS = [
  'turnId',
  'provider',
  'status',
  'projectPath',
  'ccflowSessionId',
  'providerSessionId',
  'clientRequestId',
  'pid',
  'scopeUnit',
  'startedAt',
  'updatedAt',
];

/**
 * Return the runtime root used for provider turn files.
 */
export function getTurnRuntimeRoot() {
  return process.env.CCFLOW_TURNS_DIR || DEFAULT_RUNTIME_ROOT;
}

/**
 * Build the process command used to launch an independent runner.
 */
function buildRunnerLaunchCommand({ turnDir, encodedRequest }) {
  const runnerArgs = [path.join(SERVER_DIR, 'ccflow-runner.js'), '--turn-dir', turnDir, '--request', encodedRequest];
  if (process.env.CCFLOW_RUNNER_SYSTEMD_SCOPE === '1') {
    const scopeName = `ccflow-runner-${path.basename(turnDir)}.scope`;
    return {
      command: 'systemd-run',
      args: [
        '--user',
        '--scope',
        '--quiet',
        '--unit',
        scopeName,
        '--property',
        'KillMode=process',
        process.execPath,
        ...runnerArgs,
      ],
      detached: false,
      scopeUnit: scopeName,
    };
  }
  return {
    command: process.execPath,
    args: runnerArgs,
    detached: true,
    scopeUnit: null,
  };
}

function isSystemdScopeActive(scopeUnit) {
  if (!scopeUnit) {
    return false;
  }
  const result = spawnSync('systemctl', ['--user', 'is-active', '--quiet', scopeUnit], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

function stopSystemdScope(scopeUnit) {
  if (!scopeUnit) {
    return false;
  }
  const killResult = spawnSync('systemctl', ['--user', 'kill', '--signal=SIGTERM', scopeUnit], {
    stdio: 'ignore',
  });
  const stopResult = spawnSync('systemctl', ['--user', 'stop', scopeUnit], {
    stdio: 'ignore',
  });
  return killResult.status === 0 || stopResult.status === 0;
}

function isTurnProcessAlive(state) {
  if (state?.scopeUnit && isSystemdScopeActive(state.scopeUnit)) {
    return true;
  }
  return isPidAlive(Number(state?.pid));
}

/**
 * Validate and normalize the only provider values runner turns support.
 */
export function normalizeRunnerProvider(provider) {
  if (ALLOWED_PROVIDERS.has(provider)) {
    return provider;
  }
  throw new Error('provider must be "codex" or "opencode"');
}

/**
 * Build the minimal StartTurn request passed from the Web service to runner.
 */
export function buildStartTurnRequest(input = {}) {
  const provider = normalizeRunnerProvider(input.provider);
  const projectPath = typeof input.projectPath === 'string' && input.projectPath.trim()
    ? input.projectPath.trim()
    : process.cwd();
  return {
    provider,
    projectPath,
    prompt: typeof input.prompt === 'string' ? input.prompt : '',
    ccflowSessionId: typeof input.ccflowSessionId === 'string' ? input.ccflowSessionId : '',
    providerSessionId: typeof input.providerSessionId === 'string' ? input.providerSessionId : '',
    clientRequestId: typeof input.clientRequestId === 'string' ? input.clientRequestId : '',
    model: typeof input.model === 'string' ? input.model : '',
    reasoningEffort: typeof input.reasoningEffort === 'string' ? input.reasoningEffort : '',
    permissionMode: typeof input.permissionMode === 'string' ? input.permissionMode : '',
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
  };
}

/**
 * Keep turn.json restricted to recovery and termination fields.
 */
function toTurnState(state) {
  const minimal = {};
  for (const field of TURN_FIELDS) {
    if (state[field] !== undefined) {
      minimal[field] = state[field];
    }
  }
  return minimal;
}

/**
 * Read one turn state file, returning null when the file is absent or invalid.
 */
export async function readTurnState(turnDir) {
  try {
    const raw = await fsPromises.readFile(path.join(turnDir, 'turn.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Persist the minimal turn state atomically enough for restart scanning.
 */
export async function writeTurnState(turnDir, state) {
  const minimal = toTurnState(state);
  await fsPromises.mkdir(turnDir, { recursive: true });
  await fsPromises.writeFile(path.join(turnDir, 'turn.json'), `${JSON.stringify(minimal, null, 2)}\n`, 'utf8');
  return minimal;
}

/**
 * Append one frontend-compatible event to events.jsonl.
 */
export async function appendTurnEvent(turnDir, event) {
  await fsPromises.mkdir(turnDir, { recursive: true });
  await fsPromises.appendFile(path.join(turnDir, 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
}

/**
 * Return true when a pid currently exists on the host.
 */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start an independent runner process for one provider turn.
 */
export async function startRunnerTurn(input = {}) {
  const request = buildStartTurnRequest(input);
  const turnId = `${TURN_ID_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const turnDir = path.join(getTurnRuntimeRoot(), turnId);
  const now = new Date().toISOString();

  await fsPromises.mkdir(turnDir, { recursive: true });
  await fsPromises.writeFile(path.join(turnDir, 'events.jsonl'), '', 'utf8');
  await writeTurnState(turnDir, {
    turnId,
    provider: request.provider,
    status: 'running',
    projectPath: request.projectPath,
    ccflowSessionId: request.ccflowSessionId || null,
    providerSessionId: request.providerSessionId || null,
    clientRequestId: request.clientRequestId || null,
    pid: null,
    scopeUnit: null,
    startedAt: now,
    updatedAt: now,
  });
  const encodedRequest = Buffer.from(JSON.stringify(request), 'utf8').toString('base64url');

  const launch = buildRunnerLaunchCommand({ turnDir, encodedRequest });
  const child = spawn(launch.command, launch.args, {
    cwd: APP_ROOT,
    detached: launch.detached,
    stdio: 'ignore',
    env: {
      ...process.env,
      CCFLOW_RUNNER_TURN_DIR: turnDir,
    },
  });
  child.unref();

  const state = await writeTurnState(turnDir, {
    turnId,
    provider: request.provider,
    status: 'running',
    projectPath: request.projectPath,
    ccflowSessionId: request.ccflowSessionId || null,
    providerSessionId: request.providerSessionId || null,
    clientRequestId: request.clientRequestId || null,
    pid: child.pid,
    scopeUnit: launch.scopeUnit || null,
    startedAt: now,
    updatedAt: now,
  });

  return { turnId, turnDir, state };
}

/**
 * Tail a JSONL event file and call onEvent for each complete new line.
 */
export function tailTurnEvents(turnDir, onEvent, options = {}) {
  let offset = Number.isInteger(options.offset) ? options.offset : 0;
  let closed = false;
  const eventsFile = path.join(turnDir, 'events.jsonl');

  const readNewLines = async () => {
    /** Read only the bytes appended since the previous pass. */
    if (closed) return;
    let handle;
    try {
      handle = await fsPromises.open(eventsFile, 'r');
      const stat = await handle.stat();
      if (stat.size < offset) offset = 0;
      if (stat.size === offset) return;
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      offset = stat.size;
      for (const line of buffer.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        onEvent(JSON.parse(line));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[RunnerTurn] Failed to tail events:', error.message);
      }
    } finally {
      await handle?.close().catch(() => {});
    }
  };

  void readNewLines();
  const watcher = fs.watch(path.dirname(eventsFile), { persistent: false }, (eventType, filename) => {
    if (filename === 'events.jsonl') {
      void readNewLines();
    }
  });

  return {
    close() {
      closed = true;
      watcher.close();
    },
  };
}

/**
 * Scan runtime files and mark dead running turns stale.
 */
export async function recoverRunnerTurns(onRunningTurn) {
  const root = getTurnRuntimeRoot();
  await fsPromises.mkdir(root, { recursive: true });
  const entries = await fsPromises.readdir(root, { withFileTypes: true }).catch(() => []);
  const recovered = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const turnDir = path.join(root, entry.name);
    const state = await readTurnState(turnDir);
    if (!state || state.status !== 'running') continue;

    if (isTurnProcessAlive(state)) {
      recovered.push({ turnDir, state });
      await onRunningTurn?.(turnDir, state);
      continue;
    }

    const updated = {
      ...state,
      status: 'stale',
      updatedAt: new Date().toISOString(),
    };
    await writeTurnState(turnDir, updated);
    await appendTurnEvent(turnDir, {
      type: `${state.provider}-error`,
      provider: state.provider,
      sessionId: state.providerSessionId || state.ccflowSessionId || null,
      ccflowSessionId: state.ccflowSessionId || null,
      error: 'Runner process is no longer alive',
    });
  }

  return recovered;
}

/**
 * Terminate a running turn by asking the OS to stop the runner process group.
 */
export async function abortRunnerTurn(turnDir) {
  const state = await readTurnState(turnDir);
  if (!state) {
    return false;
  }
  const pid = Number(state.pid);
  let success = stopSystemdScope(state.scopeUnit);
  if (!success && isPidAlive(pid)) {
    try {
      process.kill(-pid, 'SIGTERM');
      success = true;
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
        success = true;
      } catch {
        success = false;
      }
    }
  }
  const updated = {
    ...state,
    status: 'aborted',
    updatedAt: new Date().toISOString(),
  };
  await writeTurnState(turnDir, updated);
  await appendTurnEvent(turnDir, {
    type: 'session-aborted',
    provider: state.provider,
    sessionId: state.providerSessionId || state.ccflowSessionId || null,
    actualSessionId: state.providerSessionId || null,
    ccflowSessionId: state.ccflowSessionId || null,
    success,
  });
  return success;
}

export const __buildRunnerLaunchCommandForTest = buildRunnerLaunchCommand;
