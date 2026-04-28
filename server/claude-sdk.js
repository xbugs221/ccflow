/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { getClaudeSessionTokenUsageFromModelUsage } from './session-token-usage.js';
import { appendAttachmentNote } from './chat-attachments.js';

const activeSessions = new Map();
const pendingToolApprovals = new Map();

/**
 * Append a metadata line to the SDK-generated jsonl file so thinking mode
 * can be inspected by users and downstream tools.
 */
async function appendEffortToJsonl(sessionId, projectPath, effort) {
  try {
    const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
    const projectDir = path.join(os.homedir(), '.claude', 'projects', encodedPath);
    const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
    const line = JSON.stringify({
      type: 'metadata',
      effort,
      timestamp: new Date().toISOString(),
      sessionId
    }) + '\n';
    await fs.appendFile(jsonlPath, line, 'utf8');
    console.log(`[DEBUG] Appended effort="${effort}" to jsonl: ${jsonlPath}`);
  } catch (err) {
    console.warn('[WARN] Failed to append effort to jsonl:', err.message);
  }
}

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS, 10) || 55000;

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion']);

/**
 * PURPOSE: Decide whether Claude tool execution should skip any approval round-trip.
 * In YOLO mode we must never surface approval prompts, including interactive tools.
 */
function shouldAutoApproveClaudeTool(sdkOptions, toolName, input) {
  if (sdkOptions.permissionMode === 'bypassPermissions') {
    return { behavior: 'allow', updatedInput: input };
  }

  const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);
  if (requiresInteraction) {
    return null;
  }

  const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
    matchesToolPermission(entry, toolName, input)
  );
  if (isDisallowed) {
    return { behavior: 'deny', message: 'Tool disallowed by settings' };
  }

  const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
    matchesToolPermission(entry, toolName, input)
  );
  if (isAllowed) {
    return { behavior: 'allow', updatedInput: input };
  }

  return null;
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function waitForToolApproval(requestId, options = {}) {
  const { timeoutMs = TOOL_APPROVAL_TIMEOUT_MS, signal, onCancel } = options;

  return new Promise(resolve => {
    let settled = false;

    const finalize = (decision) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    let timeout;

    const cleanup = () => {
      pendingToolApprovals.delete(requestId);
      if (timeout) clearTimeout(timeout);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    // timeoutMs 0 = wait indefinitely (interactive tools)
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        onCancel?.('timeout');
        finalize(null);
      }, timeoutMs);
    }

    const abortHandler = () => {
      onCancel?.('cancelled');
      finalize({ cancelled: true });
    };

    if (signal) {
      if (signal.aborted) {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    pendingToolApprovals.set(requestId, (decision) => {
      finalize(decision);
    });
  });
}

function resolveToolApproval(requestId, decision) {
  const resolver = pendingToolApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
}

// Match stored permission entries against a tool + input combo.
// This only supports exact tool names and the Bash(command:*) shorthand
// used by the UI; it intentionally does not implement full glob semantics,
// introduced to stay consistent with the UI's "Allow rule" format.
function matchesToolPermission(entry, toolName, input) {
  if (!entry || !toolName) {
    return false;
  }

  if (entry === toolName) {
    return true;
  }

  const bashMatch = entry.match(/^Bash\((.+):\*\)$/);
  if (toolName === 'Bash' && bashMatch) {
    const allowedPrefix = bashMatch[1];
    let command = '';

    if (typeof input === 'string') {
      command = input.trim();
    } else if (input && typeof input === 'object' && typeof input.command === 'string') {
      command = input.command.trim();
    }

    if (!command) {
      return false;
    }

    return command.startsWith(allowedPrefix);
  }

  return false;
}

/**
 * Maps CLI options to SDK-compatible options format
 * @param {Object} options - CLI options
 * @returns {Object} SDK-compatible options
 */
function mapCliOptionsToSDK(options = {}) {
  const { sessionId, cwd, toolsSettings, permissionMode } = options;

  const sdkOptions = {};

  // Remove the CLAUDECODE env var so the SDK can spawn a child claude-code process
  // without triggering the "nested session" guard that causes exit code 1.
  // Preserve the caller's proxy environment instead of forcing a localhost proxy,
  // because the host-side proxy port can differ across machines and sessions.
  const env = { ...process.env };
  delete env.CLAUDECODE;
  sdkOptions.env = env;

  // Map working directory
  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  // Map permission mode
  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  // Map tool settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  // Handle tool permissions
  if (settings.skipPermissions && permissionMode !== 'plan') {
    // When skipping permissions, use bypassPermissions mode
    sdkOptions.permissionMode = 'bypassPermissions';
  }

  let allowedTools = [...(settings.allowedTools || [])];

  // Add plan mode default tools
  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  // Map model only when the UI selected one from the discovered provider catalog.
  if (options.model) {
    sdkOptions.model = options.model;
    console.log(`Using model: ${sdkOptions.model}`);
  }

  // Map thinking depth for Claude-compatible providers (including Kimi)
  const thinkingMode = options.thinkingMode;
  if (thinkingMode === 'low' || thinkingMode === 'medium' || thinkingMode === 'high') {
    sdkOptions.effort = thinkingMode;
  }

  // Map system prompt configuration
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'  // Required to use CLAUDE.md
  };

  // Map setting sources for CLAUDE.md loading
  // This loads CLAUDE.md from project, user (~/.config/claude/CLAUDE.md), and local directories
  sdkOptions.settingSources = ['project', 'user', 'local'];

  // Map resume session
  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  return sdkOptions;
}

/**
 * Adds a session to the active sessions map.
 * @param {string} sessionId - Session identifier.
 * @param {Object} queryInstance - SDK query instance.
 * @param {Array<string>} tempImagePaths - Temp image file paths for cleanup.
 * @param {string|null} tempDir - Temp directory for cleanup.
 * @param {Object} metadata - Additional session metadata for project discovery.
 * @param {string} metadata.projectPath - Working project path.
 * @param {string} metadata.startedAt - ISO timestamp for session start.
 * @returns {void}
 */
function addSession(sessionId, queryInstance, tempImagePaths = [], tempDir = null, metadata = {}) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir,
    projectPath: metadata.projectPath || '',
    startedAt: metadata.startedAt || new Date().toISOString(),
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active Claude SDK sessions with project metadata.
 * @returns {Array<object>} Array of active session descriptors.
 */
function getAllSessions() {
  return Array.from(activeSessions.entries()).map(([id, session]) => ({
    id,
    status: session.status,
    startedAt: session.startedAt || new Date(session.startTime).toISOString(),
    projectPath: session.projectPath || '',
  }));
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

/**
 * Extracts token usage from SDK result messages
 * @param {Object} resultMessage - SDK result message
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudget(resultMessage) {
  if (resultMessage.type !== 'result' || !resultMessage.modelUsage) {
    return null;
  }

  // Get the first model's usage data
  const modelKey = Object.keys(resultMessage.modelUsage)[0];
  const modelData = resultMessage.modelUsage[modelKey];

  if (!modelData) {
    return null;
  }

  // Use configured context window budget from environment (default 160000)
  // This is the user's budget limit, not the model's context window
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW) || 160000;
  const payload = getClaudeSessionTokenUsageFromModelUsage(modelData, {
    contextWindow,
  });

  if (payload) {
    const breakdown = payload.breakdown || {};
    const cacheTokens = (breakdown.cacheRead || 0) + (breakdown.cacheCreation || 0);
    console.log(
      `Token calculation: input=${breakdown.input || 0}, output=${breakdown.output || 0}, cache=${cacheTokens}, total=${payload.used}/${contextWindow}`
    );
  }

  return payload;
}

/**
 * Append uploaded attachment paths to the prompt so Claude can inspect them.
 * @param {string} command - Original user prompt
 * @param {Array} attachments - Uploaded file descriptors
 * @returns {Promise<Object>} {modifiedCommand, tempImagePaths, tempDir}
 */
async function handleImages(command, attachments) {
  return {
    modifiedCommand: appendAttachmentNote(command, attachments),
    tempImagePaths: [],
    tempDir: null,
  };
}

/**
 * Cleans up temporary image files
 * @param {Array<string>} tempImagePaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    console.log(`Cleaned up ${tempImagePaths.length} temp image files`);
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      console.log('No ~/.claude.json found, proceeding without MCP servers');
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      console.log(`Loaded ${Object.keys(mcpServers).length} global MCP servers`);
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        console.log(`Loaded ${Object.keys(projectConfig.mcpServers).length} project-specific MCP servers`);
      }
    }

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      console.log('No MCP servers configured');
      return null;
    }

    console.log(`Total MCP servers loaded: ${Object.keys(mcpServers).length}`);
    return mcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Executes a Claude query using the SDK
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws) {
  const { sessionId } = options;
  const clientRequestId = typeof options.clientRequestId === 'string' ? options.clientRequestId : null;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;
  const startedAt = new Date().toISOString();
  const projectPath = options.cwd || options.projectPath || process.cwd();

  try {
    // Map CLI options to SDK format
    const sdkOptions = mapCliOptionsToSDK(options);

    // Load MCP configuration
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }

    // Append uploaded file paths so Claude can decide how to inspect them.
    const imageResult = await handleImages(command, options.attachments);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    sdkOptions.canUseTool = async (toolName, input, context) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);
      const autoDecision = shouldAutoApproveClaudeTool(sdkOptions, toolName, input);
      if (autoDecision) {
        return autoDecision;
      }

      const requestId = createRequestId();
      ws.send({
        type: 'claude-permission-request',
        requestId,
        toolName,
        input,
        sessionId: capturedSessionId || sessionId || null
      });

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        signal: context?.signal,
        onCancel: (reason) => {
          ws.send({
            type: 'claude-permission-cancelled',
            requestId,
            reason,
            sessionId: capturedSessionId || sessionId || null
          });
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    // Set stream-close timeout for interactive tools (Query constructor reads it synchronously). Claude Agent SDK has a default of 5s and this overrides it
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

    const queryInstance = query({
      prompt: finalCommand,
      options: sdkOptions
    });

    // Restore immediately — Query constructor already captured the value
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    // Track the query instance for abort capability
    if (capturedSessionId) {
      addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir, {
        projectPath,
        startedAt,
      });
    }

    // Process streaming messages
    console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
    for await (const message of queryInstance) {
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir, {
          projectPath,
          startedAt,
        });

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Write effort metadata into jsonl so users can verify thinking mode
        const effortValue = options.thinkingMode;
        if (effortValue && effortValue !== 'disabled') {
          await appendEffortToJsonl(capturedSessionId, projectPath, effortValue);
        }

        // Send session-created event only once for new sessions
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send({
            type: 'session-created',
            sessionId: capturedSessionId,
            clientRequestId
          });
        } else {
          console.log('Not sending session-created. sessionId:', sessionId, 'sessionCreatedSent:', sessionCreatedSent);
        }
      } else {
        console.log('No session_id in message or already captured. message.session_id:', message.session_id, 'capturedSessionId:', capturedSessionId);
      }

      // logs which model was used in the message
      console.log("---> Model was sent using:", Object.keys(message.modelUsage || {}));

      // Transform and send message to WebSocket
      const transformedMessage = transformMessage(message);
      ws.send({
        type: 'claude-response',
        data: transformedMessage,
        sessionId: capturedSessionId || sessionId || null
      });

      // Extract and send token budget updates from result messages
      if (message.type === 'result') {
        const tokenBudget = extractTokenBudget(message);
        if (tokenBudget) {
          console.log('Token budget from modelUsage:', tokenBudget);
          ws.send({
            type: 'token-budget',
            data: tokenBudget,
            sessionId: capturedSessionId || sessionId || null
          });
        }
      }
    }

    // Clean up session on completion
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Send completion event
    console.log('Streaming complete, sending claude-complete event');
    ws.send({
      type: 'claude-complete',
      sessionId: capturedSessionId,
      exitCode: 0,
      isNewSession: !sessionId && !!command
    });
    console.log('claude-complete event sent');
    return capturedSessionId;

  } catch (error) {
    console.error('SDK query error:', error);

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files on error
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Send error to WebSocket
    ws.send({
      type: 'claude-error',
      error: error.message,
      sessionId: capturedSessionId || sessionId || null
    });

    throw error;
  }
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`Aborting SDK session: ${sessionId}`);

    // Call interrupt() on the query instance
    await session.instance.interrupt();

    // Update session status
    session.status = 'aborted';

    // Clean up temporary image files
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);

    // Clean up session
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

/**
 * Registers an active Claude session for tests.
 * @param {Object} session - Test session descriptor.
 * @param {string} session.id - Session identifier.
 * @param {string} session.projectPath - Session project path.
 * @param {string} [session.startedAt] - ISO session start time.
 * @returns {void}
 */
function __registerActiveClaudeSessionForTest(session) {
  if (!session?.id) {
    return;
  }

  activeSessions.set(session.id, {
    instance: null,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths: [],
    tempDir: null,
    projectPath: session.projectPath || '',
    startedAt: session.startedAt || new Date().toISOString(),
  });
}

/**
 * Clears active Claude sessions for tests.
 * @returns {void}
 */
function __clearActiveClaudeSessionsForTest() {
  activeSessions.clear();
}

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  shouldAutoApproveClaudeTool,
  __registerActiveClaudeSessionForTest,
  __clearActiveClaudeSessionsForTest,
};
