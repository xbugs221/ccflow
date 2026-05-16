// @ts-nocheck -- Migration baseline: JS-to-TS rename complete. Types will be tightened incrementally.
/**
 * OpenCode SDK Integration
 * =========================
 *
 * This module provides integration with the OpenCode CLI for non-interactive
 * chat sessions. It mirrors the pattern used in openai-codex.js for consistency.
 *
 * ## Usage
 *
 * - queryOpencode(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortOpencodeSession(sessionId) - Cancel an active session
 * - isOpencodeSessionActive(sessionId) - Check if a session is running
 * - getActiveOpencodeSessions() - List all active sessions
 * - enqueueSteer(sessionId, content) - Add steer message to queue
 * - processSteerQueue(sessionId) - Process steer queue after step_finish
 */

import { spawn } from 'child_process';
import readline from 'readline';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SERVER_DIR, '..');

// Track active sessions
const activeOpencodeSessions = new Map();
const steerQueues = new Map();

const CCFLOW_ROUTE_SESSION_PATTERN = /^c\d+$/;

function isCcflowRouteSessionId(sessionId) {
  return typeof sessionId === 'string' && CCFLOW_ROUTE_SESSION_PATTERN.test(sessionId.trim());
}

/**
 * Return true when a path points to a runnable file for the current platform.
 */
function isRunnableFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build platform-specific executable names for a command.
 */
function getExecutableNames(commandName) {
  if (process.platform !== 'win32') {
    return [commandName];
  }

  const extension = path.extname(commandName);
  if (extension) {
    return [commandName];
  }

  const pathExt = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return [
    commandName,
    ...pathExt
      .split(';')
      .map((ext) => ext.trim())
      .filter(Boolean)
      .map((ext) => `${commandName}${ext.toLowerCase()}`),
  ];
}

/**
 * Resolve one command name through an explicit PATH string.
 */
function resolveCommandFromPath(commandName, pathValue) {
  if (!commandName || commandName.includes(path.sep) || (path.sep === '/' && commandName.includes('\\'))) {
    return isRunnableFile(commandName) ? commandName : '';
  }

  for (const dir of String(pathValue || '').split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    for (const executableName of getExecutableNames(commandName)) {
      const candidate = path.join(dir, executableName);
      if (isRunnableFile(candidate)) {
        return candidate;
      }
    }
  }
  return '';
}

/**
 * Return project roots whose local node_modules/.bin directory may contain
 * the opencode CLI when the server process was not started through an npm script.
 */
function getLocalBinRoots(env = process.env, cwd = process.cwd()) {
  const roots = [cwd, APP_ROOT, env.INIT_CWD].filter(Boolean).map((entry) => path.resolve(entry));
  return [...new Set(roots)];
}

/**
 * Resolve the OpenCode CLI path, preferring explicit configuration, then PATH,
 * then local dependency bins installed beside this application.
 */
export function resolveOpencodeCliPath(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const override = typeof env.OPENCODE_CLI_PATH === 'string' ? env.OPENCODE_CLI_PATH.trim() : '';
  if (override) {
    return override;
  }

  const fromPath = resolveCommandFromPath('opencode', env.PATH);
  if (fromPath) {
    return fromPath;
  }

  for (const root of getLocalBinRoots(env, cwd)) {
    const binDir = path.join(root, 'node_modules', '.bin');
    for (const executableName of getExecutableNames('opencode')) {
      const candidate = path.join(binDir, executableName);
      if (isRunnableFile(candidate)) {
        return candidate;
      }
    }
  }

  return 'opencode';
}

/**
 * Convert a child_process ENOENT into an actionable deployment error.
 */
export function formatOpencodeCliNotFoundMessage(cliPath, env = process.env) {
  return [
    `OpenCode CLI executable not found: ${cliPath || 'opencode'}.`,
    'Install opencode for this deployment, expose opencode on the service PATH, or set OPENCODE_CLI_PATH to the absolute opencode executable path.',
    `PATH=${env.PATH || ''}`,
    `HOME=${env.HOME || os.homedir()}`,
  ].join(' ');
}

/**
 * Transform OpenCode CLI event to WebSocket message format
 * @param {object} event - OpenCode CLI event
 * @returns {object} - Transformed event for WebSocket
 */
export function transformOpencodeEvent(event) {
  if (!event || typeof event !== 'object') {
    return { type: 'item', itemType: 'unknown', item: event };
  }

  const eventType = event.type;
  const part = event.part || {};

  switch (eventType) {
    case 'step_start':
      return { type: 'turn_started' };

    case 'text':
      return {
        type: 'item',
        itemType: 'agent_message',
        itemId: part.id || part.messageID || null,
        message: {
          role: 'assistant',
          content: part.text || '',
        },
      };

    case 'tool_call':
      return {
        type: 'item',
        itemType: 'command_execution',
        itemId: part.id || null,
        command: part.name || '[tool unavailable]',
        output: part.arguments || '',
        lifecycle: 'started',
      };

    case 'tool_result':
      return {
        type: 'item',
        itemType: 'command_execution',
        itemId: part.id || null,
        command: part.name || '[tool unavailable]',
        output: part.result || '',
        lifecycle: 'completed',
      };

    case 'step_finish':
      return {
        type: 'turn_complete',
        usage: part.tokens || {},
      };

    case 'error':
      return {
        type: 'error',
        message: part.message || event.message || 'OpenCode error',
      };

    default:
      return {
        type: 'item',
        itemType: 'unknown',
        item: event,
      };
  }
}

/**
 * Build OpenCode CLI arguments for one turn execution.
 * @param {object} params - Argument builder input.
 * @param {string} params.command - User prompt.
 * @param {string|null|undefined} params.sessionId - Existing session id.
 * @param {string|null|undefined} params.workingDirectory - Working directory.
 * @returns {string[]} OpenCode CLI argument array.
 */
function buildOpencodeExecArgs({
  command,
  sessionId,
  workingDirectory,
}) {
  const args = ['run', '--format', 'json'];

  if (workingDirectory) {
    args.push('--dir', workingDirectory);
  }

  if (sessionId) {
    args.push('--session', sessionId, '--continue');
  }

  if (command?.trim()) {
    args.push(command);
  }

  return args;
}

/**
 * Build the environment for one OpenCode CLI subprocess.
 * @param {string|null|undefined} workingDirectory - Active OpenCode session directory.
 * @returns {NodeJS.ProcessEnv} Environment for the spawned OpenCode CLI process.
 */
function buildOpencodeChildEnv(workingDirectory) {
  const childEnv = { ...process.env };
  delete childEnv.CLAUDECODE;
  delete childEnv.CODEX_THREAD_ID;
  delete childEnv.CODEX_SESSION_ID;

  if (workingDirectory) {
    childEnv.CONTEXT_MODE_PROJECT_DIR = workingDirectory;
  }

  return childEnv;
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[OpenCode] Error sending message:', error);
  }
}

/**
 * Run OpenCode CLI with streaming
 */
async function runOpencodeCli({
  command,
  sessionId,
  workingDirectory,
  timeoutMs,
  signal,
  onEvent,
}) {
  const childEnv = buildOpencodeChildEnv(workingDirectory);

  return await new Promise((resolve, reject) => {
    const args = buildOpencodeExecArgs({
      command,
      sessionId,
      workingDirectory,
    });

    const opencodeCliPath = resolveOpencodeCliPath({ env: childEnv });
    const child = spawn(opencodeCliPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });

    let currentSessionId = sessionId || null;
    let stderr = '';
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortListener && signal) {
        signal.removeEventListener('abort', abortListener);
      }
      if (err) reject(err);
      else resolve(result);
    };

    const effectiveTimeoutMs = Number(timeoutMs);
    const hasTimeout = Number.isFinite(effectiveTimeoutMs) && effectiveTimeoutMs > 0;
    const timer = hasTimeout ? setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      const details = stderr.trim();
      finish(new Error(
        details
          ? `OpenCode CLI timeout after ${Math.floor(effectiveTimeoutMs / 1000)}s: ${details}`
          : `OpenCode CLI timeout after ${Math.floor(effectiveTimeoutMs / 1000)}s`,
      ));
    }, effectiveTimeoutMs) : null;

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      if (!line?.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof onEvent === 'function') {
        onEvent(event);
      }

      if (event.sessionID && !currentSessionId) {
        currentSessionId = event.sessionID;
      }

      if (event.type === 'error') {
        finish(new Error(event.part?.message || event.message || 'OpenCode error'));
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (err?.code === 'ENOENT') {
        finish(new Error(formatOpencodeCliNotFoundMessage(opencodeCliPath, childEnv)));
        return;
      }
      finish(err);
    });

    child.on('close', (code) => {
      rl.close();
      if (code !== 0) {
        const details = stderr.trim() || `opencode exited with code ${code}`;
        finish(new Error(details));
        return;
      }
      finish(null, {
        sessionId: currentSessionId,
      });
    });

    let abortListener = null;
    if (signal) {
      abortListener = () => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }
  });
}

/**
 * Steer queue management
 */

export function enqueueSteer(sessionId, content) {
  if (!steerQueues.has(sessionId)) {
    steerQueues.set(sessionId, []);
  }
  const queue = steerQueues.get(sessionId);
  queue.push({ content, status: 'queued' });
  return { status: 'accepted', position: queue.length };
}

export function getSteerQueue(sessionId) {
  return steerQueues.get(sessionId) || [];
}

export function clearSteerQueue(sessionId) {
  steerQueues.delete(sessionId);
}

export function markSteerStatus(sessionId, index, status) {
  const queue = steerQueues.get(sessionId);
  if (queue && index >= 0 && index < queue.length) {
    queue[index].status = status;
  }
}

/**
 * Process steer queue after step_finish
 * @returns {Promise<boolean>} - Whether a steer was processed
 */
export async function processSteerQueue(sessionId, ws, workingDirectory) {
  const queue = steerQueues.get(sessionId);
  if (!queue || queue.length === 0) {
    return false;
  }

  const steerItem = queue.shift();
  if (!steerItem) {
    return false;
  }

  steerItem.status = 'injected';

  try {
    const session = activeOpencodeSessions.get(sessionId);
    if (!session || session.status !== 'running') {
      steerItem.status = 'failed';
      sendMessage(ws, {
        type: 'opencode-steer-failed',
        sessionId,
        error: 'Session is no longer active',
      });
      return false;
    }

    const abortController = session.abortController;

    await runOpencodeCli({
      command: steerItem.content,
      sessionId,
      workingDirectory,
      timeoutMs: Number(process.env.OPENCODE_RUN_TIMEOUT_MS || 600000),
      signal: abortController.signal,
      onEvent: (event) => {
        const transformed = transformOpencodeEvent(event);
        if (event?.type === 'step_start' || event?.type === 'text' || event?.type === 'tool_call' || event?.type === 'tool_result' || event?.type === 'step_finish') {
          sendMessage(ws, {
            type: 'opencode-response',
            data: transformed,
            sessionId,
          });
        }

        if (event?.type === 'step_finish') {
          // Process next steer in queue after this step completes
          setImmediate(() => {
            processSteerQueue(sessionId, ws, workingDirectory).catch((error) => {
              console.warn('[OpenCode] Steer queue processing error:', error.message);
            });
          });
        }
      },
    });

    return true;
  } catch (error) {
    steerItem.status = 'failed';
    console.error('[OpenCode] Steer injection failed:', error);
    sendMessage(ws, {
      type: 'opencode-steer-failed',
      sessionId,
      error: error.message,
    });
    return false;
  }
}

/**
 * Execute an OpenCode query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
export async function queryOpencode(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    clientRequestId,
  } = options;
  const requestId = typeof clientRequestId === 'string' ? clientRequestId : null;

  const workingDirectory = cwd || projectPath || process.cwd();
  const providerSessionId = isCcflowRouteSessionId(sessionId) ? '' : sessionId;
  let currentSessionId = providerSessionId;
  let sessionCreatedSent = false;
  const abortController = new AbortController();
  const runTimeoutMs = Number(process.env.OPENCODE_RUN_TIMEOUT_MS || 600000);
  let failed = false;

  try {
    currentSessionId = providerSessionId || `opencode-${Date.now()}`;

    // Track the session
    activeOpencodeSessions.set(currentSessionId, {
      status: 'running',
      abortController,
      startedAt: new Date().toISOString(),
      projectPath: workingDirectory,
    });

    // For resumed sessions, emit session-created early
    if (providerSessionId) {
      sendMessage(ws, {
        type: 'session-created',
        sessionId: currentSessionId,
        provider: 'opencode',
        clientRequestId: requestId,
      });
      sessionCreatedSent = true;
      if (typeof ws?.setSessionId === 'function') {
        ws.setSessionId(currentSessionId);
      }
    }

    const result = await runOpencodeCli({
      command,
      sessionId: providerSessionId,
      workingDirectory,
      timeoutMs: runTimeoutMs,
      signal: abortController.signal,
      onEvent: (event) => {
        if (event?.sessionID && !providerSessionId) {
          const resolvedSessionId = event.sessionID;
          if (resolvedSessionId !== currentSessionId) {
            const existingSession = activeOpencodeSessions.get(currentSessionId);
            if (existingSession) {
              activeOpencodeSessions.delete(currentSessionId);
              activeOpencodeSessions.set(resolvedSessionId, existingSession);
            }
            currentSessionId = resolvedSessionId;
          }
        }

        if (!sessionCreatedSent && currentSessionId) {
          sendMessage(ws, {
            type: 'session-created',
            sessionId: currentSessionId,
            provider: 'opencode',
            clientRequestId: requestId,
          });
          sessionCreatedSent = true;
          if (typeof ws?.setSessionId === 'function') {
            ws.setSessionId(currentSessionId);
          }
        }

        const transformed = transformOpencodeEvent(event);
        if (event?.type === 'step_start' || event?.type === 'text' || event?.type === 'tool_call' || event?.type === 'tool_result' || event?.type === 'step_finish') {
          sendMessage(ws, {
            type: 'opencode-response',
            data: transformed,
            sessionId: currentSessionId,
          });
        }

        if (event?.type === 'step_finish') {
          // Process steer queue after step completes
          const session = activeOpencodeSessions.get(currentSessionId);
          if (session) {
            setImmediate(() => {
              processSteerQueue(currentSessionId, ws, workingDirectory).catch((error) => {
                console.warn('[OpenCode] Steer queue processing error:', error.message);
              });
            });
          }
        }
      },
    });

    const resolvedSessionId = result.sessionId || currentSessionId;
    if (resolvedSessionId !== currentSessionId) {
      const existingSession = activeOpencodeSessions.get(currentSessionId);
      if (existingSession) {
        activeOpencodeSessions.delete(currentSessionId);
        activeOpencodeSessions.set(resolvedSessionId, existingSession);
      }
      currentSessionId = resolvedSessionId;
    }

    if (!sessionCreatedSent) {
      sendMessage(ws, {
        type: 'session-created',
        sessionId: currentSessionId,
        provider: 'opencode',
        clientRequestId: requestId,
      });
      sessionCreatedSent = true;
      if (typeof ws?.setSessionId === 'function') {
        ws.setSessionId(currentSessionId);
      }
    }

    // Send completion event
    sendMessage(ws, {
      type: 'opencode-complete',
      sessionId: currentSessionId,
      actualSessionId: currentSessionId,
    });

    // If steer queue has items, they will be processed by the step_finish handler
    // If no steer items, clean up
    const queue = steerQueues.get(currentSessionId);
    if (!queue || queue.length === 0) {
      clearSteerQueue(currentSessionId);
    }

    return currentSessionId;
  } catch (error) {
    const session = currentSessionId ? activeOpencodeSessions.get(currentSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      failed = true;
      console.error('[OpenCode] Error:', error);
      sendMessage(ws, {
        type: 'opencode-error',
        error: error.message,
        sessionId: currentSessionId,
      });
    }
    throw error;
  } finally {
    // Update session status
    if (currentSessionId) {
      const session = activeOpencodeSessions.get(currentSessionId);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : failed ? 'failed' : 'completed';
      }
    }
  }
}

/**
 * Abort an active OpenCode session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortOpencodeSession(sessionId) {
  const session = activeOpencodeSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[OpenCode] Failed to abort session ${sessionId}:`, error);
  }

  clearSteerQueue(sessionId);
  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isOpencodeSessionActive(sessionId) {
  const session = activeOpencodeSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveOpencodeSessions() {
  const sessions = [];

  for (const [id, session] of activeOpencodeSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt,
        projectPath: session.projectPath || '',
      });
    }
  }

  return sessions;
}

// Clean up old completed sessions periodically
const activeOpencodeSessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeOpencodeSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeOpencodeSessions.delete(id);
        clearSteerQueue(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
activeOpencodeSessionCleanupTimer.unref?.();

export const __transformOpencodeEventForTest = transformOpencodeEvent;
export const __buildOpencodeExecArgsForTest = buildOpencodeExecArgs;
export const __buildOpencodeChildEnvForTest = buildOpencodeChildEnv;
export const __resolveOpencodeCliPathForTest = resolveOpencodeCliPath;
export const __formatOpencodeCliNotFoundMessageForTest = formatOpencodeCliNotFoundMessage;
export const __opencodeCliInternalsForTest = {
  resolveCommandFromPath,
  getExecutableNames,
};
