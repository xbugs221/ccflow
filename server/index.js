#!/usr/bin/env node
// Load environment variables before other imports execute
import './load-env.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const installMode = fs.existsSync(path.join(__dirname, '..', '.git')) ? 'git' : 'npm';

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text) => `${colors.green}${text}${colors.reset}`,
    warn: (text) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text) => `${colors.blue}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

console.log('PORT from env:', process.env.PORT);

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import http from 'http';
import cors from 'cors';
import { promises as fsPromises } from 'fs';
import { spawn } from 'child_process';
import pty from 'node-pty';
import fetch from 'node-fetch';
import mime from 'mime-types';

import {
    getProjects,
    getSessions,
    getSessionMessages,
    getCodexSessions,
    getCodexSessionMessages,
    searchChatHistory,
    renameProject,
    updateSessionUiState,
    getSessionModelState,
    updateSessionModelState,
    renameSession,
    createManualSessionDraft,
    startManualSessionDraft,
    bindManualSessionDraftProviderSession,
    markManualSessionDraftCancelRequested,
    getManualSessionDraftRuntime,
    finalizeManualSessionDraft,
    deleteSession,
    deleteProject,
    addProjectManually,
    extractProjectDirectory,
    clearProjectDirectoryCache,
    refreshMissingProjectPathCache
} from './projects.js';
import { queryClaudeSDK, abortClaudeSDKSession, isClaudeSDKSessionActive, getActiveClaudeSDKSessions, resolveToolApproval } from './claude-sdk.js';
import { queryCodex, abortCodexSession, isCodexSessionActive, getActiveCodexSessions } from './openai-codex.js';
import { resolveChatProjectOptions } from './chat-project-path.js';
import { getUsageRemaining } from './usage-remaining.js';
import {
    getClaudeSessionTokenUsage,
    getCodexSessionTokenUsage,
} from './session-token-usage.js';
import gitRoutes from './routes/git.js';
import authRoutes from './routes/auth.js';
import mcpRoutes from './routes/mcp.js';
import taskmasterRoutes from './routes/taskmaster.js';
import mcpUtilsRoutes from './routes/mcp-utils.js';
import commandsRoutes from './routes/commands.js';
import settingsRoutes from './routes/settings.js';
import agentRoutes from './routes/agent.js';
import projectsRoutes, { WORKSPACES_ROOT, validateWorkspacePath } from './routes/projects.js';
import cliAuthRoutes from './routes/cli-auth.js';
import userRoutes from './routes/user.js';
import codexRoutes from './routes/codex.js';
import claudeRoutes from './routes/claude.js';
import { initializeDatabase } from './database/db.js';
import { validateApiKey, authenticateToken, authenticateWebSocket } from './middleware/auth.js';
import { IS_PLATFORM } from './constants/config.js';
import {
    buildMutationResponse,
    createDirectoryArchive,
    joinProjectChildPath,
    resolveProjectPath,
    resolveProjectRoot,
    resolveProjectRootWithHint,
    resolveProjectTarget,
    sanitizeEntryName,
    sanitizeUploadRelativePath,
    sendDownload,
} from './project-file-operations.js';
import {
    CHAT_UPLOAD_ROOT,
    persistChatUploads,
    sanitizeFilename,
} from './chat-attachments.js';
import {
    attachWorkflowMetadata,
    advanceWorkflow,
    buildWorkflowLauncherConfig,
    createProjectWorkflow,
    deleteWorkflow,
    findProjectByName,
    getProjectWorkflow,
    listProjectAdoptableOpenSpecChanges,
    markWorkflowRead,
    renameWorkflow,
    registerWorkflowChildSession,
    updateWorkflowGateDecision,
    updateWorkflowUiState,
} from './workflows.js';
import { scheduleWorkflowAutoRun, startWorkflowAutoRunner, stopWorkflowAutoRunner } from './workflow-auto-runner.js';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const TEXT_SAMPLE_BYTES = 8192;
const CC_ROUTE_SESSION_PATTERN = /^c\d+$/;

/**
 * Return the first non-empty string from mixed websocket protocol fields.
 */
function pickString(...values) {
    return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

/**
 * Detect WebUI route-only manual session ids that must not be used as provider resume ids.
 */
function isCcflowRouteSessionId(sessionId) {
    return typeof sessionId === 'string' && CC_ROUTE_SESSION_PATTERN.test(sessionId.trim());
}

/**
 * Extract the manual-session first-message contract from websocket payloads.
 */
function resolveCcflowSessionStartContext(data = {}, resolvedOptions = {}) {
    const options = data && typeof data.options === 'object' && data.options !== null ? data.options : {};
    const explicitCcflowSessionId = pickString(
        data.ccflowSessionId,
        data.ccflow_session_id,
        options.ccflowSessionId,
        options.ccflow_session_id,
    );
    const fallbackRouteSessionId = isCcflowRouteSessionId(resolvedOptions?.sessionId)
        ? resolvedOptions.sessionId
        : '';
    const ccflowSessionId = isCcflowRouteSessionId(explicitCcflowSessionId)
        ? explicitCcflowSessionId
        : fallbackRouteSessionId;

    return {
        ccflowSessionId,
        startRequestId: pickString(
            data.startRequestId,
            data.start_request_id,
            data.clientRequestId,
            options.startRequestId,
            options.start_request_id,
            options.clientRequestId,
        ),
        clientRef: pickString(data.clientRef, data.client_ref, options.clientRef, options.client_ref, data.command),
    };
}

/**
 * Detect whether a byte buffer should stay on the text-safe editor path.
 */
function trimIncompleteUtf8Tail(buffer) {
    if (!buffer || buffer.length === 0) {
        return buffer;
    }

    let continuationBytes = 0;
    for (let index = buffer.length - 1; index >= 0 && continuationBytes < 3; index -= 1) {
        const byte = buffer[index];
        if ((byte & 0xc0) !== 0x80) {
            const expectedLength = (
                byte >= 0xf0 && byte <= 0xf4 ? 4
                    : byte >= 0xe0 && byte <= 0xef ? 3
                        : byte >= 0xc2 && byte <= 0xdf ? 2
                            : 1
            );

            if (expectedLength === 1 || continuationBytes + 1 >= expectedLength) {
                return buffer;
            }

            return buffer.subarray(0, index);
        }

        continuationBytes += 1;
    }

    return buffer;
}

/**
 * Detect whether a byte buffer should stay on the text-safe editor path.
 */
function isLikelyTextBuffer(buffer) {
    if (!buffer || buffer.length === 0) {
        return true;
    }

    if (buffer.includes(0)) {
        return false;
    }

    try {
        TEXT_DECODER.decode(trimIncompleteUtf8Tail(buffer));
    } catch {
        return false;
    }

    let suspiciousControlBytes = 0;
    for (const byte of buffer) {
        const isTab = byte === 9;
        const isLineBreak = byte === 10 || byte === 13;
        const isPrintableAscii = byte >= 32;
        if (!isTab && !isLineBreak && !isPrintableAscii) {
            suspiciousControlBytes += 1;
        }
    }

    return suspiciousControlBytes / buffer.length < 0.05;
}

/**
 * Classify a workspace file before routing it into editor, preview, or download flows.
 */
function classifyProjectFile(absolutePath, sampleBuffer) {
    const mimeType = mime.lookup(absolutePath) || 'application/octet-stream';
    const extension = path.extname(absolutePath).toLowerCase();

    if (typeof mimeType === 'string' && mimeType.startsWith('image/')) {
        return {
            fileType: 'image',
            mimeType,
            editable: false,
        };
    }

    if (!isLikelyTextBuffer(sampleBuffer)) {
        return {
            fileType: 'binary',
            mimeType,
            editable: false,
        };
    }

    if (MARKDOWN_EXTENSIONS.has(extension)) {
        return {
            fileType: 'markdown',
            mimeType,
            editable: true,
        };
    }

    return {
        fileType: 'text',
        mimeType,
        editable: true,
    };
}

// File system watchers for provider project/session folders
const PROVIDER_WATCH_PATHS = [
    { provider: 'claude', rootPath: path.join(os.homedir(), '.claude', 'projects') },
    { provider: 'codex', rootPath: path.join(os.homedir(), '.codex', 'sessions') },
];
const WATCHER_IGNORED_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/*.tmp',
    '**/*.swp',
    '**/.DS_Store'
];
const WATCHER_DEBOUNCE_MS = 300;
let projectsWatchers = [];
let projectsWatcherDebounceTimer = null;
const connectedClients = new Set();
const chatClientUsers = new WeakMap();
const recentChatRequestIds = new Map();
const CHAT_REQUEST_ID_TTL_MS = 10 * 60 * 1000;

function pruneRecentChatRequestIds(now = Date.now()) {
    for (const [requestId, expiresAt] of recentChatRequestIds.entries()) {
        if (expiresAt <= now) {
            recentChatRequestIds.delete(requestId);
        }
    }
}

function acceptChatRequestId(requestId) {
    if (typeof requestId !== 'string' || !requestId) {
        return true;
    }

    const now = Date.now();
    pruneRecentChatRequestIds(now);

    if (recentChatRequestIds.has(requestId)) {
        return false;
    }

    recentChatRequestIds.set(requestId, now + CHAT_REQUEST_ID_TTL_MS);
    return true;
}
let isGetProjectsRunning = false; // Flag to prevent reentrant calls
let isShuttingDown = false;

// Broadcast progress to all connected WebSocket clients
function broadcastProgress(progress) {
    const message = JSON.stringify({
        type: 'loading_progress',
        ...progress
    });
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

/**
 * Broadcast a chat-scoped event to connected clients for the same authenticated user.
 */
function broadcastChatEvent(payload, sourceUserId = null) {
    const message = JSON.stringify(payload);
    connectedClients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
            return;
        }

        if (sourceUserId !== null) {
            const targetUserId = chatClientUsers.get(client);
            if (targetUserId !== sourceUserId) {
                return;
            }
        }

        client.send(message);
    });
}

/**
 * Notify clients that a session's model controls changed.
 */
function broadcastSessionModelStateUpdated({ sourceUserId = null, projectName = '', projectPath = '', sessionId = '', provider = 'codex', state = {} }) {
    if (!sessionId) {
        return;
    }

    broadcastChatEvent({
        type: 'session-model-state-updated',
        provider,
        projectName,
        projectPath,
        sessionId,
        state,
        timestamp: new Date().toISOString(),
    }, sourceUserId);
}

/**
 * Close all provider filesystem watchers and clear any pending debounce work.
 */
async function closeProjectsWatchers() {
    if (projectsWatcherDebounceTimer) {
        clearTimeout(projectsWatcherDebounceTimer);
        projectsWatcherDebounceTimer = null;
    }

    await Promise.all(
        projectsWatchers.map(async (watcher) => {
            try {
                await watcher.close();
            } catch (error) {
                console.error('[WARN] Failed to close watcher:', error);
            }
        })
    );
    projectsWatchers = [];
}

// Setup file system watchers for Claude and Codex project/session folders
async function setupProjectsWatcher() {
    const chokidar = (await import('chokidar')).default;

    await closeProjectsWatchers();

    const debouncedUpdate = (eventType, filePath, provider, rootPath) => {
        if (projectsWatcherDebounceTimer) {
            clearTimeout(projectsWatcherDebounceTimer);
        }

        projectsWatcherDebounceTimer = setTimeout(async () => {
            // Prevent reentrant calls
            if (isGetProjectsRunning) {
                return;
            }

            try {
                isGetProjectsRunning = true;

                // Clear project directory cache when files change
                clearProjectDirectoryCache();

                // Get updated projects list
                const updatedProjects = await attachWorkflowMetadata(
                    await getProjects(broadcastProgress)
                );

                // Notify all connected clients about the project changes
                const updateMessage = JSON.stringify({
                    type: 'projects_updated',
                    projects: updatedProjects,
                    timestamp: new Date().toISOString(),
                    changeType: eventType,
                    changedFile: path.relative(rootPath, filePath),
                    watchProvider: provider
                });

                connectedClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(updateMessage);
                    }
                });
                scheduleWorkflowAutoRun('project-change', { logger: console });

            } catch (error) {
                console.error('[ERROR] Error handling project changes:', error);
            } finally {
                isGetProjectsRunning = false;
            }
        }, WATCHER_DEBOUNCE_MS);
    };

    for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
        try {
            // chokidar v4 emits ENOENT via the "error" event for missing roots and will not auto-recover.
            // Ensure provider folders exist before creating the watcher so watching stays active.
            await fsPromises.mkdir(rootPath, { recursive: true });

            // Initialize chokidar watcher with optimized settings
            const watcher = chokidar.watch(rootPath, {
                ignored: WATCHER_IGNORED_PATTERNS,
                persistent: true,
                ignoreInitial: true, // Don't fire events for existing files on startup
                followSymlinks: false,
                depth: 10, // Reasonable depth limit
                awaitWriteFinish: {
                    stabilityThreshold: 100, // Wait 100ms for file to stabilize
                    pollInterval: 50
                }
            });

            // Set up event listeners
            watcher
                .on('add', (filePath) => debouncedUpdate('add', filePath, provider, rootPath))
                .on('change', (filePath) => debouncedUpdate('change', filePath, provider, rootPath))
                .on('unlink', (filePath) => debouncedUpdate('unlink', filePath, provider, rootPath))
                .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath, provider, rootPath))
                .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath, provider, rootPath))
                .on('error', (error) => {
                    console.error(`[ERROR] ${provider} watcher error:`, error);
                })
                .on('ready', () => {
                });

            projectsWatchers.push(watcher);
        } catch (error) {
            console.error(`[ERROR] Failed to setup ${provider} watcher for ${rootPath}:`, error);
        }
    }

    if (projectsWatchers.length === 0) {
        console.error('[ERROR] Failed to setup any provider watchers');
    }
}


const app = express();
const server = http.createServer(app);

const ptySessionsMap = new Map();
let sessionPathScanIntervalHandle = null;
const PTY_SESSION_TIMEOUT = 30 * 60 * 1000;
const SHELL_URL_PARSE_BUFFER_LIMIT = 32768;
const ANSI_ESCAPE_SEQUENCE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const TRAILING_URL_PUNCTUATION_REGEX = /[)\]}>.,;:!?]+$/;

function stripAnsiSequences(value = '') {
    return value.replace(ANSI_ESCAPE_SEQUENCE_REGEX, '');
}

function normalizeDetectedUrl(url) {
    if (!url || typeof url !== 'string') return null;

    const cleaned = url.trim().replace(TRAILING_URL_PUNCTUATION_REGEX, '');
    if (!cleaned) return null;

    try {
        const parsed = new URL(cleaned);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

function extractUrlsFromText(value = '') {
    const directMatches = value.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/gi) || [];

    // Handle wrapped terminal URLs split across lines by terminal width.
    const wrappedMatches = [];
    const continuationRegex = /^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/;
    const lines = value.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const startMatch = line.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/i);
        if (!startMatch) continue;

        let combined = startMatch[0];
        let j = i + 1;
        while (j < lines.length) {
            const continuation = lines[j].trim();
            if (!continuation) break;
            if (!continuationRegex.test(continuation)) break;
            combined += continuation;
            j++;
        }

        wrappedMatches.push(combined.replace(/\r?\n\s*/g, ''));
    }

    return Array.from(new Set([...directMatches, ...wrappedMatches]));
}

function shouldAutoOpenUrlFromOutput(value = '') {
    const normalized = value.toLowerCase();
    return (
        normalized.includes('browser didn\'t open') ||
        normalized.includes('open this url') ||
        normalized.includes('continue in your browser') ||
        normalized.includes('press enter to open') ||
        normalized.includes('open_url:')
    );
}

// Single WebSocket server that handles both paths
const wss = new WebSocketServer({
    server,
    verifyClient: (info) => {
        console.log('WebSocket connection attempt to:', info.req.url);

        // Platform mode: always allow connection
        if (IS_PLATFORM) {
            const user = authenticateWebSocket(null, info.req); // Will return first user
            if (!user) {
                console.log('[WARN] Platform mode: No user found in database');
                return false;
            }
            info.req.user = user;
            console.log('[OK] Platform mode WebSocket authenticated for user:', user.username);
            return true;
        }

        // Normal mode: verify token
        // Extract token from query parameters or headers
        const url = new URL(info.req.url, 'http://localhost');
        const token = url.searchParams.get('token') ||
            info.req.headers.authorization?.split(' ')[1];

        // Verify token
        const user = authenticateWebSocket(token, info.req);
        if (!user) {
            console.log('[WARN] WebSocket authentication failed');
            return false;
        }

        // Store user info in the request for later use
        info.req.user = user;
        console.log('[OK] WebSocket authenticated for user:', user.username);
        return true;
    }
});

// Make WebSocket server available to routes
app.locals.wss = wss;

app.use(cors());
app.use(express.json({
    limit: '50mb',
    type: (req) => {
        // Skip multipart/form-data requests (for file uploads like images)
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            return false;
        }
        return contentType.includes('json');
    }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Public health check endpoint (no authentication required)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        installMode
    });
});

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectsRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// MCP API Routes (protected)
app.use('/api/mcp', authenticateToken, mcpRoutes);

// TaskMaster API Routes (protected)
app.use('/api/taskmaster', authenticateToken, taskmasterRoutes);

// MCP utilities
app.use('/api/mcp-utils', authenticateToken, mcpUtilsRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);

// CLI Authentication API Routes (protected)
app.use('/api/cli', authenticateToken, cliAuthRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Codex API Routes (protected)
app.use('/api/codex', authenticateToken, codexRoutes);

// Claude API Routes (protected)
app.use('/api/claude', authenticateToken, claudeRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

// Serve public files (like api-docs.html)
app.use(express.static(path.join(__dirname, '../public')));

// Static files served after API routes
// Add cache control: HTML files should not be cached, but assets can be cached
app.use(express.static(path.join(__dirname, '../dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            // Prevent HTML caching to avoid service worker issues after builds
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
            // Cache static assets for 1 year (they have hashed names)
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs

// System update endpoint
app.post('/api/system/update', authenticateToken, async (req, res) => {
    try {
        // Get the project root directory (parent of server directory)
        const projectRoot = path.join(__dirname, '..');

        console.log('Starting system update from directory:', projectRoot);

        // Run the update command based on install mode
        const updateCommand = installMode === 'git'
            ? 'git checkout main && git pull && npm install'
            : 'npm install -g @siteboon/claude-code-ui@latest';

        const child = spawn('sh', ['-c', updateCommand], {
            cwd: installMode === 'git' ? projectRoot : os.homedir(),
            env: process.env
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log('Update output:', text);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            console.error('Update error:', text);
        });

        child.on('close', (code) => {
            if (code === 0) {
                res.json({
                    success: true,
                    output: output || 'Update completed successfully',
                    message: 'Update completed. Please restart the server to apply changes.'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Update command failed',
                    output: output,
                    errorOutput: errorOutput
                });
            }
        });

        child.on('error', (error) => {
            console.error('Update process error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        });

    } catch (error) {
        console.error('System update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const projects = await getProjects(broadcastProgress);
        res.json(await attachWorkflowMetadata(projects));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/workflows', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json(project.workflows || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/workflows', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await createProjectWorkflow(project, {
            title: req.body?.title,
            objective: req.body?.objective,
            openspecChangeName: req.body?.openspecChangeName,
        });
        scheduleWorkflowAutoRun('workflow-create', { logger: console });
        res.status(201).json(workflow);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/openspec/changes', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const changes = await listProjectAdoptableOpenSpecChanges(project);
        res.json({ changes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/workflows/:workflowId', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await getProjectWorkflow(project, req.params.workflowId);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json(workflow);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/workflows/:workflowId/mark-read', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await markWorkflowRead(project, req.params.workflowId);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        scheduleWorkflowAutoRun('workflow-advance', { logger: console });
        res.json({ success: true, workflow });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/projects/:projectName/workflows/:workflowId', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const deleted = await deleteWorkflow(project, req.params.workflowId);
        if (!deleted) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/workflows/:workflowId/ui-state', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await updateWorkflowUiState(project, req.params.workflowId, {
            favorite: req.body?.favorite === true,
            pending: req.body?.pending === true,
            hidden: req.body?.hidden === true,
        });
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({ success: true, workflow });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/workflows/:workflowId/gate-decision', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await updateWorkflowGateDecision(project, req.params.workflowId, req.body?.gateDecision);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({ success: true, workflow });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/workflows/:workflowId/rename', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const { title } = req.body;
        if (typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ error: 'Workflow title is required' });
        }

        const workflow = await renameWorkflow(project, req.params.workflowId, title);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({ success: true, workflow });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/workflows/:workflowId/child-sessions', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await registerWorkflowChildSession(project, req.params.workflowId, {
            sessionId: req.body?.sessionId,
            title: req.body?.title,
            summary: req.body?.summary,
            provider: req.body?.provider,
            stageKey: req.body?.stageKey,
            substageKey: req.body?.substageKey,
            reviewPassIndex: req.body?.reviewPassIndex,
            url: req.body?.url,
        });
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({ success: true, workflow });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/workflows/:workflowId/advance', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await advanceWorkflow(project, req.params.workflowId);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({ success: true, workflow });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/workflows/:workflowId/launcher-config', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const stage = typeof req.body?.stage === 'string' ? req.body.stage.trim() : '';
        const launcher = await buildWorkflowLauncherConfig(project, req.params.workflowId, stage);
        if (!launcher) {
            return res.status(204).end();
        }
        res.json(launcher);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions', authenticateToken, async (req, res) => {
    try {
        const { limit = 5, offset = 0 } = req.query;
        const result = await getSessions(req.params.projectName, parseInt(limit), parseInt(offset));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get messages for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/messages', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { limit, offset, provider, afterLine } = req.query;

        // Parse limit and offset if provided
        const parsedLimit = limit ? parseInt(limit, 10) : null;
        const parsedOffset = offset ? parseInt(offset, 10) : 0;
        const parsedAfterLine = afterLine != null ? parseInt(afterLine, 10) : null;

        let resolvedProvider = provider === 'codex' ? 'codex' : provider === 'claude' ? 'claude' : null;
        let projectPath = null;

        if (isCcflowRouteSessionId(sessionId)) {
            projectPath = await extractProjectDirectory(projectName);
            const runtimeContext = await getManualSessionDraftRuntime(
                projectName,
                projectPath,
                sessionId,
            );
            if (runtimeContext) {
                if (!runtimeContext.pendingProviderSessionId) {
                    return res.json({ messages: [] });
                }

                const providerSessionId = runtimeContext.pendingProviderSessionId;
                const indexedProvider = runtimeContext.provider === 'codex' ? 'codex' : 'claude';
                const nativeResult = (resolvedProvider || indexedProvider) === 'codex'
                    ? await getCodexSessionMessages(providerSessionId, parsedLimit, parsedOffset, parsedAfterLine)
                    : await getSessionMessages(projectName, providerSessionId, parsedLimit, parsedOffset, parsedAfterLine);
                return res.json(nativeResult);
            }
        }

        if (!resolvedProvider) {
            try {
                projectPath = projectPath || await extractProjectDirectory(projectName);
                const codexSessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
                resolvedProvider = codexSessions.some((session) => session.id === sessionId) ? 'codex' : 'claude';
            } catch (providerDetectionError) {
                console.warn(
                    `Unable to detect provider for session ${sessionId} in project ${projectName}:`,
                    providerDetectionError.message,
                );
                resolvedProvider = 'claude';
            }
        }

        const result = resolvedProvider === 'codex'
            ? await getCodexSessionMessages(sessionId, parsedLimit, parsedOffset, parsedAfterLine)
            : await getSessionMessages(projectName, sessionId, parsedLimit, parsedOffset, parsedAfterLine);

        // Handle both old and new response formats
        if (Array.isArray(result)) {
            // Backward compatibility: no pagination parameters were provided
            res.json({ messages: result });
        } else {
            // New format with pagination info
            res.json(result);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Search across visible chat history messages for Claude and Codex sessions.
app.get('/api/chat/search', authenticateToken, async (req, res) => {
    try {
        const query = typeof req.query.q === 'string' ? req.query.q : '';
        const results = await searchChatHistory(query);
        res.json({ success: true, results });
    } catch (error) {
        console.error('Error searching chat history:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rename project endpoint
app.put('/api/projects/:projectName/rename', authenticateToken, async (req, res) => {
    try {
        const { displayName, projectPath } = req.body;
        await renameProject(req.params.projectName, displayName, projectPath);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename Claude session endpoint
app.put('/api/projects/:projectName/sessions/:sessionId/rename', authenticateToken, async (req, res) => {
    try {
        const { summary, projectPath } = req.body;
        if (typeof summary !== 'string' || !summary.trim()) {
            return res.status(400).json({ error: 'Session summary is required' });
        }

        await renameSession(req.params.projectName, req.params.sessionId, summary, typeof projectPath === 'string' ? projectPath : '');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/sessions/:sessionId/ui-state', authenticateToken, async (req, res) => {
    try {
        const provider = req.body?.provider === 'codex' ? 'codex' : 'claude';
        const state = await updateSessionUiState(req.params.projectName, req.params.sessionId, provider, {
            favorite: req.body?.favorite === true,
            pending: req.body?.pending === true,
            hidden: req.body?.hidden === true,
        });
        res.json({ success: true, state });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Resolve the project config path used for session-scoped control state.
 */
async function resolveSessionModelProjectPath(projectName, candidatePath = '') {
    if (typeof candidatePath === 'string' && candidatePath.trim()) {
        return candidatePath.trim();
    }
    return extractProjectDirectory(projectName);
}

app.get('/api/projects/:projectName/sessions/:sessionId/model-state', authenticateToken, async (req, res) => {
    try {
        const projectPath = await resolveSessionModelProjectPath(
            req.params.projectName,
            typeof req.query?.projectPath === 'string' ? req.query.projectPath : '',
        );
        const state = await getSessionModelState(projectPath, req.params.sessionId);
        res.json({ success: true, state });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/sessions/:sessionId/model-state', authenticateToken, async (req, res) => {
    try {
        const projectPath = await resolveSessionModelProjectPath(
            req.params.projectName,
            typeof req.body?.projectPath === 'string' ? req.body.projectPath : '',
        );
        const state = await updateSessionModelState(projectPath, req.params.sessionId, {
            model: typeof req.body?.model === 'string' ? req.body.model : '',
            reasoningEffort: typeof req.body?.reasoningEffort === 'string' ? req.body.reasoningEffort : '',
            thinkingMode: typeof req.body?.thinkingMode === 'string' ? req.body.thinkingMode : '',
        });
        broadcastSessionModelStateUpdated({
            sourceUserId: req.user?.id || null,
            projectName: req.params.projectName,
            projectPath,
            sessionId: req.params.sessionId,
            provider: req.body?.provider === 'claude' ? 'claude' : 'codex',
            state,
        });
        res.json({ success: true, state });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/manual-sessions', authenticateToken, async (req, res) => {
    try {
        const provider = req.body?.provider === 'codex' ? 'codex' : 'claude';
        const label = typeof req.body?.label === 'string' ? req.body.label : '';
        const projectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : '';
        const workflowId = typeof req.body?.workflowId === 'string' ? req.body.workflowId : '';
        const stageKey = typeof req.body?.stageKey === 'string' ? req.body.stageKey : '';
        const substageKey = typeof req.body?.substageKey === 'string' ? req.body.substageKey : '';
        const requestedReviewPassIndex = Number.parseInt(String(req.body?.reviewPassIndex || ''), 10);
        const reviewPassIndex = Number.isInteger(requestedReviewPassIndex) && requestedReviewPassIndex > 0
            ? requestedReviewPassIndex
            : undefined;

        if (!label.trim()) {
            return res.status(400).json({ error: 'Session label is required' });
        }

        const session = await createManualSessionDraft(req.params.projectName, projectPath, provider, label, {
            workflowId,
            stageKey,
            substageKey,
            reviewPassIndex,
        });
        res.json({ success: true, session });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/manual-sessions/:sessionId/finalize', authenticateToken, async (req, res) => {
    try {
        const provider = req.body?.provider === 'codex' ? 'codex' : 'claude';
        const actualSessionId = typeof req.body?.actualSessionId === 'string' ? req.body.actualSessionId : '';

        if (!actualSessionId.trim()) {
            return res.status(400).json({ error: 'Actual session ID is required' });
        }

        const finalized = await finalizeManualSessionDraft(
            req.params.projectName,
            req.params.sessionId,
            actualSessionId,
            provider,
            typeof req.body?.projectPath === 'string' ? req.body.projectPath : '',
        );
        res.json({ success: true, finalized });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get provider-level usage remaining metrics for UI status display.
app.get('/api/usage/remaining', authenticateToken, async (req, res) => {
    try {
        const provider = req.query.provider === 'codex' ? 'codex' : 'claude';
        const usageRemaining = await getUsageRemaining(provider);
        res.json(usageRemaining);
    } catch (error) {
        console.error('Error reading usage remaining:', error);
        res.status(500).json({ error: 'Failed to read usage remaining' });
    }
});

// Delete session endpoint
app.delete('/api/projects/:projectName/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        console.log(`[API] Deleting session: ${sessionId} from project: ${projectName}`);
        await deleteSession(projectName, sessionId);
        console.log(`[API] Session ${sessionId} deleted successfully`);
        res.json({ success: true });
    } catch (error) {
        console.error(`[API] Error deleting session ${req.params.sessionId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Delete project endpoint (force=true to delete with sessions)
app.delete('/api/projects/:projectName', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const force = req.query.force === 'true';
        await deleteProject(projectName, force);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create project endpoint
app.post('/api/projects/create', authenticateToken, async (req, res) => {
    try {
        const { path: projectPath } = req.body;

        if (!projectPath || !projectPath.trim()) {
            return res.status(400).json({ error: 'Project path is required' });
        }

        const project = await addProjectManually(projectPath.trim());
        res.json({ success: true, project });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: error.message });
    }
});

const expandWorkspacePath = (inputPath) => {
    if (!inputPath) return inputPath;
    if (inputPath === '~') {
        return WORKSPACES_ROOT;
    }
    if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
        return path.join(WORKSPACES_ROOT, inputPath.slice(2));
    }
    return inputPath;
};

// Browse filesystem endpoint for project suggestions - uses existing getFileTree
app.get('/api/browse-filesystem', authenticateToken, async (req, res) => {
    try {
        const { path: dirPath } = req.query;

        console.log('[API] Browse filesystem request for path:', dirPath);
        console.log('[API] WORKSPACES_ROOT is:', WORKSPACES_ROOT);
        // Default to home directory if no path provided
        const defaultRoot = WORKSPACES_ROOT;
        let targetPath = dirPath ? expandWorkspacePath(dirPath) : defaultRoot;

        // Resolve and normalize the path
        targetPath = path.resolve(targetPath);

        // Security check - ensure path is within allowed workspace root
        const validation = await validateWorkspacePath(targetPath);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }
        const resolvedPath = validation.resolvedPath || targetPath;

        // Security check - ensure path is accessible
        try {
            await fs.promises.access(resolvedPath);
            const stats = await fs.promises.stat(resolvedPath);

            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is not a directory' });
            }
        } catch (err) {
            return res.status(404).json({ error: 'Directory not accessible' });
        }

        // Use existing getFileTree function with shallow depth (only direct children)
        const fileTree = await getFileTree(resolvedPath, 1, 0, false); // maxDepth=1, showHidden=false

        // Filter only directories and format for suggestions
        const directories = fileTree
            .filter(item => item.type === 'directory')
            .map(item => ({
                path: item.path,
                name: item.name,
                type: 'directory'
            }))
            .sort((a, b) => {
                const aHidden = a.name.startsWith('.');
                const bHidden = b.name.startsWith('.');
                if (aHidden && !bHidden) return 1;
                if (!aHidden && bHidden) return -1;
                return a.name.localeCompare(b.name);
            });

        // Add common directories if browsing home directory
        const suggestions = [];
        let resolvedWorkspaceRoot = defaultRoot;
        try {
            resolvedWorkspaceRoot = await fsPromises.realpath(defaultRoot);
        } catch (error) {
            // Use default root as-is if realpath fails
        }
        if (resolvedPath === resolvedWorkspaceRoot) {
            const commonDirs = ['Desktop', 'Documents', 'Projects', 'Development', 'Dev', 'Code', 'workspace'];
            const existingCommon = directories.filter(dir => commonDirs.includes(dir.name));
            const otherDirs = directories.filter(dir => !commonDirs.includes(dir.name));

            suggestions.push(...existingCommon, ...otherDirs);
        } else {
            suggestions.push(...directories);
        }

        res.json({
            path: resolvedPath,
            suggestions: suggestions
        });

    } catch (error) {
        console.error('Error browsing filesystem:', error);
        res.status(500).json({ error: 'Failed to browse filesystem' });
    }
});

app.post('/api/create-folder', authenticateToken, async (req, res) => {
    try {
        const { path: folderPath } = req.body;
        if (!folderPath) {
            return res.status(400).json({ error: 'Path is required' });
        }
        const expandedPath = expandWorkspacePath(folderPath);
        const resolvedInput = path.resolve(expandedPath);
        const validation = await validateWorkspacePath(resolvedInput);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }
        const targetPath = validation.resolvedPath || resolvedInput;
        const parentDir = path.dirname(targetPath);
        try {
            await fs.promises.access(parentDir);
        } catch (err) {
            return res.status(404).json({ error: 'Parent directory does not exist' });
        }
        try {
            await fs.promises.access(targetPath);
            return res.status(409).json({ error: 'Folder already exists' });
        } catch (err) {
            // Folder doesn't exist, which is what we want
        }
        try {
            await fs.promises.mkdir(targetPath, { recursive: false });
            res.json({ success: true, path: targetPath });
        } catch (mkdirError) {
            if (mkdirError.code === 'EEXIST') {
                return res.status(409).json({ error: 'Folder already exists' });
            }
            throw mkdirError;
        }
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

/**
 * Read file content endpoint with centralized project-root confinement.
 */
app.get('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { filePath, projectPath } = req.query;
        const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
        const { absolutePath } = await resolveProjectPath(projectRoot, String(filePath || ''));
        const fullBuffer = await fsPromises.readFile(absolutePath);
        const classification = classifyProjectFile(absolutePath, fullBuffer.subarray(0, TEXT_SAMPLE_BYTES));

        if (classification.editable) {
            res.json({
                ...classification,
                content: fullBuffer.toString('utf8'),
                path: absolutePath,
            });
            return;
        }

        res.json({
            ...classification,
            path: absolutePath,
        });
    } catch (error) {
        console.error('Error reading file:', error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

/**
 * Serve binary file content endpoint (for images, etc.) within project root.
 */
app.get('/api/projects/:projectName/files/content', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { path: filePath, projectPath } = req.query;
        const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
        const { absolutePath } = await resolveProjectPath(projectRoot, String(filePath || ''));

        // Check if file exists
        try {
            await fsPromises.access(absolutePath);
        } catch (error) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Get file extension and set appropriate content type
        const mimeType = mime.lookup(absolutePath) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);

        // Stream the file
        const fileStream = fs.createReadStream(absolutePath);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file' });
            }
        });

    } catch (error) {
        console.error('Error serving binary file:', error);
        if (error.statusCode && !res.headersSent) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

/**
 * Save file content endpoint with centralized project-root confinement.
 */
app.put('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { filePath, content, projectPath } = req.body;

        if (content === undefined) {
            return res.status(400).json({ error: 'Content is required' });
        }

        const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
        const { absolutePath } = await resolveProjectPath(projectRoot, String(filePath || ''));

        // Write the new content
        await fsPromises.writeFile(absolutePath, content, 'utf8');

        res.json(buildMutationResponse(projectRoot, absolutePath, {
            type: 'file',
            message: 'File saved successfully',
        }));
    } catch (error) {
        console.error('Error saving file:', error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

/**
 * Create a new file or directory inside the selected project root.
 */
app.post('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { path: parentPath = '', type, name, projectPath } = req.body;

        if (type !== 'file' && type !== 'directory') {
            return res.status(400).json({ error: 'Type must be file or directory' });
        }

        const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
        const { absolutePath: parentDirectory } = await resolveProjectPath(projectRoot, String(parentPath), {
            allowRoot: true,
        });
        const targetName = sanitizeEntryName(name);
        const targetPath = joinProjectChildPath(parentDirectory, targetName);

        const parentStats = await fsPromises.stat(parentDirectory).catch(() => null);
        if (!parentStats?.isDirectory()) {
            return res.status(404).json({ error: 'Parent directory not found' });
        }

        const targetExists = await fsPromises.access(targetPath).then(() => true).catch(() => false);
        if (targetExists) {
            return res.status(409).json({ error: `${type === 'file' ? 'File' : 'Directory'} already exists` });
        }

        if (type === 'directory') {
            await fsPromises.mkdir(targetPath);
        } else {
            await fsPromises.writeFile(targetPath, '', 'utf8');
        }

        res.json(buildMutationResponse(projectRoot, targetPath, {
            type,
            message: `${type === 'file' ? 'File' : 'Directory'} created successfully`,
        }));
    } catch (error) {
        console.error('Error creating project entry:', error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

/**
 * Rename a file or directory while keeping the entry inside the same project root.
 */
app.put('/api/projects/:projectName/files/rename', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { oldPath, newName, projectPath } = req.body;
        const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
        const { absolutePath: sourcePath } = await resolveProjectPath(projectRoot, String(oldPath || ''));
        const nextName = sanitizeEntryName(newName);
        const destinationPath = joinProjectChildPath(path.dirname(sourcePath), nextName);

        if (sourcePath === projectRoot) {
            return res.status(400).json({ error: 'Project root cannot be renamed' });
        }

        const sourceStats = await fsPromises.stat(sourcePath).catch(() => null);
        if (!sourceStats) {
            return res.status(404).json({ error: 'Path not found' });
        }

        const destinationExists = await fsPromises.access(destinationPath).then(() => true).catch(() => false);
        if (destinationExists) {
            return res.status(409).json({ error: 'Target path already exists' });
        }

        await fsPromises.rename(sourcePath, destinationPath);

        res.json(buildMutationResponse(projectRoot, destinationPath, {
            type: sourceStats.isDirectory() ? 'directory' : 'file',
            message: 'Path renamed successfully',
        }));
    } catch (error) {
        console.error('Error renaming project entry:', error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

/**
 * Delete a file or directory within the selected project root.
 */
app.delete('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { path: targetPath, projectPath } = req.body;
        const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
        const { absolutePath } = await resolveProjectPath(projectRoot, String(targetPath || ''));

        if (absolutePath === projectRoot) {
            return res.status(400).json({ error: 'Project root cannot be deleted' });
        }

        const targetStats = await fsPromises.stat(absolutePath).catch(() => null);
        if (!targetStats) {
            return res.status(404).json({ error: 'Path not found' });
        }

        await fsPromises.rm(absolutePath, { recursive: true, force: false });

        res.json(buildMutationResponse(projectRoot, absolutePath, {
            type: targetStats.isDirectory() ? 'directory' : 'file',
            message: 'Path deleted successfully',
        }));
    } catch (error) {
        console.error('Error deleting project entry:', error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

/**
 * Upload files or nested folders into the selected project root with preserved relative paths.
 */
app.post('/api/projects/:projectName/files/upload', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const upload = multer({ storage: multer.memoryStorage() });

        upload.array('files')(req, res, async (uploadError) => {
            if (uploadError) {
                return res.status(400).json({ error: 'Failed to process upload payload' });
            }

            const files = Array.isArray(req.files) ? req.files : [];
            const { targetPath = '', relativePaths = '[]', projectPath = '' } = req.body;

            if (files.length === 0) {
                return res.status(400).json({ error: 'No files provided' });
            }

            let parsedRelativePaths;
            try {
                parsedRelativePaths = JSON.parse(relativePaths);
            } catch {
                return res.status(400).json({ error: 'relativePaths must be valid JSON' });
            }

            if (!Array.isArray(parsedRelativePaths) || parsedRelativePaths.length !== files.length) {
                return res.status(400).json({ error: 'relativePaths must match uploaded files' });
            }

            const projectRoot = await resolveProjectRootWithHint(req.params.projectName, String(projectPath || ''));
            const { absolutePath: targetDirectory } = await resolveProjectPath(projectRoot, String(targetPath), {
                allowRoot: true,
            });
            const targetStats = await fsPromises.stat(targetDirectory).catch(() => null);
            if (!targetStats?.isDirectory()) {
                return res.status(404).json({ error: 'Target directory not found' });
            }

            for (let index = 0; index < files.length; index += 1) {
                const relativeUploadPath = sanitizeUploadRelativePath(parsedRelativePaths[index]);
                const destinationPath = path.resolve(targetDirectory, relativeUploadPath);
                const relativeToTarget = path.relative(targetDirectory, destinationPath);
                if (relativeToTarget.startsWith('..') || path.isAbsolute(relativeToTarget)) {
                    return res.status(403).json({ error: 'Upload path must stay under project root' });
                }

                await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
                await fsPromises.writeFile(destinationPath, files[index].buffer);
            }

            res.json({
                success: true,
                uploadedCount: files.length,
                message: 'Upload completed successfully',
            });
        });
    } catch (error) {
        console.error('Error uploading project files:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Download a single project file without text transcoding.
 */
app.get('/api/projects/:projectName/files/download', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { path: targetPath, projectPath } = req.query;
        const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
        const { absolutePath } = await resolveProjectPath(projectRoot, String(targetPath || ''));
        const targetStats = await fsPromises.stat(absolutePath).catch(() => null);

        if (!targetStats) {
            return res.status(404).json({ error: 'File not found' });
        }
        if (!targetStats.isFile()) {
            return res.status(400).json({ error: 'Requested path is not a file' });
        }

        return sendDownload(res, absolutePath, path.basename(absolutePath));
    } catch (error) {
        console.error('Error downloading project file:', error);
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        return res.status(500).json({ error: error.message });
    }
});

/**
 * Download a directory as a zip archive while preserving nested relative paths.
 */
app.get('/api/projects/:projectName/folders/download', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { path: targetPath, projectPath } = req.query;
        const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
        const { absolutePath } = await resolveProjectPath(projectRoot, String(targetPath || ''));
        const targetStats = await fsPromises.stat(absolutePath).catch(() => null);

        if (!targetStats) {
            return res.status(404).json({ error: 'Folder not found' });
        }
        if (!targetStats.isDirectory()) {
            return res.status(400).json({ error: 'Requested path is not a directory' });
        }

        const archivePath = await createDirectoryArchive(absolutePath);
        return sendDownload(res, archivePath, `${path.basename(absolutePath)}.zip`, path.dirname(archivePath));
    } catch (error) {
        console.error('Error downloading project folder:', error);
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        return res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
    try {
        const rawProjectName = req.params.projectName;
        const pathQuery = req.query.path;
        const projectPathQuery = req.query.projectPath;
        const depthQuery = req.query.depth;
        const showHiddenQuery = req.query.showHidden;

        const targetPath = typeof pathQuery === 'string' ? pathQuery : '';
        let maxDepth = 10;

        if (typeof depthQuery === 'string') {
            const parsedDepth = Number.parseInt(depthQuery, 10);
            if (!Number.isNaN(parsedDepth) && parsedDepth >= 0) {
                maxDepth = parsedDepth;
            }
        }

        const showHidden = showHiddenQuery ? showHiddenQuery !== 'false' : true;

        try {
            const projectRoot = await resolveProjectRootWithHint(rawProjectName, String(projectPathQuery || ''));
            const projectTarget = await resolveProjectPath(projectRoot, targetPath, { allowRoot: true });
            const absolutePath = projectTarget.absolutePath;

            await fsPromises.access(absolutePath);

            const files = await getFileTree(absolutePath, maxDepth, 0, showHidden);
            res.json(files);
        } catch (e) {
            if (e.statusCode === 403) {
                return res.status(403).json({ error: e.message || 'Path is not allowed' });
            }
            if (e.statusCode === 404) {
                return res.status(404).json({ error: 'Project path not found' });
            }
            if (e.statusCode === 400) {
                return res.status(400).json({ error: e.message || 'Invalid request' });
            }
            if (e.code === 'ENOENT') {
                return res.status(404).json({ error: 'Project path not found' });
            }
            throw e;
        }
    } catch (error) {
        console.error('[ERROR] File tree error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
    const url = request.url;
    console.log('[INFO] Client connected to:', url);

    // Parse URL to get pathname without query parameters
    const urlObj = new URL(url, 'http://localhost');
    const pathname = urlObj.pathname;

    if (pathname === '/shell') {
        handleShellConnection(ws);
    } else if (pathname === '/ws') {
        handleChatConnection(ws, request);
    } else {
        console.log('[WARN] Unknown WebSocket path:', pathname);
        ws.close();
    }
});

/**
 * WebSocket Writer - Wrapper for WebSocket to match SSEStreamWriter interface
 */
class WebSocketWriter {
    constructor(ws, sendFn) {
        this.ws = ws;
        this.sendFn = sendFn;
        this.sessionId = null;
        this.sessionIndexContext = null;
        this.isWebSocketWriter = true;  // Marker for transport detection
    }

    send(data) {
        if (typeof this.sendFn === 'function') {
            this.sendFn(data, this.sessionId);
            return;
        }

        if (this.ws.readyState === 1) { // WebSocket.OPEN
            // Providers send raw objects, we stringify for WebSocket
            this.ws.send(JSON.stringify(data));
        }
    }

    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }

    getSessionId() {
        return this.sessionId;
    }

    setSessionIndexContext(context) {
        /**
         * Attach the ccflow route id used to mirror provider events into the index.
         */
        this.sessionIndexContext = context;
    }

    getSessionIndexContext() {
        /**
         * Return the active ccflow index context for fire-and-forget event writes.
         */
        return this.sessionIndexContext;
    }
}

async function finalizeCcflowRouteSession({
    projectName,
    projectPath,
    provider,
    ccflowSessionId,
    startRequestId,
    providerSessionId,
}) {
    /**
     * Promote a route-only manual session (cN) to the provider session id.
     */
    if (!ccflowSessionId || !providerSessionId) {
        return;
    }

    await bindManualSessionDraftProviderSession(
        projectName || '',
        projectPath || '',
        ccflowSessionId,
        providerSessionId,
        startRequestId,
    );

    let finalized = false;
    try {
        finalized = await finalizeManualSessionDraft(
            projectName || '',
            ccflowSessionId,
            providerSessionId,
            provider,
            projectPath || '',
        );
    } catch (error) {
        console.warn('[ManualSession] Failed to finalize manual session draft:', error.message);
    }

    return finalized;
}

// Handle chat WebSocket connections
function handleChatConnection(ws, request) {
    console.log('[INFO] Chat WebSocket connected');

    // Add to connected clients for project updates
    connectedClients.add(ws);
    chatClientUsers.set(ws, request?.user?.id || null);

    const sendToChatClients = (payload) => {
        const sourceUserId = chatClientUsers.get(ws) || null;
        const indexContext = writer.getSessionIndexContext();
        const indexedPayload = indexContext?.ccflowSessionId
            ? {
                ...payload,
                ccflowSessionId: indexContext.ccflowSessionId,
                ccflow_session_id: indexContext.ccflowSessionId,
            }
            : payload;
        if (indexContext?.ccflowSessionId && payload?.type === 'session-created' && payload?.sessionId) {
            void (async () => {
                await bindManualSessionDraftProviderSession(
                    indexContext.projectName || '',
                    indexContext.projectPath || '',
                    indexContext.ccflowSessionId,
                    payload.sessionId,
                    indexContext.startRequestId || '',
                );
                const runtime = await getManualSessionDraftRuntime(
                    indexContext.projectName || '',
                    indexContext.projectPath || '',
                    indexContext.ccflowSessionId,
                );
                const runtimeProvider = runtime?.provider || payload.provider || indexContext.provider || 'codex';
                if (runtime?.cancelRequested) {
                    if (runtimeProvider === 'codex') {
                        abortCodexSession(payload.sessionId);
                    } else {
                        await abortClaudeSDKSession(payload.sessionId);
                    }
                    return;
                }
                await finalizeCcflowRouteSession({
                    projectName: indexContext.projectName || '',
                    projectPath: indexContext.projectPath || '',
                    provider: runtimeProvider,
                    ccflowSessionId: indexContext.ccflowSessionId,
                    startRequestId: indexContext.startRequestId || '',
                    providerSessionId: payload.sessionId,
                });
            })().catch((error) => {
                console.warn('[ManualSession] Failed to store pending provider session:', error.message);
            });
        }
        broadcastChatEvent(indexedPayload, sourceUserId);
    };

    // Wrap WebSocket with writer for consistent interface with SSEStreamWriter
    const writer = new WebSocketWriter(ws, sendToChatClients);

    ws.on('message', async (message) => {
        let data = null;
        try {
            data = JSON.parse(message);

            if (data.type === 'claude-command') {
                if (!acceptChatRequestId(data.clientRequestId || data.options?.clientRequestId)) {
                    console.warn('[DEBUG] Ignoring duplicate Claude request:', data.clientRequestId || data.options?.clientRequestId);
                    return;
                }
                const resolvedOptions = await resolveChatProjectOptions(data.options, extractProjectDirectory);
                const {
                    ccflowSessionId,
                    startRequestId,
                    clientRef,
                } = resolveCcflowSessionStartContext(data, resolvedOptions);
                const claudeProviderOptions = ccflowSessionId
                    ? { ...resolvedOptions, sessionId: undefined, resume: false }
                    : resolvedOptions;
                writer.setSessionIndexContext(ccflowSessionId ? {
                    projectName: claudeProviderOptions?.projectName || data.options?.projectName || '',
                    projectPath: claudeProviderOptions?.projectPath || claudeProviderOptions?.cwd || '',
                    provider: 'claude',
                    ccflowSessionId,
                    startRequestId,
                } : null);
                if (ccflowSessionId) {
                    const startResult = await startManualSessionDraft(
                        claudeProviderOptions?.projectName || data.options?.projectName || '',
                        claudeProviderOptions?.projectPath || claudeProviderOptions?.cwd || '',
                        ccflowSessionId,
                        'claude',
                        startRequestId,
                    );
                    if (!startResult.started) {
                        writer.send({
                            type: 'session-start-rejected',
                            sessionId: ccflowSessionId,
                            ccflowSessionId,
                            provider: 'claude',
                            reason: startResult.reason,
                            startRequestId: startResult.startRequestId,
                        });
                        return;
                    }
                    writer.send({
                        type: 'message-accepted',
                        sessionId: ccflowSessionId,
                        ccflowSessionId,
                        provider: 'claude',
                        clientRequestId: startRequestId,
                        startRequestId,
                    });
                }
                console.log('[DEBUG] User message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', claudeProviderOptions?.projectPath || claudeProviderOptions?.cwd || 'Unknown');
                console.log('🔄 Session:', claudeProviderOptions?.sessionId ? 'Resume' : 'New');

                // Use Claude Agents SDK
                const sessionModelState = claudeProviderOptions?.sessionId
                    ? await getSessionModelState(
                        claudeProviderOptions?.projectPath || claudeProviderOptions?.cwd || '',
                        claudeProviderOptions.sessionId,
                    ).catch(() => ({}))
                    : {};
                const claudeOptions = {
                    ...claudeProviderOptions,
                    thinkingMode: sessionModelState.thinkingMode || claudeProviderOptions?.thinkingMode,
                };
                const resolvedSessionId = await queryClaudeSDK(data.command, claudeOptions, writer);
                if (ccflowSessionId && resolvedSessionId) {
                    await finalizeCcflowRouteSession({
                        projectName: claudeOptions?.projectName || data.options?.projectName || '',
                        projectPath: claudeOptions?.projectPath || claudeOptions?.cwd || '',
                        provider: 'claude',
                        ccflowSessionId,
                        startRequestId,
                        providerSessionId: resolvedSessionId,
                    });
                }
                if (resolvedSessionId && (claudeProviderOptions?.model || claudeOptions.thinkingMode)) {
                    try {
                        const state = await updateSessionModelState(
                            claudeProviderOptions?.projectPath || claudeProviderOptions?.cwd || '',
                            resolvedSessionId,
                            {
                                model: claudeProviderOptions?.model,
                                thinkingMode: claudeOptions.thinkingMode,
                            },
                        );
                        broadcastSessionModelStateUpdated({
                            sourceUserId: request?.user?.id || null,
                            projectName: claudeProviderOptions?.projectName || '',
                            projectPath: claudeProviderOptions?.projectPath || claudeProviderOptions?.cwd || '',
                            sessionId: resolvedSessionId,
                            provider: 'claude',
                            state,
                        });
                    } catch (modelStateError) {
                        console.warn('[Claude] Failed to persist session model state:', modelStateError.message);
                    }
                }
            } else if (data.type === 'codex-command') {
                if (!acceptChatRequestId(data.clientRequestId || data.options?.clientRequestId)) {
                    console.warn('[DEBUG] Ignoring duplicate Codex request:', data.clientRequestId || data.options?.clientRequestId);
                    return;
                }
                const resolvedOptions = await resolveChatProjectOptions(data.options, extractProjectDirectory);
                const {
                    ccflowSessionId,
                    startRequestId,
                    clientRef,
                } = resolveCcflowSessionStartContext(data, resolvedOptions);
                const codexProviderOptions = ccflowSessionId
                    ? { ...resolvedOptions, sessionId: undefined, resume: false }
                    : resolvedOptions;
                writer.setSessionIndexContext(ccflowSessionId ? {
                    projectName: codexProviderOptions?.projectName || data.options?.projectName || '',
                    projectPath: codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                    provider: 'codex',
                    ccflowSessionId,
                    startRequestId,
                } : null);
                if (ccflowSessionId) {
                    const startResult = await startManualSessionDraft(
                        codexProviderOptions?.projectName || data.options?.projectName || '',
                        codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                        ccflowSessionId,
                        'codex',
                        startRequestId,
                    );
                    if (!startResult.started) {
                        writer.send({
                            type: 'session-start-rejected',
                            sessionId: ccflowSessionId,
                            ccflowSessionId,
                            provider: 'codex',
                            reason: startResult.reason,
                            startRequestId: startResult.startRequestId,
                        });
                        return;
                    }
                    writer.send({
                        type: 'message-accepted',
                        sessionId: ccflowSessionId,
                        ccflowSessionId,
                        provider: 'codex',
                        clientRequestId: startRequestId,
                        startRequestId,
                    });
                }
                console.log('[DEBUG] Codex message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', codexProviderOptions?.projectPath || codexProviderOptions?.cwd || 'Unknown');
                console.log('🔄 Session:', codexProviderOptions?.sessionId ? 'Resume' : 'New');
                console.log('🤖 Model:', codexProviderOptions?.model || 'default');
                const sessionModelState = codexProviderOptions?.sessionId
                    ? await getSessionModelState(
                        codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                        codexProviderOptions.sessionId,
                    ).catch(() => ({}))
                    : {};
                const codexOptions = {
                    ...codexProviderOptions,
                    reasoningEffort: sessionModelState.reasoningEffort || codexProviderOptions?.reasoningEffort,
                };
                const resolvedSessionId = await queryCodex(data.command, codexOptions, writer);
                if (ccflowSessionId && resolvedSessionId) {
                    await finalizeCcflowRouteSession({
                        projectName: codexOptions?.projectName || data.options?.projectName || '',
                        projectPath: codexOptions?.projectPath || codexOptions?.cwd || '',
                        provider: 'codex',
                        ccflowSessionId,
                        startRequestId,
                        providerSessionId: resolvedSessionId,
                    });
                }
                if (resolvedSessionId && (codexProviderOptions?.model || codexProviderOptions?.reasoningEffort)) {
                    try {
                        const state = await updateSessionModelState(
                            codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                            resolvedSessionId,
                            {
                                model: codexProviderOptions?.model,
                                reasoningEffort: codexOptions.reasoningEffort,
                            },
                        );
                        broadcastSessionModelStateUpdated({
                            sourceUserId: request?.user?.id || null,
                            projectName: codexProviderOptions?.projectName || '',
                            projectPath: codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                            sessionId: resolvedSessionId,
                            state,
                        });
                    } catch (modelStateError) {
                        console.warn('[Codex] Failed to persist session model state:', modelStateError.message);
                    }
                }
            } else if (data.type === 'abort-session') {
                console.log('[DEBUG] Abort session request:', data.sessionId);
                const provider = data.provider || 'claude';
                const ccflowSessionId = isCcflowRouteSessionId(data.ccflowSessionId || data.sessionId)
                    ? (data.ccflowSessionId || data.sessionId)
                    : null;
                let targetSessionId = data.sessionId;
                let success;

                if (ccflowSessionId) {
                    const runtime = await getManualSessionDraftRuntime(
                        data.projectName || '',
                        data.projectPath || '',
                        ccflowSessionId,
                    );
                    await markManualSessionDraftCancelRequested(
                        data.projectName || '',
                        data.projectPath || '',
                        ccflowSessionId,
                        data.startRequestId || '',
                    );
                    targetSessionId = runtime?.pendingProviderSessionId || null;
                    if (!targetSessionId) {
                        success = true;
                    }
                }

                if (targetSessionId) {
                    if (provider === 'codex') {
                        success = abortCodexSession(targetSessionId);
                    } else {
                        // Use Claude Agents SDK
                        success = await abortClaudeSDKSession(targetSessionId);
                    }
                }

                writer.send({
                    type: 'session-aborted',
                    sessionId: data.sessionId,
                    actualSessionId: targetSessionId,
                    ccflowSessionId,
                    provider,
                    success
                });
            } else if (data.type === 'claude-permission-response') {
                // Relay UI approval decisions back into the SDK control flow.
                // This does not persist permissions; it only resolves the in-flight request,
                // introduced so the SDK can resume once the user clicks Allow/Deny.
                if (data.requestId) {
                    resolveToolApproval(data.requestId, {
                        allow: Boolean(data.allow),
                        updatedInput: data.updatedInput,
                        message: data.message,
                        rememberEntry: data.rememberEntry
                    });
                }
            } else if (data.type === 'check-session-status') {
                // Check if a specific session is currently processing
                const provider = data.provider || 'claude';
                const sessionId = data.sessionId;
                let isActive;

                if (provider === 'codex') {
                    isActive = isCodexSessionActive(sessionId);
                } else {
                    // Use Claude Agents SDK
                    isActive = isClaudeSDKSessionActive(sessionId);
                }

                writer.send({
                    type: 'session-status',
                    sessionId,
                    provider,
                    isProcessing: isActive
                });
            } else if (data.type === 'get-active-sessions') {
                // Get all currently active sessions
                const activeSessions = {
                    claude: getActiveClaudeSDKSessions(),
                    codex: getActiveCodexSessions(),
                };
                writer.send({
                    type: 'active-sessions',
                    sessions: activeSessions
                });
            } else if (data.type === 'ping') {
                writer.send({
                    type: 'pong',
                    timestamp: data.timestamp || Date.now()
                });
            }
        } catch (error) {
            console.error('[ERROR] Chat WebSocket error:', error.message);
            let errorType = 'error';
            if (data?.type === 'claude-command') {
                errorType = 'claude-error';
            } else if (data?.type === 'codex-command') {
                errorType = 'codex-error';
            }
            writer.send({
                type: errorType,
                error: error.message
            });
        }
    });

    ws.on('close', () => {
        console.log('🔌 Chat client disconnected');
        // Remove from connected clients
        connectedClients.delete(ws);
        chatClientUsers.delete(ws);
    });
}

// Handle shell WebSocket connections
function handleShellConnection(ws) {
    console.log('🐚 Shell client connected');
    let shellProcess = null;
    let ptySessionKey = null;
    let keepSessionAliveOnDisconnect = false;
    let urlDetectionBuffer = '';
    const announcedAuthUrls = new Set();

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Shell message received:', data.type);

            if (data.type === 'init') {
                const projectPath = data.projectPath || process.cwd();
                const sessionId = data.sessionId;
                const hasSession = data.hasSession;
                const provider = data.provider || 'claude';
                const initialCommand = data.initialCommand;
                const isPlainShell = data.isPlainShell || (!!initialCommand && !hasSession) || provider === 'plain-shell';
                keepSessionAliveOnDisconnect = !isPlainShell;
                urlDetectionBuffer = '';
                announcedAuthUrls.clear();

                // Login commands should never reuse cached sessions.
                const isLoginCommand = initialCommand && (
                    initialCommand.includes('setup-token') ||
                    initialCommand.includes('auth login')
                );

                // Include command hash in session key so different commands get separate sessions
                const commandSuffix = isPlainShell && initialCommand
                    ? `_cmd_${Buffer.from(initialCommand).toString('base64').slice(0, 16)}`
                    : '';
                ptySessionKey = `${projectPath}_${sessionId || 'default'}${commandSuffix}`;

                // Kill any existing login session before starting fresh
                if (isLoginCommand) {
                    const oldSession = ptySessionsMap.get(ptySessionKey);
                    if (oldSession) {
                        console.log('🧹 Cleaning up existing login session:', ptySessionKey);
                        if (oldSession.timeoutId) clearTimeout(oldSession.timeoutId);
                        if (oldSession.pty && oldSession.pty.kill) oldSession.pty.kill();
                        ptySessionsMap.delete(ptySessionKey);
                    }
                }

                const existingSession = isLoginCommand || isPlainShell ? null : ptySessionsMap.get(ptySessionKey);
                if (existingSession) {
                    console.log('♻️  Reconnecting to existing PTY session:', ptySessionKey);
                    shellProcess = existingSession.pty;

                    clearTimeout(existingSession.timeoutId);
                    existingSession.timeoutId = null;

                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\x1b[36m[Reconnected to existing session]\x1b[0m\r\n`
                    }));

                    if (existingSession.buffer && existingSession.buffer.length > 0) {
                        console.log(`📜 Sending ${existingSession.buffer.length} buffered messages`);
                        existingSession.buffer.forEach(bufferedData => {
                            ws.send(JSON.stringify({
                                type: 'output',
                                data: bufferedData
                            }));
                        });
                    }

                    existingSession.ws = ws;

                    return;
                }

                console.log('[INFO] Starting shell in:', projectPath);
                console.log('📋 Session info:', hasSession ? `Resume session ${sessionId}` : (isPlainShell ? 'Plain shell mode' : 'New session'));
                console.log('🤖 Provider:', isPlainShell ? 'plain-shell' : provider);
                if (initialCommand) {
                    console.log('⚡ Initial command:', initialCommand);
                }

                // First send a welcome message
                let welcomeMsg;
                if (isPlainShell) {
                    welcomeMsg = `\x1b[36mStarting terminal in: ${projectPath}\x1b[0m\r\n`;
                } else {
                    const providerName = provider === 'codex' ? 'Codex' : 'Claude';
                    welcomeMsg = hasSession ?
                        `\x1b[36mResuming ${providerName} session ${sessionId} in: ${projectPath}\x1b[0m\r\n` :
                        `\x1b[36mStarting new ${providerName} session in: ${projectPath}\x1b[0m\r\n`;
                }

                ws.send(JSON.stringify({
                    type: 'output',
                    data: welcomeMsg
                }));

                try {
                    // Prepare the shell command adapted to the platform and provider
                    let shellCommand;
                    if (isPlainShell) {
                        // Plain shell mode - open an interactive shell by default, or run the provided command.
                        if (os.platform() === 'win32') {
                            shellCommand = initialCommand
                                ? `Set-Location -Path "${projectPath}"; ${initialCommand}`
                                : `Set-Location -Path "${projectPath}"; powershell.exe -NoExit`;
                        } else {
                            shellCommand = initialCommand
                                ? `cd "${projectPath}" && ${initialCommand}`
                                : `cd "${projectPath}" && exec "${process.env.SHELL || '/bin/bash'}" -l`;
                        }
                    } else if (provider === 'codex') {
                        // Use codex command
                        if (os.platform() === 'win32') {
                            if (hasSession && sessionId) {
                                // Try to resume session, but with fallback to a new session if it fails
                                shellCommand = `Set-Location -Path "${projectPath}"; codex resume "${sessionId}"; if ($LASTEXITCODE -ne 0) { codex }`;
                            } else {
                                shellCommand = `Set-Location -Path "${projectPath}"; codex`;
                            }
                        } else {
                            if (hasSession && sessionId) {
                                // Try to resume session, but with fallback to a new session if it fails
                                shellCommand = `cd "${projectPath}" && codex resume "${sessionId}" || codex`;
                            } else {
                                shellCommand = `cd "${projectPath}" && codex`;
                            }
                        }
                    } else {
                        // Use claude command (default) or initialCommand if provided
                        const command = initialCommand || 'claude';
                        if (os.platform() === 'win32') {
                            if (hasSession && sessionId) {
                                // Try to resume session, but with fallback to new session if it fails
                                shellCommand = `Set-Location -Path "${projectPath}"; claude --resume ${sessionId}; if ($LASTEXITCODE -ne 0) { claude }`;
                            } else {
                                shellCommand = `Set-Location -Path "${projectPath}"; ${command}`;
                            }
                        } else {
                            if (hasSession && sessionId) {
                                shellCommand = `cd "${projectPath}" && claude --resume ${sessionId} || claude`;
                            } else {
                                shellCommand = `cd "${projectPath}" && ${command}`;
                            }
                        }
                    }

                    console.log('🔧 Executing shell command:', shellCommand);

                    // Use appropriate shell based on platform
                    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                    const shellArgs = os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];

                    // Use terminal dimensions from client if provided, otherwise use defaults
                    const termCols = data.cols || 80;
                    const termRows = data.rows || 24;
                    console.log('📐 Using terminal dimensions:', termCols, 'x', termRows);

                    shellProcess = pty.spawn(shell, shellArgs, {
                        name: 'xterm-256color',
                        cols: termCols,
                        rows: termRows,
                        cwd: os.homedir(),
                        env: {
                            ...process.env,
                            TERM: 'xterm-256color',
                            COLORTERM: 'truecolor',
                            FORCE_COLOR: '3'
                        }
                    });

                    console.log('🟢 Shell process started with PTY, PID:', shellProcess.pid);

                    ptySessionsMap.set(ptySessionKey, {
                        pty: shellProcess,
                        ws: ws,
                        buffer: [],
                        timeoutId: null,
                        projectPath,
                        sessionId
                    });

                    // Handle data output
                    shellProcess.onData((data) => {
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (!session) return;

                        if (session.buffer.length < 5000) {
                            session.buffer.push(data);
                        } else {
                            session.buffer.shift();
                            session.buffer.push(data);
                        }

                        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                            let outputData = data;

                            const cleanChunk = stripAnsiSequences(data);
                            urlDetectionBuffer = `${urlDetectionBuffer}${cleanChunk}`.slice(-SHELL_URL_PARSE_BUFFER_LIMIT);

                            outputData = outputData.replace(
                                /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
                                '[INFO] Opening in browser: $1'
                            );

                            const emitAuthUrl = (detectedUrl, autoOpen = false) => {
                                const normalizedUrl = normalizeDetectedUrl(detectedUrl);
                                if (!normalizedUrl) return;

                                const isNewUrl = !announcedAuthUrls.has(normalizedUrl);
                                if (isNewUrl) {
                                    announcedAuthUrls.add(normalizedUrl);
                                    session.ws.send(JSON.stringify({
                                        type: 'auth_url',
                                        url: normalizedUrl,
                                        autoOpen
                                    }));
                                }

                            };

                            const normalizedDetectedUrls = extractUrlsFromText(urlDetectionBuffer)
                                .map((url) => normalizeDetectedUrl(url))
                                .filter(Boolean);

                            // Prefer the most complete URL if shorter prefix variants are also present.
                            const dedupedDetectedUrls = Array.from(new Set(normalizedDetectedUrls)).filter((url, _, urls) =>
                                !urls.some((otherUrl) => otherUrl !== url && otherUrl.startsWith(url))
                            );

                            dedupedDetectedUrls.forEach((url) => emitAuthUrl(url, false));

                            if (shouldAutoOpenUrlFromOutput(cleanChunk) && dedupedDetectedUrls.length > 0) {
                                const bestUrl = dedupedDetectedUrls.reduce((longest, current) =>
                                    current.length > longest.length ? current : longest
                                );
                                emitAuthUrl(bestUrl, true);
                            }

                            // Send regular output
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: outputData
                            }));
                        }
                    });

                    // Handle process exit
                    shellProcess.onExit((exitCode) => {
                        console.log('🔚 Shell process exited with code:', exitCode.exitCode, 'signal:', exitCode.signal);
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${exitCode.signal ? ` (${exitCode.signal})` : ''}\x1b[0m\r\n`
                            }));
                        }
                        if (session && session.timeoutId) {
                            clearTimeout(session.timeoutId);
                        }
                        ptySessionsMap.delete(ptySessionKey);
                        shellProcess = null;
                    });

                } catch (spawnError) {
                    console.error('[ERROR] Error spawning process:', spawnError);
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\r\n\x1b[31mError: ${spawnError.message}\x1b[0m\r\n`
                    }));
                }

            } else if (data.type === 'ping') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: data.timestamp || Date.now()
                }));
            } else if (data.type === 'input') {
                // Send input to shell process
                if (shellProcess && shellProcess.write) {
                    try {
                        shellProcess.write(data.data);
                    } catch (error) {
                        console.error('Error writing to shell:', error);
                    }
                } else {
                    console.warn('No active shell process to send input to');
                }
            } else if (data.type === 'resize') {
                // Handle terminal resize
                if (shellProcess && shellProcess.resize) {
                    console.log('Terminal resize requested:', data.cols, 'x', data.rows);
                    shellProcess.resize(data.cols, data.rows);
                }
            }
        } catch (error) {
            console.error('[ERROR] Shell WebSocket error:', error.message);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'output',
                    data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('🔌 Shell client disconnected');

        if (ptySessionKey) {
            const session = ptySessionsMap.get(ptySessionKey);
            if (session) {
                if (!keepSessionAliveOnDisconnect) {
                    console.log('🧹 Closing plain shell PTY immediately:', ptySessionKey);
                    if (session.timeoutId) {
                        clearTimeout(session.timeoutId);
                    }
                    if (session.pty && session.pty.kill) {
                        session.pty.kill();
                    }
                    ptySessionsMap.delete(ptySessionKey);
                    return;
                }

                console.log('⏳ PTY session kept alive, will timeout in 30 minutes:', ptySessionKey);
                if (session.ws !== ws) {
                    console.log('ℹ️  Ignoring stale shell socket close because session already moved to a newer websocket');
                    return;
                }

                session.ws = null;

                session.timeoutId = setTimeout(() => {
                    console.log('⏰ PTY session timeout, killing process:', ptySessionKey);
                    if (session.pty && session.pty.kill) {
                        session.pty.kill();
                    }
                    ptySessionsMap.delete(ptySessionKey);
                }, PTY_SESSION_TIMEOUT);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('[ERROR] Shell WebSocket error:', error);
    });
}
// Audio transcription endpoint
app.post('/api/transcribe', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const upload = multer({ storage: multer.memoryStorage() });

        // Handle multipart form data
        upload.single('audio')(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: 'Failed to process audio file' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No audio file provided' });
            }

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in server environment.' });
            }

            try {
                // Create form data for OpenAI
                const FormData = (await import('form-data')).default;
                const formData = new FormData();
                formData.append('file', req.file.buffer, {
                    filename: req.file.originalname,
                    contentType: req.file.mimetype
                });
                formData.append('model', 'whisper-1');
                formData.append('response_format', 'json');
                formData.append('language', 'en');

                // Make request to OpenAI
                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        ...formData.getHeaders()
                    },
                    body: formData
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
                }

                const data = await response.json();
                let transcribedText = data.text || '';

                // Check if enhancement mode is enabled
                const mode = req.body.mode || 'default';

                // If no transcribed text, return empty
                if (!transcribedText) {
                    return res.json({ text: '' });
                }

                // If default mode, return transcribed text without enhancement
                if (mode === 'default') {
                    return res.json({ text: transcribedText });
                }

                // Handle different enhancement modes
                try {
                    const OpenAI = (await import('openai')).default;
                    const openai = new OpenAI({ apiKey });

                    let prompt, systemMessage, temperature = 0.7, maxTokens = 800;

                    switch (mode) {
                        case 'prompt':
                            systemMessage = 'You are an expert prompt engineer who creates clear, detailed, and effective prompts.';
                            prompt = `You are an expert prompt engineer. Transform the following rough instruction into a clear, detailed, and context-aware AI prompt.

Your enhanced prompt should:
1. Be specific and unambiguous
2. Include relevant context and constraints
3. Specify the desired output format
4. Use clear, actionable language
5. Include examples where helpful
6. Consider edge cases and potential ambiguities

Transform this rough instruction into a well-crafted prompt:
"${transcribedText}"

Enhanced prompt:`;
                            break;

                        case 'vibe':
                        case 'instructions':
                        case 'architect':
                            systemMessage = 'You are a helpful assistant that formats ideas into clear, actionable instructions for AI agents.';
                            temperature = 0.5; // Lower temperature for more controlled output
                            prompt = `Transform the following idea into clear, well-structured instructions that an AI agent can easily understand and execute.

IMPORTANT RULES:
- Format as clear, step-by-step instructions
- Add reasonable implementation details based on common patterns
- Only include details directly related to what was asked
- Do NOT add features or functionality not mentioned
- Keep the original intent and scope intact
- Use clear, actionable language an agent can follow

Transform this idea into agent-friendly instructions:
"${transcribedText}"

Agent instructions:`;
                            break;

                        default:
                            // No enhancement needed
                            break;
                    }

                    // Only make GPT call if we have a prompt
                    if (prompt) {
                        const completion = await openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                { role: 'system', content: systemMessage },
                                { role: 'user', content: prompt }
                            ],
                            temperature: temperature,
                            max_tokens: maxTokens
                        });

                        transcribedText = completion.choices[0].message.content || transcribedText;
                    }

                } catch (gptError) {
                    console.error('GPT processing error:', gptError);
                    // Fall back to original transcription if GPT fails
                }

                res.json({ text: transcribedText });

            } catch (error) {
                console.error('Transcription error:', error);
                res.status(500).json({ error: error.message });
            }
        });
    } catch (error) {
        console.error('Endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Chat attachment upload endpoint
app.post('/api/projects/:projectName/upload-attachments', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const uploadRoot = path.join(CHAT_UPLOAD_ROOT, String(req.user.id), '.incoming');

        await fsPromises.mkdir(uploadRoot, { recursive: true });

        /**
         * PURPOSE: Stage raw browser uploads in a temporary directory before we
         * move them into the final per-message batch tree under ~/ccflow-uploads.
         */
        const storage = multer.diskStorage({
            destination: async (_request, _file, cb) => {
                cb(null, uploadRoot);
            },
            filename: (_request, file, cb) => {
                const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
                cb(null, `${uniqueSuffix}-${sanitizeFilename(file.originalname)}`);
            }
        });

        const upload = multer({
            storage,
            limits: {
                fileSize: 25 * 1024 * 1024,
                files: 100
            }
        });

        upload.array('attachments', 100)(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No attachment files provided' });
            }

            try {
                let parsedRelativePaths = null;
                if (typeof req.body.relativePaths === 'string' && req.body.relativePaths) {
                    parsedRelativePaths = JSON.parse(req.body.relativePaths);
                    if (!Array.isArray(parsedRelativePaths) || parsedRelativePaths.length !== req.files.length) {
                        return res.status(400).json({ error: 'relativePaths must match uploaded files' });
                    }
                }

                const persistedBatch = await persistChatUploads(req.files, {
                    relativePaths: parsedRelativePaths,
                    userId: req.user.id,
                });

                res.json({
                    rootPath: persistedBatch.rootPath,
                    attachments: persistedBatch.attachments,
                });
            } catch (error) {
                console.error('Error processing chat attachments:', error);
                await Promise.all(req.files.map((file) => fsPromises.unlink(file.path).catch(() => { })));
                res.status(500).json({ error: 'Failed to process chat attachments' });
            }
        });
    } catch (error) {
        console.error('Error in chat attachment upload endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get token usage for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/token-usage', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { provider = 'claude' } = req.query;
        const homeDir = os.homedir();

        // Allow only safe characters in sessionId
        const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
        if (!safeSessionId) {
            return res.status(400).json({ error: 'Invalid sessionId' });
        }

        const parsedContextWindow = parseInt(process.env.CONTEXT_WINDOW, 10);
        const contextWindow = Number.isFinite(parsedContextWindow) ? parsedContextWindow : 160000;

        // Handle Codex sessions
        if (provider === 'codex') {
            const tokenUsage = await getCodexSessionTokenUsage(safeSessionId, { homeDir });
            if (!tokenUsage) {
                return res.status(204).send();
            }
            return res.json(tokenUsage);
        }

        // Handle Claude sessions (default)
        // Extract actual project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            console.error('Error extracting project directory:', error);
            return res.status(500).json({ error: 'Failed to determine project path' });
        }

        // Construct the JSONL file path
        // Claude stores session files in ~/.claude/projects/[encoded-project-path]/[session-id].jsonl
        // The encoding replaces any non-alphanumeric character (except -) with -
        const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
        const projectDir = path.join(homeDir, '.claude', 'projects', encodedPath);

        const jsonlPath = path.join(projectDir, `${safeSessionId}.jsonl`);

        // Constrain to projectDir
        const rel = path.relative(path.resolve(projectDir), path.resolve(jsonlPath));
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            return res.status(400).json({ error: 'Invalid path' });
        }

        // Ensure the session file exists before parsing normalized token usage.
        try {
            await fsPromises.access(jsonlPath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(204).send();
            }
            throw error;
        }
        const tokenUsage = await getClaudeSessionTokenUsage(jsonlPath, { contextWindow });
        if (!tokenUsage) {
            return res.status(204).send();
        }

        res.json(tokenUsage);
    } catch (error) {
        console.error('Error reading session token usage:', error);
        res.status(500).json({ error: 'Failed to read session token usage' });
    }
});

// Serve React app for all other routes (excluding static files)
app.use('/api', (req, res) => {
    res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` });
});

// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
    // Skip requests for static assets (files with extensions)
    if (path.extname(req.path)) {
        return res.status(404).send('Not found');
    }

    // Only serve index.html for HTML routes, not for static assets
    // Static assets should already be handled by express.static middleware above
    const indexPath = path.join(__dirname, '../dist/index.html');

    // Check if dist/index.html exists (production build available)
    if (fs.existsSync(indexPath)) {
        // Set no-cache headers for HTML to prevent service worker issues
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    } else {
        // In development, redirect to Vite dev server only if dist doesn't exist
        res.redirect(`http://localhost:${process.env.VITE_PORT || 5173}`);
    }
});

// Helper function to convert permissions to rwx format
function shouldSkipTreeEntry(entryName) {
    return entryName === 'node_modules'
        || entryName === 'dist'
        || entryName === 'build'
        || entryName === '.git'
        || entryName === '.svn'
        || entryName === '.hg';
}

// Helper function to convert permissions to rwx format
function permToRwx(perm) {
    const r = perm & 4 ? 'r' : '-';
    const w = perm & 2 ? 'w' : '-';
    const x = perm & 1 ? 'x' : '-';
    return r + w + x;
}

async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true) {
    const items = [];

    try {
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!showHidden && entry.name.startsWith('.')) {
                continue;
            }

            // Skip heavy build directories and VCS directories.
            if (shouldSkipTreeEntry(entry.name)) {
                continue;
            }

            const itemPath = path.join(dirPath, entry.name);
            const item = {
                name: entry.name,
                path: itemPath,
                type: entry.isDirectory() ? 'directory' : 'file'
            };

            // Get file stats for additional metadata
            try {
                const stats = await fsPromises.stat(itemPath);
                item.size = stats.size;
                item.modified = stats.mtime.toISOString();

                // Convert permissions to rwx format
                const mode = stats.mode;
                const ownerPerm = (mode >> 6) & 7;
                const groupPerm = (mode >> 3) & 7;
                const otherPerm = mode & 7;
                item.permissions = ((mode >> 6) & 7).toString() + ((mode >> 3) & 7).toString() + (mode & 7).toString();
                item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
            } catch (statError) {
                // If stat fails, provide default values
                item.size = 0;
                item.modified = null;
                item.permissions = '000';
                item.permissionsRwx = '---------';
            }

            if (entry.isDirectory()) {
                if (currentDepth < maxDepth) {
                    // Recursively get subdirectories but limit depth.
                    try {
                        // Check if we can access the directory before trying to read it.
                        await fsPromises.access(item.path, fs.constants.R_OK);
                        item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden);
                        item.hasChildren = item.children.length > 0;
                    } catch (e) {
                        // Silently skip directories we can't access (permission denied, etc.).
                        item.children = [];
                        item.hasChildren = false;
                    }
                } else {
                    // Keep a child indicator for lazy loading without expanding content.
                    try {
                        const childEntries = await fsPromises.readdir(item.path, { withFileTypes: true });
                        item.hasChildren = childEntries.some((childEntry) => {
                            if (shouldSkipTreeEntry(childEntry.name)) {
                                return false;
                            }
                            return showHidden || !childEntry.name.startsWith('.');
                        });
                    } catch (e) {
                        item.hasChildren = false;
                    }
                }
            }

            items.push(item);
        }
    } catch (error) {
        // Only log non-permission errors to avoid spam
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
            console.error('Error reading directory:', error);
        }
    }

    return items.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
// Show localhost in URL when binding to all interfaces (0.0.0.0 isn't a connectable address)
const DISPLAY_HOST = HOST === '0.0.0.0' ? 'localhost' : HOST;

function clearSessionScanInterval() {
    if (sessionPathScanIntervalHandle) {
        clearInterval(sessionPathScanIntervalHandle);
        sessionPathScanIntervalHandle = null;
    }
}

/**
 * Terminate cached PTY sessions so no shell children survive service shutdown.
 */
function closePtySessions() {
    for (const [sessionKey, session] of ptySessionsMap.entries()) {
        if (session.timeoutId) {
            clearTimeout(session.timeoutId);
        }

        try {
            if (session.pty && session.pty.kill) {
                session.pty.kill();
            }
        } catch (error) {
            console.error(`[WARN] Failed to kill PTY session ${sessionKey}:`, error);
        }
    }

    ptySessionsMap.clear();
}

/**
 * Close all live WebSocket clients and stop accepting new upgrade requests.
 */
async function closeWebSocketServer() {
    connectedClients.forEach((client) => {
        try {
            if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
                client.close(1001, 'Server shutting down');
            }
        } catch (error) {
            console.error('[WARN] Failed to close chat WebSocket client:', error);
        }
    });

    for (const client of wss.clients) {
        try {
            if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
                client.close(1001, 'Server shutting down');
            }
        } catch (error) {
            console.error('[WARN] Failed to close WebSocket client:', error);
        }
    }

    await new Promise((resolve) => {
        wss.close(() => resolve());
    });
}

/**
 * Stop the HTTP server, WebSocket server, watchers, timers, and cached PTYs.
 */
async function shutdownServer(signal = 'SIGTERM') {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    console.log(`[INFO] Received ${signal}, starting graceful shutdown`);

    clearSessionScanInterval();
    stopWorkflowAutoRunner();
    await closeProjectsWatchers();
    closePtySessions();
    await closeWebSocketServer();

    await new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });

    console.log('[INFO] Graceful shutdown complete');
}

process.on('SIGINT', async () => {
    try {
        await shutdownServer('SIGINT');
        process.exit(0);
    } catch (error) {
        console.error('[ERROR] Graceful shutdown failed:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    try {
        await shutdownServer('SIGTERM');
        process.exit(0);
    } catch (error) {
        console.error('[ERROR] Graceful shutdown failed:', error);
        process.exit(1);
    }
});

// Initialize database and start server
async function startServer() {
    try {
        // Initialize authentication database
        await initializeDatabase();

        // Check if running in production mode (dist folder exists)
        const distIndexPath = path.join(__dirname, '../dist/index.html');
        const isProduction = fs.existsSync(distIndexPath);

        // Log Claude implementation mode
        console.log(`${c.info('[INFO]')} Using Claude Agents SDK for Claude integration`);
        console.log(`${c.info('[INFO]')} Running in ${c.bright(isProduction ? 'PRODUCTION' : 'DEVELOPMENT')} mode`);

        if (!isProduction) {
            console.log(`${c.warn('[WARN]')} Note: Requests will be proxied to Vite dev server at ${c.dim('http://localhost:' + (process.env.VITE_PORT || 5173))}`);
        }

        server.listen(PORT, HOST, async () => {
            const appInstallPath = path.join(__dirname, '..');

            console.log('');
            console.log(c.dim('═'.repeat(63)));
            console.log(`  ${c.bright('ccflow Server - Ready')}`);
            console.log(c.dim('═'.repeat(63)));
            console.log('');
            console.log(`${c.info('[INFO]')} Server URL:  ${c.bright('http://' + DISPLAY_HOST + ':' + PORT)}`);
            console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
            console.log(`${c.tip('[TIP]')}  Run "ccflow status" for full configuration details`);
            console.log('');

            try {
                await refreshMissingProjectPathCache({ logger: console });
            } catch (scanError) {
                console.error('[SessionVisibility] Startup scan failed:', scanError);
            }

            const scanIntervalMs = Number.parseInt(process.env.SESSION_PATH_SCAN_INTERVAL_MS || '', 10);
            if (Number.isFinite(scanIntervalMs) && scanIntervalMs > 0) {
                sessionPathScanIntervalHandle = setInterval(async () => {
                    try {
                        await refreshMissingProjectPathCache({ logger: console });
                    } catch (scanError) {
                        console.error('[SessionVisibility] Periodic scan failed:', scanError);
                    }
                }, scanIntervalMs);
                console.info(`[SessionVisibility] Periodic scan enabled (${scanIntervalMs}ms)`);
            }

            // Start watching the projects folder for changes
            await setupProjectsWatcher();
            startWorkflowAutoRunner({ logger: console });
        });
    } catch (error) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
