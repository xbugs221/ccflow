/**
 * co 文件协议客户端：负责 ccflow 与独立 co 聊天执行器之间的 request/state/events 读写。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { promises as fsPromises } from 'fs';
import { resolveExecutablePath } from './executable-resolver.js';

export const CO_REQUEST_CONTRACT = 'co-request-v1';
export const CO_CONVERSATION_CONTRACT = 'co-conversation-v1';
export const CO_TURN_CONTRACT = 'co-turn-v1';
export const CO_EVENT_TYPES = new Set([
    'session-created',
    'codex-response',
    'opencode-response',
    'token-budget',
    'codex-complete',
    'opencode-complete',
    'codex-error',
    'opencode-error',
    'session-aborted',
    'steer-rejected',
    'message-rejected',
]);
const MESSAGE_POLICIES = new Set(['queue', 'reject', 'abort_and_send', 'steer']);
const REQUEST_OPS = new Set(['message', 'abort']);
const PROVIDERS = new Set(['codex', 'opencode']);

/**
 * Build one actionable co doctor failure summary for diagnostics and send gates.
 */
function formatCoDoctorFailure(detail = '') {
    return [
        'co doctor --json failed',
        detail ? `detail: ${detail}` : '',
        `PATH=${process.env.PATH || ''}`,
    ].filter(Boolean).join('; ');
}

/**
 * Return the shared co home used for request submission and read-model recovery.
 */
export function resolveCoHome(env = process.env) {
    return env.CCFLOW_CO_HOME || path.join(os.homedir(), '.local', 'state', 'ccflow', 'co');
}

/**
 * Normalize the provider section returned by co doctor into ccflow's internal shape.
 */
export function normalizeCoProviders(providers = {}) {
    /**
     * co has emitted both boolean and object provider schemas; only the
     * availability bit is intentionally normalized here.
     */
    const normalized = {};
    for (const provider of PROVIDERS) {
        const value = providers?.[provider];
        if (typeof value === 'boolean') {
            normalized[provider] = { available: value };
        } else if (value && typeof value === 'object') {
            normalized[provider] = { ...value, available: value.available === true };
        } else {
            normalized[provider] = { available: false };
        }
    }
    return normalized;
}

/**
 * Execute `co doctor --json` and normalize startup diagnostics for UI and send gating.
 */
export async function runCoDoctor({ command = 'co', timeoutMs = 5000 } = {}) {
    return new Promise((resolve) => {
        const commandPath = resolveExecutablePath(command) || command;
        const child = spawn(commandPath, ['doctor', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            resolve({
                ok: false,
                command_path: commandPath === command ? '' : commandPath,
                contract: '',
                error: formatCoDoctorFailure(`timed out for ${command}`),
                stderr,
            });
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            resolve({ ok: false, command_path: commandPath === command ? '' : commandPath, contract: '', providers: normalizeCoProviders(), error: formatCoDoctorFailure(error.message), stderr });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            try {
                const parsed = JSON.parse(stdout || '{}');
                const ok = code === 0 && parsed?.ok === true && parsed?.contract === CO_REQUEST_CONTRACT;
                const providers = normalizeCoProviders(parsed?.providers || {});
                resolve({
                    ...parsed,
                    command_path: commandPath === command ? '' : commandPath,
                    providers,
                    ok,
                    error: ok ? '' : formatCoDoctorFailure(parsed?.error || stderr.trim() || `exit ${code}`),
                    stderr,
                });
            } catch (error) {
                const detail = [stderr.trim(), `invalid JSON: ${error.message}`].filter(Boolean).join('; ');
                resolve({ ok: false, command_path: commandPath === command ? '' : commandPath, contract: '', providers: normalizeCoProviders(), error: formatCoDoctorFailure(detail), stderr });
            }
        });
    });
}

/**
 * Check whether a doctor result explicitly marks a chat provider as usable.
 */
export function isCoProviderAvailable(status, provider) {
    return PROVIDERS.has(provider) && normalizeCoProviders(status?.providers || {})[provider]?.available === true;
}

/**
 * Raise a user-facing error before ccflow writes a co request for an unavailable provider.
 */
export function assertCoProviderAvailable(status, provider) {
    if (!isCoProviderAvailable(status, provider)) {
        const doctorError = status?.error || 'provider not available';
        throw new Error(`co provider "${provider}" is unavailable: ${doctorError}; PATH=${process.env.PATH || ''}`);
    }
}

/**
 * Validate and build the exact co-request-v1 payload submitted by ccflow.
 */
export function buildCoRequest({
    requestId,
    op = 'message',
    conversationId,
    projectPath,
    provider = 'codex',
    text = '',
    activePolicy = 'queue',
    targetTurnId = '',
    providerSessionIdHint = '',
    options = {},
    attachments = [],
    actor = {},
}) {
    if (!REQUEST_OPS.has(op)) {
        throw new Error(`unsupported co request op: ${op}`);
    }
    if (!conversationId) {
        throw new Error('conversation_id is required');
    }
    if (!projectPath) {
        throw new Error('project_path is required');
    }
    if (provider !== 'codex' && provider !== 'opencode') {
        throw new Error('provider must be "codex" or "opencode"');
    }
    if (!MESSAGE_POLICIES.has(activePolicy)) {
        throw new Error(`unsupported co active_policy: ${activePolicy}`);
    }

    return {
        contract: CO_REQUEST_CONTRACT,
        request_id: requestId || createCoRequestId(),
        op,
        created_at: new Date().toISOString(),
        conversation_id: conversationId,
        project_path: projectPath,
        provider,
        text: op === 'abort' ? '' : String(text || ''),
        active_policy: activePolicy,
        target_turn_id: targetTurnId || '',
        provider_session_id_hint: providerSessionIdHint || '',
        options: {
            model: options.model || '',
            reasoning_effort: options.reasoningEffort || options.reasoning_effort || '',
            permission_mode: options.permissionMode || options.permission_mode || '',
        },
        attachments: Array.isArray(attachments)
            ? attachments.map((attachment) => ({
                path: attachment?.path || attachment?.filePath || attachment?.absolutePath || '',
                name: attachment?.name || attachment?.filename || '',
                mime_type: attachment?.mimeType || attachment?.mime_type || '',
            })).filter((attachment) => attachment.path)
            : [],
        actor: {
            user_id: actor.userId || actor.user_id || 'local',
            device_id: actor.deviceId || actor.device_id || '',
            window_id: actor.windowId || actor.window_id || '',
        },
    };
}

/**
 * Atomically submit a request into requests/pending so co can claim it once.
 */
export async function writeCoRequest(request, { coHome = resolveCoHome() } = {}) {
    const pendingDir = path.join(coHome, 'requests', 'pending');
    await fsPromises.mkdir(pendingDir, { recursive: true });
    const finalPath = path.join(pendingDir, `${request.request_id}.json`);
    const tempPath = `${finalPath}.tmp`;
    await fsPromises.writeFile(tempPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    await fsPromises.rename(tempPath, finalPath);
    return { path: finalPath, request };
}

/**
 * Read a co conversation state file for refresh and multi-device recovery.
 */
export async function readCoConversationState(conversationId, { coHome = resolveCoHome() } = {}) {
    if (!conversationId) {
        return null;
    }
    const statePath = path.join(coHome, 'conversations', conversationId, 'state.json');
    return readJsonFile(statePath);
}

/**
 * Read a co turn state file so the UI can target the current active turn.
 */
export async function readCoTurnState(turnId, { coHome = resolveCoHome() } = {}) {
    if (!turnId) {
        return null;
    }
    const statePath = path.join(coHome, 'turns', turnId, 'state.json');
    return readJsonFile(statePath);
}

/**
 * Tail co events.jsonl and forward complete JSON events to the WebSocket read model.
 */
export function tailCoEvents(turnId, onEvent, { coHome = resolveCoHome(), fromBeginning = true, pollMs = 500 } = {}) {
    const eventsPath = path.join(coHome, 'turns', turnId, 'events.jsonl');
    let offset = 0;
    let closed = false;
    let buffer = '';

    async function poll() {
        /**
         * Polling keeps the implementation dependency-free and survives atomic file creation by co.
         */
        if (closed) {
            return;
        }
        try {
            const stat = await fsPromises.stat(eventsPath);
            if (offset === 0 && !fromBeginning) {
                offset = stat.size;
            }
            if (stat.size < offset) {
                offset = 0;
                buffer = '';
            }
            if (stat.size > offset) {
                const stream = fs.createReadStream(eventsPath, { start: offset, end: stat.size - 1, encoding: 'utf8' });
                for await (const chunk of stream) {
                    buffer += chunk;
                }
                offset = stat.size;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.trim()) {
                        continue;
                    }
                    const event = JSON.parse(line);
                    if (isCoEvent(event)) {
                        onEvent(event);
                    }
                }
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn('[co] Failed to tail events:', error.message);
            }
        } finally {
            if (!closed) {
                setTimeout(poll, pollMs);
            }
        }
    }

    void poll();
    return {
        close() {
            closed = true;
        },
    };
}

/**
 * Check whether a JSONL payload matches the event contract ccflow forwards.
 */
export function isCoEvent(event) {
    return Boolean(
        event
        && CO_EVENT_TYPES.has(event.type)
        && event.provider
        && event.turn_id
        && event.conversation_id
    );
}

/**
 * Create a request id that remains stable enough for idempotent browser retries.
 */
export function createCoRequestId() {
    return `req_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readJsonFile(filePath) {
    /**
     * Missing state simply means co has not materialized the read model yet.
     */
    try {
        return JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
