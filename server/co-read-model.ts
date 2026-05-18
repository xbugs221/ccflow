// @ts-nocheck -- Migration baseline: extracted from server/index.ts.
/**
 * Co conversation read model: durable message reading from co filesystem state.
 * Separated from server/index.ts so tests can import without starting Express.
 */
import path from 'path';
import { promises as fsPromises } from 'fs';
import { resolveCoHome, readCoConversationState } from './co-client.js';

const CC_ROUTE_SESSION_PATTERN = /^c\d+$/;

function isCcflowRouteSessionId(sessionId) {
    return typeof sessionId === 'string' && CC_ROUTE_SESSION_PATTERN.test(sessionId.trim());
}

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
    if (!normalized.userId && typeof payload.user_id === 'string') {
        normalized.userId = payload.user_id;
    }
    if (!normalized.messageId && typeof payload.message_id === 'string') {
        normalized.messageId = payload.message_id;
    }
    return normalized;
}

/**
 * Read chat requests for one co conversation in creation order.
 */
async function readCoConversationRequests(conversationId) {
    const recordsById = new Map();
    for (const bucket of ['pending', 'claimed', 'running', 'done']) {
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
                    const id = request.request_id || request.id || entry.name.replace(/\.json$/, '');
                    recordsById.set(id, { ...request, request_id: request.request_id || id });
                }
            } catch (error) {
                console.warn('[co] Failed to parse request record:', error.message);
            }
        }
    }

    const records = [...recordsById.values()];
    return records.sort((left, right) => (
        new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime()
    ));
}

/**
 * Read one JSON metadata file from a co turn directory.
 */
async function readTurnMetadataFile(turnDir, fileName) {
    try {
        return JSON.parse(await fsPromises.readFile(path.join(turnDir, fileName), 'utf8'));
    } catch (error) {
        if (error?.code && error.code !== 'ENOENT') {
            console.warn('[co] Failed to parse turn metadata:', error.message);
        }
        return null;
    }
}

/**
 * Resolve the request id recorded by a turn without relying on request.json.
 */
async function readCoTurnRequestId(turnId, conversationId, requestByRequestId) {
    const turnDir = path.join(resolveCoHome(), 'turns', turnId);
    for (const fileName of ['request.json', 'state.json', 'result.json']) {
        const metadata = await readTurnMetadataFile(turnDir, fileName);
        if (!metadata) {
            continue;
        }
        const requestId = metadata.request_id || metadata.requestId || metadata.id;
        const metadataConversationId = metadata.conversation_id || metadata.conversationId;
        if (!requestId) {
            continue;
        }
        if (metadataConversationId && metadataConversationId !== conversationId) {
            continue;
        }
        if (requestByRequestId.has(requestId) || metadataConversationId === conversationId) {
            return requestId;
        }
    }

    const possibleRequestId = turnId.startsWith('turn_') ? turnId.slice(5) : turnId;
    return requestByRequestId.has(possibleRequestId) ? possibleRequestId : null;
}

/**
 * Read durable conversation messages from the co filesystem state.
 * Returns { messages, total, hasMore } for use by the session messages API.
 */
export async function readCoConversationMessages(conversation, provider, limit = null, offset = 0) {
    const conversationId = conversation?.conversation_id || '';
    const turns = Array.isArray(conversation?.turns) ? conversation.turns : [];
    if (!conversationId) {
        return { messages: [], total: 0, hasMore: false };
    }

    const requests = await readCoConversationRequests(conversationId);
    const messages = [];

    // Build a map of request_id → request for pairing with turn directories.
    const requestByRequestId = new Map();
    for (const request of requests) {
        const id = request?.request_id || request?.id;
        if (id) {
            requestByRequestId.set(id, request);
        }
    }

    // Scan the turns directory for ALL turn subdirectories belonging to this
    // conversation. The conversation state's turns array may be truncated or
    // overwritten by the co daemon, so discover turns from request/state/result
    // metadata instead of relying on request.json alone.
    const turnIds = new Set<string>();
    const requestIdByTurnId = new Map();
    const turnsDir = path.join(resolveCoHome(), 'turns');
    try {
        const entries = await fsPromises.readdir(turnsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const requestId = await readCoTurnRequestId(entry.name, conversationId, requestByRequestId);
            if (requestId) {
                turnIds.add(entry.name);
                requestIdByTurnId.set(entry.name, requestId);
            }
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn('[co] Failed to scan turns directory:', error.message);
        }
    }
    for (const turnId of turns) {
        turnIds.add(turnId);
        if (!requestIdByTurnId.has(turnId)) {
            const requestId = await readCoTurnRequestId(turnId, conversationId, requestByRequestId);
            if (requestId) {
                requestIdByTurnId.set(turnId, requestId);
            }
        }
    }

    // Sort turns by their request creation time for deterministic ordering.
    const sortedTurnIds = [...turnIds].sort((a, b) => {
        const requestA = requestByRequestId.get(requestIdByTurnId.get(a) || (a.startsWith('turn_') ? a.slice(5) : a));
        const requestB = requestByRequestId.get(requestIdByTurnId.get(b) || (b.startsWith('turn_') ? b.slice(5) : b));
        const timeA = requestA?.created_at || '0';
        const timeB = requestB?.created_at || '0';
        return new Date(timeA).getTime() - new Date(timeB).getTime();
    });

    for (const turnId of sortedTurnIds) {
        const requestId = requestIdByTurnId.get(turnId) || (turnId.startsWith('turn_') ? turnId.slice(5) : turnId);
        const request = requestByRequestId.get(requestId) || null;
        if (request?.text) {
            messages.push({
                type: 'user',
                timestamp: request.created_at || new Date().toISOString(),
                requestId: request.request_id || request.id || '',
                messageKey: `co:${conversationId}:${turnId}:user:${request.request_id || request.id || requestId}`,
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
export async function findCoConversationForSession(sessionId, expectedProvider = null) {
    if (!sessionId) {
        return null;
    }
    if (isCcflowRouteSessionId(sessionId)) {
        const state = await readCoConversationState(sessionId).catch(() => null);
        if (!state) return null;
        if (expectedProvider && state.provider !== expectedProvider) return null;
        return state;
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
            const idMatch = state?.provider_session_id === sessionId
                || state?.conversation_id === sessionId;
            if (!idMatch) continue;
            // When an expected provider is specified, reject conversations
            // that belong to a different provider to prevent cross-provider
            // history leaks (e.g. Codex conversation with a Pi session id).
            if (expectedProvider && state.provider && state.provider !== expectedProvider) {
                continue;
            }
            return state;
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn('[co] Failed to read conversation state:', error.message);
            }
        }
    }

    return null;
}
