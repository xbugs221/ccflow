/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the pattern used in claude-sdk.js for consistency.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import {
  buildSessionTokenUsagePayload,
  getCodexSessionTokenUsage,
} from './session-token-usage.js';
import { appendAttachmentNote } from './chat-attachments.js';
import {
  formatCodexCliNotFoundMessage,
  resolveCodexCliPath,
} from './codex-cli.js';

// Track active sessions
const activeCodexSessions = new Map();
let shellProxyEnvPromise = null;
const CODEX_SESSIONS_ROOT = process.env.CODEX_SESSIONS_DIR || path.join(os.homedir(), '.codex', 'sessions');
const CCFLOW_ROUTE_SESSION_PATTERN = /^c\d+$/;

function isCcflowRouteSessionId(sessionId) {
  return typeof sessionId === 'string' && CCFLOW_ROUTE_SESSION_PATTERN.test(sessionId.trim());
}

function normalizeCodexPermissionMode(permissionMode) {
  if (permissionMode === 'acceptEdits' || permissionMode === 'bypassPermissions' || permissionMode === 'default') {
    return permissionMode;
  }
  return 'default';
}

/**
 * Transform Codex SDK event to WebSocket message format
 * @param {object} event - SDK event
 * @returns {object} - Transformed event for WebSocket
 */
function transformCodexEvent(event) {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return { type: event.type, item: null };
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            itemId: item.id || item.message_id || null,
            message: {
              role: 'assistant',
              content: item.text,
              phase: typeof item.phase === 'string' ? item.phase : undefined,
            },
          };

        case 'reasoning':
          return {
            type: 'item',
            itemType: 'reasoning',
            itemId: item.id || item.message_id || null,
            message: {
              role: 'assistant',
              content: item.text,
              isReasoning: true
            }
          };

        case 'command_execution':
          return {
            type: 'item',
            itemType: 'command_execution',
            itemId: item.id || item.call_id || null,
            command: item.command || item.command_line || '[command unavailable]',
            output: item.aggregated_output ?? item.output ?? '',
            exitCode: item.exit_code,
            lifecycle: event.type,
            status: item.status
          };

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            itemId: item.id || item.call_id || null,
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            itemId: item.id || item.call_id || null,
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

export const __transformCodexEventForTest = transformCodexEvent;

/**
 * Map permission mode to Codex SDK options
 * @param {string} permissionMode - 'default', 'acceptEdits', or 'bypassPermissions'
 * @returns {object} - { sandboxMode, approvalPolicy }
 */
function mapPermissionModeToCodexOptions(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'untrusted'
      };
  }
}

async function resolveShellProxyEnv() {
  if (shellProxyEnvPromise) {
    return shellProxyEnvPromise;
  }

  shellProxyEnvPromise = new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/sh';
    const child = spawn(shell, ['-lc', 'env -0'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });

    let stdout = Buffer.alloc(0);
    let settled = false;

    const finish = (env) => {
      if (settled) return;
      settled = true;
      resolve(env || {});
    };

    child.stdout?.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
    });

    child.on('error', () => finish({}));

    child.on('close', (code) => {
      if (code !== 0) {
        finish({});
        return;
      }

      const text = stdout.toString('utf8');
      if (!text) {
        finish({});
        return;
      }

      const keys = new Set([
        'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
        'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'
      ]);
      const shellProxyEnv = {};

      for (const entry of text.split('\0')) {
        if (!entry) continue;
        const idx = entry.indexOf('=');
        if (idx <= 0) continue;
        const key = entry.slice(0, idx);
        if (!keys.has(key)) continue;
        shellProxyEnv[key] = entry.slice(idx + 1);
      }

      finish(shellProxyEnv);
    });
  });

  return shellProxyEnvPromise;
}

/**
 * Locate the persisted Codex transcript for one session id.
 * Resume validation relies on Codex's own session metadata rather than route-derived UI state.
 *
 * @param {string} sessionId
 * @param {string} rootDir
 * @returns {Promise<string|null>}
 */
async function findCodexSessionTranscript(sessionId, rootDir = CODEX_SESSIONS_ROOT) {
  if (!sessionId) {
    return null;
  }

  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.includes(sessionId)) {
        return fullPath;
      }
    }
  }

  return null;
}

/**
 * Read the recorded session cwd from the transcript metadata header.
 *
 * @param {string} sessionId
 * @param {string} rootDir
 * @returns {Promise<string>}
 */
async function readCodexSessionWorkingDirectory(sessionId, rootDir = CODEX_SESSIONS_ROOT) {
  const transcriptPath = await findCodexSessionTranscript(sessionId, rootDir);
  if (!transcriptPath) {
    return '';
  }

  const raw = await fs.readFile(transcriptPath, 'utf8');
  const [firstLine = ''] = raw.split('\n');
  if (!firstLine.trim()) {
    return '';
  }

  const parsed = JSON.parse(firstLine);
  return typeof parsed?.payload?.cwd === 'string' ? parsed.payload.cwd : '';
}

/**
 * Block resumed Codex sessions from silently switching across unrelated project roots.
 *
 * @param {string|null|undefined} sessionId
 * @param {string} workingDirectory
 * @param {string} rootDir
 * @returns {Promise<void>}
 */
async function assertResumeSessionWorkingDirectory(sessionId, workingDirectory, rootDir = CODEX_SESSIONS_ROOT) {
  if (!sessionId || !workingDirectory) {
    return;
  }

  const persistedCwd = await readCodexSessionWorkingDirectory(sessionId, rootDir);
  if (!persistedCwd) {
    return;
  }

  const normalizedPersistedCwd = path.resolve(persistedCwd);
  const normalizedRequestedCwd = path.resolve(workingDirectory);
  if (normalizedPersistedCwd === normalizedRequestedCwd) {
    return;
  }

  throw new Error(
    `Cannot resume Codex session ${sessionId} in ${normalizedRequestedCwd}: the recorded session cwd is ${normalizedPersistedCwd}. Start a new session instead.`,
  );
}

async function runCodexCliFallback({
  command,
  sessionId,
  workingDirectory,
  model,
  sandboxMode,
  approvalPolicy,
  timeoutMs,
  signal,
  onEvent
}) {
  const shellProxyEnv = await resolveShellProxyEnv();
  const childEnv = buildCodexChildEnv(shellProxyEnv, workingDirectory);

  return await new Promise((resolve, reject) => {
    const args = buildCodexExecArgs({
      command,
      sessionId,
      workingDirectory,
      model,
      sandboxMode,
      approvalPolicy,
    });

    const codexCliPath = resolveCodexCliPath({ env: childEnv });
    const child = spawn(codexCliPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv
    });
    let threadId = sessionId || null;
    let usage = null;
    const items = [];
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
          ? `Codex CLI fallback timeout after ${Math.floor(effectiveTimeoutMs / 1000)}s: ${details}`
          : `Codex CLI fallback timeout after ${Math.floor(effectiveTimeoutMs / 1000)}s`
      ));
    }, effectiveTimeoutMs) : null;

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
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

      if (event.type === 'thread.started') {
        threadId = event.thread_id || event.id || threadId;
      } else if (event.type === 'item.completed' && event.item) {
        items.push(event.item);
      } else if (event.type === 'turn.completed' && event.usage) {
        usage = event.usage;
      } else if (event.type === 'turn.failed') {
        finish(new Error(event.error?.message || 'Codex turn failed'));
      } else if (event.type === 'error') {
        finish(new Error(event.message || 'Codex error'));
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (err?.code === 'ENOENT') {
        finish(new Error(formatCodexCliNotFoundMessage(codexCliPath, childEnv)));
        return;
      }
      finish(err);
    });

    child.on('close', (code) => {
      rl.close();
      if (code !== 0) {
        const details = stderr.trim() || `codex exited with code ${code}`;
        finish(new Error(details));
        return;
      }
      finish(null, {
        threadId,
        turn: { items, usage }
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
 * Build the environment for one Codex CLI subprocess.
 * Keep shell-derived proxy variables, drop nested Claude markers, and bind
 * context-mode MCP servers to the active Codex working directory.
 *
 * @param {object} shellProxyEnv - Proxy-related variables resolved from the login shell.
 * @param {string|null|undefined} workingDirectory - Active Codex session directory.
 * @returns {NodeJS.ProcessEnv} Environment for the spawned Codex CLI process.
 */
function buildCodexChildEnv(shellProxyEnv = {}, workingDirectory) {
  const childEnv = { ...process.env, ...shellProxyEnv };
  // Remove CLAUDECODE so the codex subprocess is not mistaken for a nested
  // Claude Code session (same guard that caused exit-code-1 in claude-sdk.js).
  // Preserve the active shell/system proxy configuration rather than forcing a
  // fixed localhost port that may not exist on the current machine.
  delete childEnv.CLAUDECODE;
  delete childEnv.CODEX_THREAD_ID;
  delete childEnv.CODEX_SESSION_ID;

  if (workingDirectory) {
    // context-mode falls back to process.cwd() when no project dir env is set.
    // Pin it to the active Codex working directory so MCP shell tools execute
    // inside the session project instead of the host server cwd.
    childEnv.CONTEXT_MODE_PROJECT_DIR = workingDirectory;
  }

  return childEnv;
}

/**
 * Build Codex CLI arguments for one turn execution.
 * When resuming an existing session, model must not be passed because the
 * thread model is already fixed server-side by Codex.
 * @param {object} params - Argument builder input.
 * @param {string} params.command - User prompt.
 * @param {string|null|undefined} params.sessionId - Existing session id.
 * @param {string} params.workingDirectory - Working directory.
 * @param {string|null|undefined} params.model - Requested model.
 * @param {string|null|undefined} params.reasoningEffort - Requested reasoning effort.
 * @param {string|null|undefined} params.sandboxMode - Sandbox mode.
 * @param {string|null|undefined} params.approvalPolicy - Approval policy.
 * @returns {string[]} Codex CLI argument array.
 */
function buildCodexExecArgs({
  command,
  sessionId,
  workingDirectory,
  model,
  reasoningEffort,
  sandboxMode,
  approvalPolicy,
}) {
  const args = ['exec', '--json'];

  // Resumed threads keep their original model, passing --model can trigger
  // mismatch errors such as resuming a thread with a different requested model.
  if (model && !sessionId) {
    args.push('--model', model);
  }

  if (reasoningEffort) {
    args.push('-c', `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
  }

  if (sandboxMode) {
    args.push('--sandbox', sandboxMode);
  }

  if (workingDirectory) {
    args.push('--cd', workingDirectory);
  }

  args.push('--skip-git-repo-check');

  if (approvalPolicy) {
    // Codex CLI v0.106+ configures approval policy through -c overrides.
    // Keep the value quoted so TOML parsing treats it as a string literal.
    args.push('-c', `approval_policy=${JSON.stringify(approvalPolicy)}`);
  }

  if (sessionId) {
    args.push('resume', sessionId);
  }

  if (command?.trim()) {
    args.push(command);
  }

  return args;
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
export async function queryCodex(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    model,
    reasoningEffort,
    attachments,
    clientRequestId,
    permissionMode = 'default'
  } = options;
  const requestId = typeof clientRequestId === 'string' ? clientRequestId : null;

  const workingDirectory = cwd || projectPath || process.cwd();
  const effectivePermissionMode = normalizeCodexPermissionMode(permissionMode);
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(effectivePermissionMode);

  const providerSessionId = isCcflowRouteSessionId(sessionId) ? '' : sessionId;
  let currentSessionId = providerSessionId;
  const shouldEmitSessionCreatedEarly = Boolean(providerSessionId);
  let sessionCreatedSent = false;
  const abortController = new AbortController();
  const runTimeoutMs = Number(process.env.CODEX_RUN_TIMEOUT_MS || 600000);

  const finalCommand = appendAttachmentNote(command, attachments);

  try {
    await assertResumeSessionWorkingDirectory(providerSessionId, workingDirectory);

    currentSessionId = providerSessionId || `codex-${Date.now()}`;

    // Track the session
    activeCodexSessions.set(currentSessionId, {
      status: 'running',
      abortController,
      startedAt: new Date().toISOString(),
      projectPath: workingDirectory,
    });

    // For resumed sessions, sessionId is already stable so emit immediately.
    // For new sessions, wait until thread.started to avoid temporary ID mismatch.
    if (shouldEmitSessionCreatedEarly) {
      sendMessage(ws, {
        type: 'session-created',
        sessionId: currentSessionId,
        provider: 'codex',
        clientRequestId: requestId
      });
      sessionCreatedSent = true;
      if (typeof ws?.setSessionId === 'function') {
        ws.setSessionId(currentSessionId);
      }
    }

    const fallback = await runCodexCliFallback({
      command: finalCommand,
      sessionId: providerSessionId,
      workingDirectory,
      model,
      reasoningEffort,
      sandboxMode,
      approvalPolicy,
      timeoutMs: runTimeoutMs,
      signal: abortController.signal,
      onEvent: async (event) => {
        if (event?.type === 'thread.started') {
          const fallbackThreadId = event.thread_id || event.id;
          if (fallbackThreadId && fallbackThreadId !== currentSessionId) {
            const existingSession = activeCodexSessions.get(currentSessionId);
            if (existingSession) {
              activeCodexSessions.delete(currentSessionId);
              activeCodexSessions.set(fallbackThreadId, existingSession);
            }
            currentSessionId = fallbackThreadId;
            // When resumed session resolves to a different thread id, notify clients so
            // frontend session filters and routing switch to the effective session id.
            sendMessage(ws, {
              type: 'session-created',
              sessionId: currentSessionId,
              provider: 'codex',
              clientRequestId: requestId
            });
            if (typeof ws?.setSessionId === 'function') {
              ws.setSessionId(currentSessionId);
            }
            sessionCreatedSent = true;
          }
          if (!sessionCreatedSent) {
            sendMessage(ws, {
              type: 'session-created',
              sessionId: currentSessionId,
              provider: 'codex',
              clientRequestId: requestId
            });
            sessionCreatedSent = true;
            if (typeof ws?.setSessionId === 'function') {
              ws.setSessionId(currentSessionId);
            }
          }
          return;
        }

        const transformed = transformCodexEvent(event);
        if (event?.type === 'item.completed' || event?.type === 'item.updated' || event?.type === 'item.started' || event?.type === 'turn.completed' || event?.type === 'turn.failed') {
          sendMessage(ws, {
            type: 'codex-response',
            data: transformed,
            sessionId: currentSessionId
          });
        }

        if (event?.type === 'turn.completed' && event?.usage) {
          const tokenBudget =
            await getCodexSessionTokenUsage(currentSessionId).catch(() => null) ||
            buildSessionTokenUsagePayload({
              used: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
              total: 200000,
              source: 'codex-turn-completed-fallback',
            });
          sendMessage(ws, {
            type: 'token-budget',
            data: tokenBudget,
            sessionId: currentSessionId
          });
        }
      }
    });

    const fallbackThreadId = fallback.threadId;
    const resolvedSessionId = fallbackThreadId || currentSessionId;
    if (resolvedSessionId !== currentSessionId) {
      const existingSession = activeCodexSessions.get(currentSessionId);
      if (existingSession) {
        activeCodexSessions.delete(currentSessionId);
        activeCodexSessions.set(resolvedSessionId, existingSession);
      }
      currentSessionId = resolvedSessionId;
    }

    if (!sessionCreatedSent) {
      sendMessage(ws, {
        type: 'session-created',
        sessionId: currentSessionId,
        provider: 'codex',
        clientRequestId: requestId
      });
      sessionCreatedSent = true;
      if (typeof ws?.setSessionId === 'function') {
        ws.setSessionId(currentSessionId);
      }
    }

    // Send completion event
    sendMessage(ws, {
      type: 'codex-complete',
      sessionId: currentSessionId,
      actualSessionId: currentSessionId
    });
    return currentSessionId;

  } catch (error) {
    const session = currentSessionId ? activeCodexSessions.get(currentSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      console.error('[Codex] Error:', error);
      sendMessage(ws, {
        type: 'codex-error',
        error: error.message,
        sessionId: currentSessionId
      });
    }

  } finally {
    // Update session status
    if (currentSessionId) {
      const session = activeCodexSessions.get(currentSessionId);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId) {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveCodexSessions() {
  const sessions = [];

  for (const [id, session] of activeCodexSessions.entries()) {
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

/**
 * Expose argument builder for unit tests.
 * @param {object} params - Same as buildCodexExecArgs input.
 * @returns {string[]} Built CLI args.
 */
export function __buildCodexExecArgsForTest(params) {
  return buildCodexExecArgs(params);
}

export function __buildCodexChildEnvForTest(shellProxyEnv, workingDirectory) {
  return buildCodexChildEnv(shellProxyEnv, workingDirectory);
}

/**
 * Test-only export: map a UI permissionMode to the runtime { sandboxMode,
 * approvalPolicy } pair used for Codex CLI invocation. Exposed so behavior
 * tests can pin permission-mode semantics without depending on internal
 * source structure.
 *
 * @param {string} permissionMode - 'default' | 'acceptEdits' | 'bypassPermissions'.
 * @returns {{sandboxMode: string, approvalPolicy: string}} Runtime options.
 */
export function __mapPermissionModeToCodexOptionsForTest(permissionMode) {
  return mapPermissionModeToCodexOptions(normalizeCodexPermissionMode(permissionMode));
}

export async function __findCodexSessionTranscriptForTest(sessionId, rootDir) {
  return findCodexSessionTranscript(sessionId, rootDir);
}

export async function __readCodexSessionWorkingDirectoryForTest(sessionId, rootDir) {
  return readCodexSessionWorkingDirectory(sessionId, rootDir);
}

export async function __assertResumeSessionWorkingDirectoryForTest(sessionId, workingDirectory, rootDir) {
  return assertResumeSessionWorkingDirectory(sessionId, workingDirectory, rootDir);
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
const activeCodexSessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
activeCodexSessionCleanupTimer.unref?.();
