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
    getPiSessions,
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
    loadProjectConfig,
    findProjectChatRecord,
    extractProjectDirectory,
    clearProjectDirectoryCache,
    refreshMissingProjectPathCache
} from './projects.js';
import {
    assertCoProviderAvailable,
    buildCoRequest,
    readCoConversationState,
    resolveCoHome,
    runCoDoctor,
    tailCoEvents,
    writeCoRequest,
} from './co-client.js';
import { resolveChatProjectOptions } from './chat-project-path.js';
import { getUsageRemaining } from './usage-remaining.js';
import {
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
import opencodeRoutes from './routes/opencode.js';
import { initializeDatabase } from './database/db.js';
import { validateApiKey, authenticateToken, authenticateWebSocket } from './middleware/auth.js';
import { IS_PLATFORM } from './constants/config.js';
import {
    buildMutationResponse,
    createDirectoryArchive,
    joinProjectChildPath,
    resolveProjectPath,
    resolveReadableProjectPath,
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
    abortWorkflowRun,
    createProjectWorkflow,
    findProjectByName,
    getProjectWorkflow,
    listProjectAdoptableOpenSpecChanges,
    resumeWorkflowRun,
} from './workflows.js';
import {
    checkRequiredRuntimeDependencies,
    getRuntimeDependencyDiagnostics,
} from './runtime-dependencies.js';
import { ensureGoRunnerWatchersForProjects } from './domains/workflows/go-runner-watchers.js';
import { shouldServeSpaIndex } from './utils/spaFallback.js';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const TEXT_SAMPLE_BYTES = 8192;
const CC_ROUTE_SESSION_PATTERN = /^c\d+$/;
const coTurnTails = new Map();
const coActiveTurns = new Map();
const coConversationObservers = new Map();
let coDoctorStatus = { ok: false, error: 'co doctor has not run', contract: '' };

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
 * Accept only providers supported by manual chat turns.
 */
function normalizeManualProvider(provider) {
    if (provider === 'codex' || provider === 'opencode' || provider === 'pi') {
        return provider;
    }
    throw new Error('provider must be "codex", "opencode", or "pi"');
}

/**
 * Extract the manual-session first-message contract from websocket payloads.
 */
function resolveCcflowSessionStartContext(data = {}, resolvedOptions = {}) {
    const options = data && typeof data.options === 'object' && data.options !== null ? data.options : {};
    const explicitCcflowSessionId = pickString(
        data.cbwSessionId,
        data.cbw_session_id,
        options.cbwSessionId,
        options.cbw_session_id,
    );
    const fallbackRouteSessionId = isCcflowRouteSessionId(resolvedOptions?.sessionId)
        ? resolvedOptions.sessionId
        : '';
    const cbwSessionId = isCcflowRouteSessionId(explicitCcflowSessionId)
        ? explicitCcflowSessionId
        : fallbackRouteSessionId;

    return {
        cbwSessionId,
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
 * Resolve the stable co conversation_id for a chat or abort request.
 *
 * Priority:
 * 1. Explicit cbwSessionId (cN)
 * 2. current sessionId if it is already cN
 * 3. Project chat config lookup by provider session id → routeIndex → cN
 * 4. Co conversation state scan by provider_session_id
 * 5. Not found → error (caller must not write pending request)
 */
async function resolveCoConversationId({
    cbwSessionId,
    sessionId,
    projectName = '',
    projectPath = '',
    provider = 'codex',
}) {
    // 1. Explicit cbwSessionId already resolved as cN
    if (cbwSessionId && isCcflowRouteSessionId(cbwSessionId)) {
        return { conversationId: cbwSessionId, source: 'explicit' };
    }

    // 2. Current sessionId is already a cN route
    if (sessionId && isCcflowRouteSessionId(sessionId)) {
        return { conversationId: sessionId, source: 'session-id-is-cn' };
    }

    // 3. sessionId is a provider session id – try project chat config
    if (sessionId && projectPath) {
        try {
            const config = await loadProjectConfig(projectPath);
            const location = findProjectChatRecord(config, sessionId, provider);
            if (location?.scope === 'chat' && location.routeIndex) {
                const cn = `c${location.routeIndex}`;
                return { conversationId: cn, source: 'project-config' };
            }
        } catch (error) {
            // Config read can fail; fall through to co state scan
        }
    }

    // 4. Co conversation state scan by provider_session_id
    if (sessionId) {
        try {
            const coState = await findCoConversationForSession(sessionId);
            if (coState?.conversation_id && isCcflowRouteSessionId(coState.conversation_id)) {
                return { conversationId: coState.conversation_id, source: 'co-state' };
            }
        } catch (error) {
            // Fall through to error
        }
    }

    // 5. Cannot determine route
    return { conversationId: null, error: `Cannot determine co conversation route from session id: ${sessionId || '(none)'}` };
}

/**
 * Emit the user-message acceptance event once the backend has accepted a chat
 * request for a concrete visible session.
 */
function sendMessageAccepted(writer, {
    sessionId,
    cbwSessionId,
    provider,
    clientRequestId,
    startRequestId,
}) {
    const acceptedSessionId = sessionId || cbwSessionId || null;
    if (!acceptedSessionId) {
        return;
    }

    writer.send({
        type: 'message-accepted',
        sessionId: acceptedSessionId,
        cbwSessionId: cbwSessionId || null,
        provider,
        clientRequestId,
        startRequestId,
    });
}

/**
 * Require a healthy co binary before mutating manual-session state or accepting
 * a user chat request.
 */
async function ensureCoAvailable(provider) {
    coDoctorStatus = await runCoDoctor();
    if (!coDoctorStatus.ok) {
        throw new Error(`co is unavailable: ${coDoctorStatus.error || 'doctor failed'}`);
    }
    assertCoProviderAvailable(coDoctorStatus, provider);
    return coDoctorStatus;
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
const goRunnerWatchers = new Map();
let goRunnerWatcherDebounceTimer = null;
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
 * Attach a co event stream to WebSocket clients and cbw draft finalization.
 */
function attachCoTurnTail(turnId, state, sourceUserId = null) {
    const turnKey = turnId || state.active_turn_id;
    if (!turnKey) {
        return null;
    }
    coActiveTurns.set(turnKey, {
        id: state.provider_session_id || state.conversation_id || turnKey,
        turnId: turnKey,
        provider: state.provider,
        status: state.status || 'running',
        startedAt: state.started_at || state.updated_at || new Date().toISOString(),
        projectPath: state.project_path || '',
        cbwSessionId: state.conversation_id || null,
        providerSessionId: state.provider_session_id || null,
        sourceUserId,
    });
    const existingTail = coTurnTails.get(turnKey);
    if (existingTail) {
        return existingTail;
    }

    const tail = tailCoEvents(turnKey, (payload) => {
        const normalizedPayload = normalizeCoEventPayload(payload);
        const activeTurn = coActiveTurns.get(turnKey);
        let isTerminalPayload = false;
        if (activeTurn) {
            if (normalizedPayload?.sessionId) {
                activeTurn.id = normalizedPayload.sessionId;
                activeTurn.providerSessionId = normalizedPayload.sessionId;
            }
            if (normalizedPayload?.type === `${activeTurn.provider}-complete` || normalizedPayload?.type === 'session-aborted' || String(normalizedPayload?.type || '').endsWith('-error')) {
                isTerminalPayload = true;
                activeTurn.status = normalizedPayload.type === 'session-aborted'
                    ? 'aborted'
                    : String(normalizedPayload?.type || '').endsWith('-error')
                        ? 'failed'
                        : 'completed';
            }
        }
        const indexedPayload = buildCoRoutedEventPayload(normalizedPayload, {
            cbwSessionId: state.conversation_id,
            turnId: turnKey,
        });
        if (state.conversation_id && normalizedPayload?.type === 'session-created' && normalizedPayload?.sessionId) {
            void finalizeCcflowRouteSession({
                projectName: '',
                projectPath: state.project_path || '',
                provider: normalizedPayload.provider || state.provider,
                cbwSessionId: state.conversation_id,
                startRequestId: '',
                providerSessionId: normalizedPayload.sessionId,
            }).catch((error) => {
                console.warn('[co] Failed to finalize manual session draft:', error.message);
            });
        }
        broadcastChatEvent(indexedPayload, sourceUserId);
        if (isTerminalPayload) {
            coTurnTails.get(turnKey)?.close?.();
            coTurnTails.delete(turnKey);
            coActiveTurns.delete(turnKey);
        }
    });
    coTurnTails.set(turnKey, tail);
    return tail;
}

/**
 * Convert co's snake_case protocol fields into the camelCase fields consumed by
 * the existing browser realtime handlers while preserving the original payload.
 */
function normalizeCoEventPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return payload;
    }

    const normalized = { ...payload };
    if (!normalized.sessionId && typeof payload.session_id === 'string') {
        normalized.sessionId = payload.session_id;
    }
    if (!normalized.turnId && typeof payload.turn_id === 'string') {
        normalized.turnId = payload.turn_id;
    }
    if (!normalized.conversationId && typeof payload.conversation_id === 'string') {
        normalized.conversationId = payload.conversation_id;
    }
    return normalized;
}

/**
 * Add stable cbw route and turn identity to one co event before broadcasting.
 */
function buildCoRoutedEventPayload(payload, { cbwSessionId = '', turnId = '' } = {}) {
    return cbwSessionId
        ? {
            ...payload,
            cbwSessionId,
            cbw_session_id: cbwSessionId,
            turnId: payload?.turnId || turnId,
            turn_id: payload?.turn_id || turnId,
        }
        : {
            ...payload,
            turnId: payload?.turnId || turnId,
            turn_id: payload?.turn_id || turnId,
        };
}

/**
 * Replay durable co events to a reconnecting chat client.
 */
async function replayCoTurnEvents(ws, sourceUserId = null) {
    for (const turn of coActiveTurns.values()) {
        if (turn.status !== 'running') {
            continue;
        }
        if (sourceUserId !== null && turn.sourceUserId !== null && turn.sourceUserId !== sourceUserId) {
            continue;
        }

        const eventsPath = path.join(resolveCoHome(), 'turns', turn.turnId, 'events.jsonl');
        let content = '';
        try {
            content = await fsPromises.readFile(eventsPath, 'utf8');
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn('[co] Failed to replay events:', error.message);
            }
            continue;
        }

        for (const line of content.split('\n')) {
            if (ws.readyState !== WebSocket.OPEN) {
                return;
            }
            if (!line.trim()) {
                continue;
            }
            try {
                const payload = normalizeCoEventPayload(JSON.parse(line));
                const indexedPayload = buildCoRoutedEventPayload(payload, {
                    cbwSessionId: turn.cbwSessionId,
                    turnId: turn.turnId,
                });
                ws.send(JSON.stringify(indexedPayload));
            } catch (error) {
                console.warn('[co] Failed to replay event:', error.message);
            }
        }
    }
}

/**
 * Replay durable events for a known co conversation to one reconnecting client.
 */
async function replayCoConversationEvents(ws, conversation) {
    const turns = Array.isArray(conversation?.turns) ? conversation.turns : [];
    for (const turnId of turns) {
        if (!turnId || ws.readyState !== WebSocket.OPEN) {
            continue;
        }
        const eventsPath = path.join(resolveCoHome(), 'turns', turnId, 'events.jsonl');
        let content = '';
        try {
            content = await fsPromises.readFile(eventsPath, 'utf8');
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn('[co] Failed to replay conversation events:', error.message);
            }
            continue;
        }

        for (const line of content.split('\n')) {
            if (ws.readyState !== WebSocket.OPEN) {
                return;
            }
            if (!line.trim()) {
                continue;
            }
            try {
                const payload = normalizeCoEventPayload(JSON.parse(line));
                ws.send(JSON.stringify(buildCoRoutedEventPayload(payload, {
                    cbwSessionId: conversation.conversation_id,
                    turnId,
                })));
            } catch (error) {
                console.warn('[co] Failed to replay conversation event:', error.message);
            }
        }
    }
}

/**
 * Read durable co history into the same raw message shape used by chat history loaders.
 */
async function readCoConversationMessages(conversation, provider, limit = null, offset = 0) {
    const conversationId = conversation?.conversation_id || '';
    const turns = Array.isArray(conversation?.turns) ? conversation.turns : [];
    if (!conversationId || turns.length === 0) {
        return { messages: [], total: 0, hasMore: false };
    }

    const requests = await readCoConversationRequests(conversationId);
    const messages = [];
    for (const [turnIndex, turnId] of turns.entries()) {
        const request = requests[turnIndex] || null;
        if (request?.text) {
            messages.push({
                type: 'user',
                timestamp: request.created_at || new Date().toISOString(),
                requestId: request.request_id || request.id || '',
                messageKey: `co:${conversationId}:${turnId}:user`,
                message: {
                    role: 'user',
                    content: request.text,
                },
            });
        }

        const eventsPath = path.join(resolveCoHome(), 'turns', turnId, 'events.jsonl');
        let content = '';
        try {
            content = await fsPromises.readFile(eventsPath, 'utf8');
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn('[co] Failed to read conversation history event file:', error.message);
            }
            continue;
        }

        for (const line of content.split('\n')) {
            if (!line.trim()) {
                continue;
            }
            try {
                const event = normalizeCoEventPayload(JSON.parse(line));
                const contentText = typeof event?.data?.message?.content === 'string'
                    ? event.data.message.content
                    : typeof event?.data?.raw?.part?.text === 'string'
                        ? event.data.raw.part.text
                        : '';
                if (!contentText.trim()) {
                    continue;
                }
                messages.push({
                    type: 'assistant',
                    provider: event.provider || provider,
                    timestamp: event.created_at || new Date().toISOString(),
                    messageKey: `co:${conversationId}:${turnId}:event:${event.seq ?? messages.length}`,
                    message: {
                        role: 'assistant',
                        content: contentText,
                        phase: 'final_answer',
                    },
                });
            } catch (error) {
                console.warn('[co] Failed to parse conversation history event:', error.message);
            }
        }
    }

    const normalizedOffset = Number.isInteger(Number(offset)) && Number(offset) > 0 ? Number(offset) : 0;
    const normalizedLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;
    const pagedMessages = normalizedLimit
        ? messages.slice(normalizedOffset, normalizedOffset + normalizedLimit)
        : messages.slice(normalizedOffset);

    return {
        messages: pagedMessages,
        total: messages.length,
        hasMore: normalizedLimit ? messages.length > normalizedOffset + normalizedLimit : false,
    };
}

/**
 * Find a co conversation either by its route id or by the provider session id.
 */
async function findCoConversationForSession(sessionId) {
    if (!sessionId) {
        return null;
    }
    if (isCcflowRouteSessionId(sessionId)) {
        return readCoConversationState(sessionId).catch(() => null);
    }

    const conversationsDir = path.join(resolveCoHome(), 'conversations');
    let entries = [];
    try {
        entries = await fsPromises.readdir(conversationsDir, { withFileTypes: true });
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn('[co] Failed to list conversations:', error.message);
        }
        return null;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const statePath = path.join(conversationsDir, entry.name, 'state.json');
        try {
            const state = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
            if (state?.provider_session_id === sessionId || state?.conversation_id === sessionId) {
                return state;
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn('[co] Failed to read conversation state:', error.message);
            }
        }
    }

    return null;
}

/**
 * Read chat requests for one co conversation in creation order.
 */
async function readCoConversationRequests(conversationId) {
    const records = [];
    for (const bucket of ['done', 'running', 'pending']) {
        const bucketDir = path.join(resolveCoHome(), 'requests', bucket);
        let entries = [];
        try {
            entries = await fsPromises.readdir(bucketDir, { withFileTypes: true });
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn('[co] Failed to list request bucket:', error.message);
            }
            continue;
        }

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) {
                continue;
            }
            const requestPath = path.join(bucketDir, entry.name);
            try {
                const request = JSON.parse(await fsPromises.readFile(requestPath, 'utf8'));
                if (request?.conversation_id === conversationId) {
                    records.push(request);
                }
            } catch (error) {
                console.warn('[co] Failed to parse request record:', error.message);
            }
        }
    }

    return records.sort((left, right) => (
        new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime()
    ));
}

/**
 * Recover a running co conversation and start tailing its active turn.
 */
async function recoverCoConversation(conversationId, sourceUserId = null) {
    const state = await readCoConversationState(conversationId);
    if (!state?.active_turn_id) {
        return state;
    }
    attachCoTurnTail(state.active_turn_id, state, sourceUserId);
    return state;
}

/**
 * Return durable turn ids from a co conversation state in protocol order.
 */
function getCoConversationTurnIds(state) {
    return Array.isArray(state?.turns)
        ? state.turns.filter((turnId) => typeof turnId === 'string' && turnId.length > 0)
        : [];
}

/**
 * Keep observing a co conversation after requests are queued. co serializes
 * requests per conversation, so a later turn may appear long after the current
 * active turn finishes.
 */
function observeCoConversationTurns(conversationId, writer, provider, sourceUserId = null, { excludeTurnId = '', excludeTurnIds = [], intervalMs = 250, idleMs = 300000 } = {}) {
    if (!conversationId) {
        return null;
    }

    let observer = coConversationObservers.get(conversationId);
    if (!observer) {
        observer = {
            closed: false,
            idleStartedAt: null,
            provider,
            sourceUserId,
            writers: new Set(),
            seenTurnIds: new Set(),
            timer: null,
        };
        coConversationObservers.set(conversationId, observer);
    }

    observer.provider = provider || observer.provider;
    observer.sourceUserId = sourceUserId ?? observer.sourceUserId;
    if (writer) {
        observer.writers.add(writer);
    }
    if (excludeTurnId) {
        observer.seenTurnIds.add(excludeTurnId);
    }
    for (const turnId of excludeTurnIds) {
        if (turnId) {
            observer.seenTurnIds.add(turnId);
        }
    }

    // 新请求意味着 conversation 可能被重新激活，重置 idle 计时
    observer.idleStartedAt = null;

    if (observer.timer) {
        return observer;
    }

    const poll = async () => {
        if (observer.closed) {
            return;
        }

        try {
            const state = await recoverCoConversation(conversationId, observer.sourceUserId);
            const activeTurnId = state?.active_turn_id || '';
            const durableTurnIds = getCoConversationTurnIds(state);
            const unseenDurableTurnIds = durableTurnIds.filter((turnId) => (
                turnId !== activeTurnId && !observer.seenTurnIds.has(turnId)
            ));
            for (const turnId of unseenDurableTurnIds) {
                observer.seenTurnIds.add(turnId);
                attachCoTurnTail(turnId, state, observer.sourceUserId);
            }
            if (unseenDurableTurnIds.length > 0) {
                observer.idleStartedAt = null;
            }
            if (activeTurnId) {
                observer.idleStartedAt = null;
                if (!observer.seenTurnIds.has(activeTurnId)) {
                    observer.seenTurnIds.add(activeTurnId);
                    const status = {
                        type: 'session-status',
                        sessionId: conversationId,
                        provider: state.provider || observer.provider,
                        isProcessing: true,
                        turnId: activeTurnId,
                        turn_id: activeTurnId,
                        cbwSessionId: conversationId,
                        cbw_session_id: conversationId,
                    };
                    for (const targetWriter of observer.writers) {
                        targetWriter.send(status);
                    }
                }
            } else if (observer.idleStartedAt === null) {
                observer.idleStartedAt = Date.now();
            }
        } catch (error) {
            console.warn('[co] Failed while observing conversation:', error.message);
        }

        if (observer.idleStartedAt !== null && Date.now() - observer.idleStartedAt >= idleMs) {
            observer.closed = true;
            coConversationObservers.delete(conversationId);
            return;
        }
        observer.timer = setTimeout(poll, intervalMs);
    };

    observer.timer = setTimeout(poll, intervalMs);
    return observer;
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
 * Refresh project workflow metadata and broadcast it through the existing
 * sidebar/detail refresh channel.
 */
async function broadcastProjectsUpdated({ changeType = 'change', changedFile = '', watchProvider = 'workflow' } = {}) {
    if (isGetProjectsRunning) {
        return;
    }

    try {
        isGetProjectsRunning = true;
        clearProjectDirectoryCache();
        const updatedProjects = await attachWorkflowMetadata(
            await getProjects(broadcastProgress)
        );
        const updateMessage = JSON.stringify({
            type: 'projects_updated',
            projects: updatedProjects,
            timestamp: new Date().toISOString(),
            changeType,
            changedFile,
            watchProvider
        });

        connectedClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(updateMessage);
            }
        });
    } catch (error) {
        console.error('[ERROR] Error broadcasting project changes:', error);
    } finally {
        isGetProjectsRunning = false;
    }
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

/**
 * Close all Go runner state/log watchers and clear pending broadcasts.
 */
async function closeGoRunnerWatchers() {
    if (goRunnerWatcherDebounceTimer) {
        clearTimeout(goRunnerWatcherDebounceTimer);
        goRunnerWatcherDebounceTimer = null;
    }

    await Promise.all(
        Array.from(goRunnerWatchers.values()).map(async (watcher) => {
            try {
                await watcher.close();
            } catch (error) {
                console.error('[WARN] Failed to close Go runner watcher:', error);
            }
        })
    );
    goRunnerWatchers.clear();
}

/**
 * Debounce Go runner state/log changes into one project refresh broadcast.
 */
function scheduleGoRunnerProjectUpdate(eventType, filePath, runDir) {
    if (goRunnerWatcherDebounceTimer) {
        clearTimeout(goRunnerWatcherDebounceTimer);
    }

    goRunnerWatcherDebounceTimer = setTimeout(() => {
        goRunnerWatcherDebounceTimer = null;
        void broadcastProjectsUpdated({
            changeType: eventType,
            changedFile: path.relative(runDir, filePath),
            watchProvider: 'go-runner'
        });
    }, WATCHER_DEBOUNCE_MS);
}

/**
 * Watch one Go-backed workflow run directory for state.json and log/artifact
 * changes that should refresh the workflow read model.
 */
async function watchGoWorkflowRun(project, workflow) {
    const projectPath = project?.fullPath || project?.path || '';
    const runId = String(workflow?.runId || '').trim();
    if (workflow?.runner !== 'go' || !projectPath || !runId) {
        return null;
    }

    const watcherKey = `${projectPath}:${runId}`;
    if (goRunnerWatchers.has(watcherKey)) {
        return goRunnerWatchers.get(watcherKey);
    }

    const chokidar = (await import('chokidar')).default;
    const runDir = path.join(projectPath, '.wo', 'runs', runId);
    await fsPromises.mkdir(runDir, { recursive: true });
    const watcher = chokidar.watch(runDir, {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        depth: 6,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50
        }
    });

    watcher
        .on('add', (filePath) => scheduleGoRunnerProjectUpdate('add', filePath, runDir))
        .on('change', (filePath) => scheduleGoRunnerProjectUpdate('change', filePath, runDir))
        .on('unlink', (filePath) => scheduleGoRunnerProjectUpdate('unlink', filePath, runDir))
        .on('error', (error) => {
            console.error(`[ERROR] Go runner watcher error for ${runId}:`, error);
        });

    goRunnerWatchers.set(watcherKey, watcher);
    await new Promise((resolve) => {
        const readyTimer = setTimeout(resolve, 1000);
        watcher.once('ready', () => {
            clearTimeout(readyTimer);
            resolve();
        });
    });
    return watcher;
}

/**
 * Recreate Go runner watchers for all visible Go-backed workflows on startup.
 */
async function setupGoRunnerWatchers() {
    await closeGoRunnerWatchers();
    const projects = await attachWorkflowMetadata(await getProjects());
    await ensureGoRunnerWatchersForProjects(projects, watchGoWorkflowRun);
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
            try {
                await broadcastProjectsUpdated({
                    changeType: eventType,
                    changedFile: path.relative(rootPath, filePath),
                    watchProvider: provider
                });

            } catch (error) {
                console.error('[ERROR] Error handling project changes:', error);
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

app.get('/api/diagnostics/runtime-dependencies', authenticateToken, async (req, res) => {
    /**
     * PURPOSE: Expose resolved CLI paths and co doctor status for settings and
     * diagnostics without allowing runtime path overrides.
     */
    if (!coDoctorStatus.ok) {
        coDoctorStatus = await runCoDoctor();
    }
    const diagnostics = getRuntimeDependencyDiagnostics();
    res.json({
        ...diagnostics,
        ok: diagnostics.ok && coDoctorStatus.ok,
        commands: {
            ...diagnostics.commands,
            co: {
                name: 'co',
                command_path: coDoctorStatus.command_path || '',
                path: coDoctorStatus.command_path || '',
                home: coDoctorStatus.home || resolveCoHome(),
                version: {
                    ok: coDoctorStatus.ok,
                    output: coDoctorStatus.version || '',
                    error: coDoctorStatus.error || '',
                },
                contract: {
                    ok: coDoctorStatus.ok,
                    version: coDoctorStatus.contract || '',
                    capabilities: Object.entries(coDoctorStatus.providers || {})
                        .filter(([, provider]) => provider?.available)
                        .map(([name]) => name),
                    missing: coDoctorStatus.ok ? [] : ['co-request-v1'],
                    error: coDoctorStatus.error || '',
                },
                providers: coDoctorStatus.providers || {},
            },
        },
    });
});

// CLI Authentication API Routes (protected)
app.use('/api/cli', authenticateToken, cliAuthRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Codex API Routes (protected)
app.use('/api/codex', authenticateToken, codexRoutes);

// OpenCode API Routes (protected)
app.use('/api/cli/opencode', authenticateToken, opencodeRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

// Serve static public assets.
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
            ? 'git checkout main && git pull && pnpm install'
            : 'npm install -g cbw@latest';

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
        const projectsWithWorkflows = await attachWorkflowMetadata(projects);
        await ensureGoRunnerWatchersForProjects(projectsWithWorkflows, watchGoWorkflowRun);
        res.json(projectsWithWorkflows);
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/workflows', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        await ensureGoRunnerWatchersForProjects(projects, watchGoWorkflowRun);
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
        await watchGoWorkflowRun(project, workflow);
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

app.post('/api/projects/:projectName/workflows/:workflowId/resume-run', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await resumeWorkflowRun(project, req.params.workflowId);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        await watchGoWorkflowRun(project, workflow);
        res.json({ success: true, workflow });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/workflows/:workflowId/abort-run', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await abortWorkflowRun(project, req.params.workflowId);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({ success: true, workflow });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions', authenticateToken, async (req, res) => {
    res.status(410).json({ error: 'Claude sessions are no longer supported' });
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

        let resolvedProvider = provider === 'opencode' ? 'opencode' : provider === 'codex' ? 'codex' : provider === 'pi' ? 'pi' : null;
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
                const indexedProvider = runtimeContext.provider === 'opencode' ? 'opencode' : runtimeContext.provider === 'pi' ? 'pi' : 'codex';
                const fetchProvider = resolvedProvider || indexedProvider;
                const nativeResult = fetchProvider === 'codex'
                    ? await getCodexSessionMessages(providerSessionId, parsedLimit, parsedOffset, parsedAfterLine)
                    : await readCoConversationMessages(
                        await findCoConversationForSession(sessionId),
                        fetchProvider === 'pi' ? 'pi' : 'opencode',
                        parsedLimit,
                        parsedOffset,
                    );
                return res.json(nativeResult);
            }
        }

        if (!resolvedProvider) {
            try {
                projectPath = projectPath || await extractProjectDirectory(projectName);
                const codexSessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
                if (codexSessions.some((session) => session.id === sessionId)) {
                    resolvedProvider = 'codex';
                } else {
                    const piSessions = await getPiSessions(projectPath);
                    resolvedProvider = piSessions.some((session) => session.id === sessionId) ? 'pi' : 'opencode';
                }
            } catch (providerDetectionError) {
                console.warn(
                    `Unable to detect provider for session ${sessionId} in project ${projectName}:`,
                    providerDetectionError.message,
                );
                resolvedProvider = 'codex';
            }
        }

        const result = resolvedProvider === 'codex'
            ? await getCodexSessionMessages(sessionId, parsedLimit, parsedOffset, parsedAfterLine)
            : await readCoConversationMessages(
                await findCoConversationForSession(sessionId),
                resolvedProvider === 'pi' ? 'pi' : 'opencode',
                parsedLimit,
                parsedOffset,
            );

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

// Search across visible chat history messages for supported provider sessions.
app.get('/api/chat/search', authenticateToken, async (req, res) => {
    try {
        const query = typeof req.query.q === 'string' ? req.query.q : '';
        const mode = req.query.mode === 'jsonl' ? 'jsonl' : 'content';
        const results = await searchChatHistory(query, mode);
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

// Rename chat session endpoint
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
        const provider = normalizeManualProvider(req.body?.provider || 'codex');
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
            provider: normalizeManualProvider(req.body?.provider || 'codex'),
            state,
        });
        res.json({ success: true, state });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/manual-sessions', authenticateToken, async (req, res) => {
    try {
        const provider = normalizeManualProvider(req.body?.provider);
        const label = typeof req.body?.label === 'string' ? req.body.label : '';
        const projectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : '';
        const workflowId = typeof req.body?.workflowId === 'string' ? req.body.workflowId : '';
        const stageKey = typeof req.body?.stageKey === 'string' ? req.body.stageKey : '';

        if (!label.trim()) {
            return res.status(400).json({ error: 'Session label is required' });
        }

        await ensureCoAvailable(provider);
        const session = await createManualSessionDraft(req.params.projectName, projectPath, provider, label, {
            workflowId,
            stageKey,
        });
        res.json({ success: true, session });
    } catch (error) {
        const status = /provider must/.test(error.message) ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/manual-sessions/:sessionId/finalize', authenticateToken, async (req, res) => {
    try {
        const provider = normalizeManualProvider(req.body?.provider);
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
        const status = /provider must/.test(error.message) ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

// Get provider-level usage remaining metrics for UI status display.
app.get('/api/usage/remaining', authenticateToken, async (req, res) => {
    try {
        const provider = normalizeManualProvider(req.query.provider || 'codex');
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
        const projectPathHint = String(projectPath || '');
        const projectRoot = await resolveProjectRootWithHint(projectName, projectPathHint);
        const { absolutePath, readOnly } = await resolveReadableProjectPath(projectRoot, String(filePath || ''), {
            projectPathHint,
        });
        const fullBuffer = await fsPromises.readFile(absolutePath);
        const classification = classifyProjectFile(absolutePath, fullBuffer.subarray(0, TEXT_SAMPLE_BYTES));
        const responseClassification = readOnly ? { ...classification, editable: false } : classification;

        if (classification.fileType === 'text' || classification.fileType === 'markdown') {
            res.json({
                ...responseClassification,
                content: fullBuffer.toString('utf8'),
                path: absolutePath,
            });
            return;
        }

        res.json({
            ...responseClassification,
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
        const projectPathHint = String(projectPath || '');
        const projectRoot = await resolveProjectRootWithHint(projectName, projectPathHint);
        const { absolutePath } = await resolveReadableProjectPath(projectRoot, String(filePath || ''), {
            projectPathHint,
        });

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
        const projectPathHint = String(projectPath || '');
        const projectRoot = await resolveProjectRootWithHint(projectName, projectPathHint);
        const { absolutePath } = await resolveReadableProjectPath(projectRoot, String(targetPath || ''), {
            projectPathHint,
        });
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
         * Attach the cbw route id used to mirror provider events into the index.
         */
        this.sessionIndexContext = context;
    }

    getSessionIndexContext() {
        /**
         * Return the active cbw index context for fire-and-forget event writes.
         */
        return this.sessionIndexContext;
    }
}

async function finalizeCcflowRouteSession({
    projectName,
    projectPath,
    provider,
    cbwSessionId,
    startRequestId,
    providerSessionId,
}) {
    /**
     * Promote a route-only manual session (cN) to the provider session id.
     */
    if (!cbwSessionId || !providerSessionId) {
        return;
    }
    if (providerSessionId === cbwSessionId) {
        return false;
    }

    await bindManualSessionDraftProviderSession(
        projectName || '',
        projectPath || '',
        cbwSessionId,
        providerSessionId,
        startRequestId,
    );

    let finalized = false;
    try {
        finalized = await finalizeManualSessionDraft(
            projectName || '',
            cbwSessionId,
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
        const indexedPayload = indexContext?.cbwSessionId
            ? {
                ...payload,
                cbwSessionId: indexContext.cbwSessionId,
                cbw_session_id: indexContext.cbwSessionId,
            }
            : payload;
        if (indexContext?.cbwSessionId && payload?.type === 'session-created' && payload?.sessionId) {
            void (async () => {
                await bindManualSessionDraftProviderSession(
                    indexContext.projectName || '',
                    indexContext.projectPath || '',
                    indexContext.cbwSessionId,
                    payload.sessionId,
                    indexContext.startRequestId || '',
                );
                const runtime = await getManualSessionDraftRuntime(
                    indexContext.projectName || '',
                    indexContext.projectPath || '',
                    indexContext.cbwSessionId,
                );
                const runtimeProvider = runtime?.provider || payload.provider || indexContext.provider || 'codex';
                await finalizeCcflowRouteSession({
                    projectName: indexContext.projectName || '',
                    projectPath: indexContext.projectPath || '',
                    provider: runtimeProvider,
                    cbwSessionId: indexContext.cbwSessionId,
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
    void replayCoTurnEvents(ws, request?.user?.id || null);

    ws.on('message', async (message) => {
        let data = null;
        try {
            data = JSON.parse(message);

            console.log('📨 Chat message received:', data.type);
            if (data.type === 'claude-command') {
                writer.send({ type: 'claude-error', error: 'Provider "claude" is no longer supported' });
            } else if (data.type === 'codex-command') {
                if (!acceptChatRequestId(data.clientRequestId || data.options?.clientRequestId)) {
                    console.warn('[DEBUG] Ignoring duplicate Codex request:', data.clientRequestId || data.options?.clientRequestId);
                    return;
                }
                const resolvedOptions = await resolveChatProjectOptions(data.options, extractProjectDirectory);
                const {
                    cbwSessionId,
                    startRequestId,
                    clientRef,
                } = resolveCcflowSessionStartContext(data, resolvedOptions);
                const shouldStartCcflowDraft = cbwSessionId && (
                    (!resolvedOptions?.sessionId || isCcflowRouteSessionId(resolvedOptions.sessionId))
                    && (!data.sessionId || isCcflowRouteSessionId(data.sessionId))
                );
                const codexProviderOptions = shouldStartCcflowDraft
                    ? { ...resolvedOptions, sessionId: undefined, resume: false }
                    : resolvedOptions;
                await ensureCoAvailable('codex');
                writer.setSessionIndexContext(cbwSessionId ? {
                    projectName: codexProviderOptions?.projectName || data.options?.projectName || '',
                    projectPath: codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                    provider: 'codex',
                    cbwSessionId,
                    startRequestId,
                } : null);
                if (shouldStartCcflowDraft) {
                    const startResult = await startManualSessionDraft(
                        codexProviderOptions?.projectName || data.options?.projectName || '',
                        codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                        cbwSessionId,
                        'codex',
                        startRequestId,
                    );
                    const existingConversation = !startResult.started && startResult.reason === 'missing-draft'
                        ? await readCoConversationState(cbwSessionId).catch(() => null)
                        : null;
                    const canContinueExistingConversation = startResult.reason === 'already-started' || Boolean(existingConversation?.conversation_id);
                    if (!startResult.started && !canContinueExistingConversation) {
                        writer.send({
                            type: 'session-start-rejected',
                            sessionId: cbwSessionId,
                            cbwSessionId,
                            provider: 'codex',
                            reason: startResult.reason,
                            startRequestId: startResult.startRequestId,
                        });
                        return;
                    }
                }
                console.log('[DEBUG] Codex request:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', codexProviderOptions?.projectPath || codexProviderOptions?.cwd || 'Unknown');
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
                const sessionIdForRoute = codexOptions?.sessionId || data.sessionId;
                const resolvedRoute = await resolveCoConversationId({
                    cbwSessionId,
                    sessionId: sessionIdForRoute,
                    projectName: codexProviderOptions?.projectName || data.options?.projectName || '',
                    projectPath: codexOptions?.projectPath || codexOptions?.cwd || '',
                    provider: 'codex',
                });
                if (!resolvedRoute.conversationId) {
                    writer.send({
                        type: 'codex-error',
                        error: resolvedRoute.error || 'Cannot determine co conversation route',
                        provider: 'codex',
                        sessionId: sessionIdForRoute,
                    });
                    return;
                }
                const coRequest = buildCoRequest({
                    provider: 'codex',
                    requestId: startRequestId || data.clientRequestId || data.options?.clientRequestId || '',
                    conversationId: resolvedRoute.conversationId,
                    projectPath: codexOptions?.projectPath || codexOptions?.cwd || '',
                    text: data.command || '',
                    activePolicy: data.activePolicy || data.active_policy || data.options?.activePolicy || 'queue',
                    targetTurnId: data.targetTurnId || data.target_turn_id || data.options?.targetTurnId || '',
                    providerSessionIdHint: codexOptions?.sessionId || '',
                    model: codexOptions?.model || '',
                    options: {
                        model: codexOptions?.model || '',
                        reasoningEffort: codexOptions?.reasoningEffort || '',
                        permissionMode: codexOptions?.permissionMode || '',
                    },
                    attachments: codexOptions?.attachments || [],
                    actor: {
                        userId: request?.user?.id || 'local',
                        deviceId: data.deviceId || data.options?.deviceId || '',
                        windowId: data.windowId || data.options?.windowId || '',
                    },
                });
                const previousConversationState = await readCoConversationState(coRequest.conversation_id).catch(() => null);
                const previousActiveTurnId = previousConversationState?.active_turn_id || '';
                const previousTurnIds = getCoConversationTurnIds(previousConversationState);
                await writeCoRequest(coRequest);
                sendMessageAccepted(writer, {
                    sessionId: resolvedRoute.conversationId || codexProviderOptions?.sessionId || data.sessionId,
                    cbwSessionId: resolvedRoute.conversationId,
                    provider: 'codex',
                    clientRequestId: startRequestId,
                    startRequestId,
                });
                const recovered = await recoverCoConversation(coRequest.conversation_id, request?.user?.id || null);
                if (recovered?.active_turn_id) {
                    writer.send({
                        type: 'session-status',
                        sessionId: coRequest.conversation_id,
                        provider: 'codex',
                        isProcessing: true,
                        turnId: recovered.active_turn_id,
                    });
                }
                observeCoConversationTurns(coRequest.conversation_id, writer, 'codex', request?.user?.id || null, {
                    excludeTurnId: previousActiveTurnId,
                    excludeTurnIds: previousTurnIds,
                });
            } else if (data.type === 'opencode-command') {
                if (!acceptChatRequestId(data.clientRequestId || data.options?.clientRequestId)) {
                    console.warn('[DEBUG] Ignoring duplicate OpenCode request:', data.clientRequestId || data.options?.clientRequestId);
                    return;
                }
                const resolvedOptions = await resolveChatProjectOptions(data.options, extractProjectDirectory);
                const {
                    cbwSessionId,
                    startRequestId,
                    clientRef,
                } = resolveCcflowSessionStartContext(data, resolvedOptions);
                const shouldStartCcflowDraft = cbwSessionId && (
                    (!resolvedOptions?.sessionId || isCcflowRouteSessionId(resolvedOptions.sessionId))
                    && (!data.sessionId || isCcflowRouteSessionId(data.sessionId))
                );
                const opencodeProviderOptions = shouldStartCcflowDraft
                    ? { ...resolvedOptions, sessionId: undefined, resume: false }
                    : resolvedOptions;
                await ensureCoAvailable('opencode');
                writer.setSessionIndexContext(cbwSessionId ? {
                    projectName: opencodeProviderOptions?.projectName || data.options?.projectName || '',
                    projectPath: opencodeProviderOptions?.projectPath || opencodeProviderOptions?.cwd || '',
                    provider: 'opencode',
                    cbwSessionId,
                    startRequestId,
                } : null);
                if (shouldStartCcflowDraft) {
                    const startResult = await startManualSessionDraft(
                        opencodeProviderOptions?.projectName || data.options?.projectName || '',
                        opencodeProviderOptions?.projectPath || opencodeProviderOptions?.cwd || '',
                        cbwSessionId,
                        'opencode',
                        startRequestId,
                    );
                    const existingConversation = !startResult.started && startResult.reason === 'missing-draft'
                        ? await readCoConversationState(cbwSessionId).catch(() => null)
                        : null;
                    const canContinueExistingConversation = startResult.reason === 'already-started' || Boolean(existingConversation?.conversation_id);
                    if (!startResult.started && !canContinueExistingConversation) {
                        writer.send({
                            type: 'session-start-rejected',
                            sessionId: cbwSessionId,
                            cbwSessionId,
                            provider: 'opencode',
                            reason: startResult.reason,
                            startRequestId: startResult.startRequestId,
                        });
                        return;
                    }
                }
                console.log('[DEBUG] OpenCode request:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', opencodeProviderOptions?.projectPath || opencodeProviderOptions?.cwd || 'Unknown');
                const sessionIdForRoute = opencodeProviderOptions?.sessionId || data.sessionId;
                const resolvedRoute = await resolveCoConversationId({
                    cbwSessionId,
                    sessionId: sessionIdForRoute,
                    projectName: opencodeProviderOptions?.projectName || data.options?.projectName || '',
                    projectPath: opencodeProviderOptions?.projectPath || opencodeProviderOptions?.cwd || '',
                    provider: 'opencode',
                });
                if (!resolvedRoute.conversationId) {
                    writer.send({
                        type: 'opencode-error',
                        error: resolvedRoute.error || 'Cannot determine co conversation route',
                        provider: 'opencode',
                        sessionId: sessionIdForRoute,
                    });
                    return;
                }
                const coRequest = buildCoRequest({
                    provider: 'opencode',
                    requestId: startRequestId || data.clientRequestId || data.options?.clientRequestId || '',
                    conversationId: resolvedRoute.conversationId,
                    projectPath: opencodeProviderOptions?.projectPath || opencodeProviderOptions?.cwd || '',
                    text: data.command || '',
                    activePolicy: data.activePolicy || data.active_policy || data.options?.activePolicy || 'queue',
                    targetTurnId: data.targetTurnId || data.target_turn_id || data.options?.targetTurnId || '',
                    providerSessionIdHint: opencodeProviderOptions?.sessionId || '',
                    options: {
                        model: opencodeProviderOptions?.model || '',
                        reasoningEffort: opencodeProviderOptions?.reasoningEffort || '',
                        permissionMode: opencodeProviderOptions?.permissionMode || '',
                    },
                    attachments: opencodeProviderOptions?.attachments || [],
                    actor: {
                        userId: request?.user?.id || 'local',
                        deviceId: data.deviceId || data.options?.deviceId || '',
                        windowId: data.windowId || data.options?.windowId || '',
                    },
                });
                const previousConversationState = await readCoConversationState(coRequest.conversation_id).catch(() => null);
                const previousActiveTurnId = previousConversationState?.active_turn_id || '';
                const previousTurnIds = getCoConversationTurnIds(previousConversationState);
                await writeCoRequest(coRequest);
                sendMessageAccepted(writer, {
                    sessionId: resolvedRoute.conversationId || opencodeProviderOptions?.sessionId || data.sessionId,
                    cbwSessionId: resolvedRoute.conversationId,
                    provider: 'opencode',
                    clientRequestId: startRequestId,
                    startRequestId,
                });
                const recovered = await recoverCoConversation(coRequest.conversation_id, request?.user?.id || null);
                if (recovered?.active_turn_id) {
                    writer.send({
                        type: 'session-status',
                        sessionId: coRequest.conversation_id,
                        provider: 'opencode',
                        isProcessing: true,
                        turnId: recovered.active_turn_id,
                    });
                }
                observeCoConversationTurns(coRequest.conversation_id, writer, 'opencode', request?.user?.id || null, {
                    excludeTurnId: previousActiveTurnId,
                    excludeTurnIds: previousTurnIds,
                });
            } else if (data.type === 'pi-command') {
                if (!acceptChatRequestId(data.clientRequestId || data.options?.clientRequestId)) {
                    console.warn('[DEBUG] Ignoring duplicate Pi request:', data.clientRequestId || data.options?.clientRequestId);
                    return;
                }
                const resolvedOptions = await resolveChatProjectOptions(data.options, extractProjectDirectory);
                const {
                    cbwSessionId,
                    startRequestId,
                    clientRef,
                } = resolveCcflowSessionStartContext(data, resolvedOptions);
                const shouldStartCcflowDraft = cbwSessionId && (
                    (!resolvedOptions?.sessionId || isCcflowRouteSessionId(resolvedOptions.sessionId))
                    && (!data.sessionId || isCcflowRouteSessionId(data.sessionId))
                );
                const piProviderOptions = shouldStartCcflowDraft
                    ? { ...resolvedOptions, sessionId: undefined, resume: false }
                    : resolvedOptions;
                await ensureCoAvailable('pi');
                writer.setSessionIndexContext(cbwSessionId ? {
                    projectName: piProviderOptions?.projectName || data.options?.projectName || '',
                    projectPath: piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                    provider: 'pi',
                    cbwSessionId,
                    startRequestId,
                } : null);
                if (shouldStartCcflowDraft) {
                    const startResult = await startManualSessionDraft(
                        piProviderOptions?.projectName || data.options?.projectName || '',
                        piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                        cbwSessionId,
                        'pi',
                        startRequestId,
                    );
                    const existingConversation = !startResult.started && startResult.reason === 'missing-draft'
                        ? await readCoConversationState(cbwSessionId).catch(() => null)
                        : null;
                    const canContinueExistingConversation = startResult.reason === 'already-started' || Boolean(existingConversation?.conversation_id);
                    if (!startResult.started && !canContinueExistingConversation) {
                        writer.send({
                            type: 'session-start-rejected',
                            sessionId: cbwSessionId,
                            cbwSessionId,
                            provider: 'pi',
                            reason: startResult.reason,
                            startRequestId: startResult.startRequestId,
                        });
                        return;
                    }
                }
                console.log('[DEBUG] Pi request:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', piProviderOptions?.projectPath || piProviderOptions?.cwd || 'Unknown');
                const sessionIdForRoute = piProviderOptions?.sessionId || data.sessionId;
                const resolvedRoute = await resolveCoConversationId({
                    cbwSessionId,
                    sessionId: sessionIdForRoute,
                    projectName: piProviderOptions?.projectName || data.options?.projectName || '',
                    projectPath: piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                    provider: 'pi',
                });
                if (!resolvedRoute.conversationId) {
                    writer.send({
                        type: 'pi-error',
                        error: resolvedRoute.error || 'Cannot determine co conversation route',
                        provider: 'pi',
                        sessionId: sessionIdForRoute,
                    });
                    return;
                }
                const coRequest = buildCoRequest({
                    provider: 'pi',
                    requestId: startRequestId || data.clientRequestId || data.options?.clientRequestId || '',
                    conversationId: resolvedRoute.conversationId,
                    projectPath: piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                    text: data.command || '',
                    activePolicy: data.activePolicy || data.active_policy || data.options?.activePolicy || 'queue',
                    targetTurnId: data.targetTurnId || data.target_turn_id || data.options?.targetTurnId || '',
                    providerSessionIdHint: piProviderOptions?.sessionId || '',
                    options: {
                        permissionMode: piProviderOptions?.permissionMode || '',
                    },
                    attachments: piProviderOptions?.attachments || [],
                    actor: {
                        userId: request?.user?.id || 'local',
                        deviceId: data.deviceId || data.options?.deviceId || '',
                        windowId: data.windowId || data.options?.windowId || '',
                    },
                });
                const previousConversationState = await readCoConversationState(coRequest.conversation_id).catch(() => null);
                const previousActiveTurnId = previousConversationState?.active_turn_id || '';
                const previousTurnIds = getCoConversationTurnIds(previousConversationState);
                await writeCoRequest(coRequest);
                sendMessageAccepted(writer, {
                    sessionId: resolvedRoute.conversationId || piProviderOptions?.sessionId || data.sessionId,
                    cbwSessionId: resolvedRoute.conversationId,
                    provider: 'pi',
                    clientRequestId: startRequestId,
                    startRequestId,
                });
                const recovered = await recoverCoConversation(coRequest.conversation_id, request?.user?.id || null);
                if (recovered?.active_turn_id) {
                    writer.send({
                        type: 'session-status',
                        sessionId: coRequest.conversation_id,
                        provider: 'pi',
                        isProcessing: true,
                        turnId: recovered.active_turn_id,
                    });
                }
                observeCoConversationTurns(coRequest.conversation_id, writer, 'pi', request?.user?.id || null, {
                    excludeTurnId: previousActiveTurnId,
                    excludeTurnIds: previousTurnIds,
                });
            } else if (data.type === 'abort-session') {
                console.log('[DEBUG] Abort session request:', data.sessionId);
                const provider = normalizeManualProvider(data.provider || 'codex');
                const cbwSessionId = isCcflowRouteSessionId(data.cbwSessionId || data.sessionId)
                    ? (data.cbwSessionId || data.sessionId)
                    : null;
                let success = false;

                if (cbwSessionId) {
                    await markManualSessionDraftCancelRequested(
                        data.projectName || '',
                        data.projectPath || '',
                        cbwSessionId,
                        data.startRequestId || '',
                    );
                }
                await ensureCoAvailable(provider);
                const resolvedOptions = await resolveChatProjectOptions(data.options, extractProjectDirectory).catch(() => ({}));
                const sessionIdForRoute = data.sessionId;
                const routeResult = cbwSessionId
                    ? { conversationId: cbwSessionId }
                    : await resolveCoConversationId({
                        cbwSessionId: null,
                        sessionId: data.conversationId || data.conversation_id || sessionIdForRoute,
                        projectName: data.projectName || resolvedOptions?.projectName || '',
                        projectPath: data.projectPath || resolvedOptions?.projectPath || resolvedOptions?.cwd || '',
                        provider,
                    });
                const conversationId = routeResult.conversationId || '';
                const targetTurnId = data.targetTurnId || data.target_turn_id || data.options?.targetTurnId || '';
                if (!conversationId) {
                    writer.send({
                        type: 'session-aborted',
                        sessionId: sessionIdForRoute,
                        cbwSessionId,
                        provider,
                        success: false,
                        error: routeResult.error || 'Cannot determine co conversation route for abort',
                    });
                    return;
                }
                if (!targetTurnId) {
                    writer.send({
                        type: 'session-aborted',
                        sessionId: sessionIdForRoute,
                        actualSessionId: conversationId,
                        cbwSessionId,
                        provider,
                        success: false,
                        error: 'target_turn_id is required for abort',
                    });
                    return;
                }
                const coRequest = buildCoRequest({
                    op: 'abort',
                    provider,
                    requestId: data.clientRequestId || data.options?.clientRequestId || '',
                    conversationId,
                    projectPath: data.projectPath || resolvedOptions?.projectPath || resolvedOptions?.cwd || '',
                    targetTurnId,
                    actor: {
                        userId: request?.user?.id || 'local',
                        deviceId: data.deviceId || data.options?.deviceId || '',
                        windowId: data.windowId || data.options?.windowId || '',
                    },
                });
                await writeCoRequest(coRequest);
                success = true;

                writer.send({
                    type: 'session-aborted',
                    sessionId: data.sessionId,
                    actualSessionId: conversationId,
                    cbwSessionId,
                    provider,
                    success
                });
            } else if (data.type === 'claude-permission-response') {
                writer.send({ type: 'claude-error', error: 'Provider "claude" is no longer supported' });
            } else if (data.type === 'check-session-status') {
                // Check if a specific session is currently processing
                const provider = normalizeManualProvider(data.provider || 'codex');
                const sessionId = data.cbwSessionId || data.cbw_session_id || data.sessionId;
                const conversation = await recoverCoConversation(sessionId, request?.user?.id || null);
                const isActive = conversation?.status === 'running' || Boolean(conversation?.active_turn_id);

                writer.send({
                    type: 'session-status',
                    sessionId,
                    cbwSessionId: conversation?.conversation_id || sessionId,
                    cbw_session_id: conversation?.conversation_id || sessionId,
                    provider,
                    isProcessing: isActive,
                    turnId: conversation?.active_turn_id || '',
                    turn_id: conversation?.active_turn_id || '',
                });
            } else if (data.type === 'get-active-sessions') {
                // Get all currently active sessions
                const activeTurns = [...coActiveTurns.values()]
                    .filter((turn) => turn.status === 'running')
                    .map((turn) => ({
                        id: turn.providerSessionId || turn.cbwSessionId || turn.turnId,
                        turnId: turn.turnId,
                        status: turn.status,
                        startedAt: turn.startedAt,
                        projectPath: turn.projectPath,
                        cbwSessionId: turn.cbwSessionId,
                    }));
                const activeSessions = {
                    codex: activeTurns.filter((turn) => turn.provider === 'codex'),
                    opencode: activeTurns.filter((turn) => turn.provider === 'opencode'),
                    pi: activeTurns.filter((turn) => turn.provider === 'pi'),
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
            } else if (data?.type === 'opencode-command') {
                errorType = 'opencode-error';
            } else if (data?.type === 'pi-command') {
                errorType = 'pi-error';
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
                const provider = data.provider === 'opencode' ? 'opencode' : data.provider === 'plain-shell' ? 'plain-shell' : 'codex';
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
                    const providerName = provider === 'opencode' ? 'OpenCode' : 'Codex';
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
                    } else if (provider === 'opencode') {
                        const command = initialCommand || 'opencode';
                        if (os.platform() === 'win32') {
                            if (hasSession && sessionId) {
                                shellCommand = `Set-Location -Path "${projectPath}"; opencode --session ${sessionId}; if ($LASTEXITCODE -ne 0) { opencode }`;
                            } else {
                                shellCommand = `Set-Location -Path "${projectPath}"; ${command}`;
                            }
                        } else {
                            if (hasSession && sessionId) {
                                shellCommand = `cd "${projectPath}" && opencode --session "${sessionId}" || opencode`;
                            } else {
                                shellCommand = `cd "${projectPath}" && ${command}`;
                            }
                        }
                    } else {
                        throw new Error(`Unsupported shell provider: ${provider}`);
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
         * move them into the final per-message batch tree under ~/cbw-uploads.
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
        const { provider = 'codex' } = req.query;
        const homeDir = os.homedir();

        // Allow only safe characters in sessionId
        const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
        if (!safeSessionId) {
            return res.status(400).json({ error: 'Invalid sessionId' });
        }

        const parsedContextWindow = parseInt(process.env.CONTEXT_WINDOW, 10);
        const contextWindow = Number.isFinite(parsedContextWindow) ? parsedContextWindow : 160000;

        if (provider === 'codex') {
            const tokenUsage = await getCodexSessionTokenUsage(safeSessionId, { homeDir });
            if (!tokenUsage) {
                return res.status(204).send();
            }
            return res.json(tokenUsage);
        }

        res.status(410).json({ error: 'Claude sessions are no longer supported' });
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
    // Skip static asset requests while still serving dotted workflow run ids.
    if (!shouldServeSpaIndex(req)) {
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
    await closeProjectsWatchers();
    await closeGoRunnerWatchers();
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
        // Ensure required external binaries are available in PATH
        checkRequiredRuntimeDependencies();

        // Initialize authentication database
        await initializeDatabase();

        // Check if running in production mode (dist folder exists)
        const distIndexPath = path.join(__dirname, '../dist/index.html');
        const isProduction = fs.existsSync(distIndexPath);

        coDoctorStatus = await runCoDoctor();
        if (coDoctorStatus.ok) {
            console.log(`${c.info('[INFO]')} Using co for Codex/OpenCode turns at ${c.dim(coDoctorStatus.home || resolveCoHome())}`);
        } else {
            console.log(`${c.warn('[WARN]')} co unavailable; chat sending is disabled: ${coDoctorStatus.error || 'doctor failed'}`);
        }
        console.log(`${c.info('[INFO]')} Running in ${c.bright(isProduction ? 'PRODUCTION' : 'DEVELOPMENT')} mode`);

        if (!isProduction) {
            console.log(`${c.warn('[WARN]')} Note: Requests will be proxied to Vite dev server at ${c.dim('http://localhost:' + (process.env.VITE_PORT || 5173))}`);
        }

        server.listen(PORT, HOST, async () => {
            const appInstallPath = path.join(__dirname, '..');

            console.log('');
            console.log(c.dim('═'.repeat(63)));
            console.log(`  ${c.bright('cbw Server - Ready')}`);
            console.log(c.dim('═'.repeat(63)));
            console.log('');
            console.log(`${c.info('[INFO]')} Server URL:  ${c.bright('http://' + DISPLAY_HOST + ':' + PORT)}`);
            console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
            console.log(`${c.tip('[TIP]')}  Run "cbw status" for full configuration details`);
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

            console.info('[WorkflowAutoRunner] Disabled; wo is the workflow state machine.');

            try {
                // Start watching provider and Go runner output folders after the workflow runner is live.
                await setupProjectsWatcher();
                await setupGoRunnerWatchers();
            } catch (watcherError) {
                console.error('[ERROR] Failed to setup project watchers:', watcherError);
            }
        });
    } catch (error) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
