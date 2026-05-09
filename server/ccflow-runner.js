#!/usr/bin/env node
/**
 * PURPOSE: Execute one durable Codex/OpenCode turn outside the Web service.
 */
import {
  appendTurnEvent,
  readTurnState,
  writeTurnState,
} from './runner-turns.js';
import { queryCodex } from './openai-codex.js';
import { queryOpencode } from './opencode-sdk.js';

/**
 * Resolve CLI arguments passed by startRunnerTurn.
 */
function parseRunnerArgs(argv) {
  const flagIndex = argv.indexOf('--turn-dir');
  const requestIndex = argv.indexOf('--request');
  return {
    turnDir: flagIndex >= 0 && argv[flagIndex + 1]
      ? argv[flagIndex + 1]
      : process.env.CCFLOW_RUNNER_TURN_DIR || '',
    encodedRequest: requestIndex >= 0 && argv[requestIndex + 1]
      ? argv[requestIndex + 1]
      : process.env.CCFLOW_RUNNER_REQUEST || '',
  };
}

/**
 * Build a writer that appends provider events to events.jsonl.
 */
function createJsonlWriter(turnDir, state) {
  let currentSessionId = state.providerSessionId || '';
  let writeQueue = Promise.resolve();
  const sentEventTypes = new Set();
  return {
    isWebSocketWriter: true,
    send(event) {
      const payload = {
        ...event,
        turnId: state.turnId,
        provider: event.provider || state.provider,
        ccflowSessionId: state.ccflowSessionId || null,
        clientRequestId: event.clientRequestId || state.clientRequestId || null,
      };
      if (payload.type) {
        sentEventTypes.add(String(payload.type));
      }
      if (payload.sessionId) {
        currentSessionId = payload.sessionId;
      }
      writeQueue = writeQueue.then(() => appendTurnEvent(turnDir, payload));
      return writeQueue;
    },
    async flush() {
      /**
       * Wait until provider send() calls have reached events.jsonl in order.
       */
      await writeQueue;
    },
    setSessionId(sessionId) {
      currentSessionId = sessionId || currentSessionId;
    },
    getSessionId() {
      return currentSessionId;
    },
    hasEventType(type) {
      /**
       * Report whether provider code already wrote a terminal event.
       */
      return sentEventTypes.has(String(type || ''));
    },
  };
}

/**
 * Execute the provider CLI and keep turn.json status current.
 */
async function main() {
  const { turnDir, encodedRequest } = parseRunnerArgs(process.argv);
  if (!turnDir) {
    throw new Error('Missing --turn-dir');
  }
  if (!encodedRequest) {
    throw new Error('Missing --request');
  }

  const request = JSON.parse(Buffer.from(encodedRequest, 'base64url').toString('utf8'));
  let state = await readTurnState(turnDir);
  if (!state) {
    throw new Error('Missing turn.json');
  }

  const writer = createJsonlWriter(turnDir, state);
  const providerOptions = {
    cwd: request.projectPath,
    projectPath: request.projectPath,
    sessionId: request.providerSessionId || undefined,
    clientRequestId: request.clientRequestId || undefined,
    model: request.model || undefined,
    reasoningEffort: request.reasoningEffort || undefined,
    permissionMode: request.permissionMode || undefined,
    attachments: request.attachments || [],
  };

  let resolvedSessionId = '';
  try {
    if (process.env.CCFLOW_FAKE_RUNNER === '1') {
      const delayMs = Number.parseInt(process.env.CCFLOW_FAKE_RUNNER_DELAY_MS || '0', 10);
      if (Number.isFinite(delayMs) && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      resolvedSessionId = request.providerSessionId || `${request.provider}-fake-session`;
      writer.send({
        type: 'session-created',
        sessionId: resolvedSessionId,
        provider: request.provider,
        clientRequestId: request.clientRequestId || null,
      });
      writer.send({
        type: `${request.provider}-response`,
        sessionId: resolvedSessionId,
        data: { type: 'item', itemType: 'agent_message', message: { role: 'assistant', content: 'fake runner response' } },
      });
      writer.send({
        type: `${request.provider}-complete`,
        sessionId: resolvedSessionId,
        actualSessionId: resolvedSessionId,
      });
    } else if (request.provider === 'codex') {
      resolvedSessionId = await queryCodex(request.prompt, providerOptions, writer);
    } else if (request.provider === 'opencode') {
      resolvedSessionId = await queryOpencode(request.prompt, providerOptions, writer);
    } else {
      throw new Error('Unsupported provider');
    }
    await writer.flush();

    state = {
      ...state,
      status: 'completed',
      providerSessionId: resolvedSessionId || writer.getSessionId() || state.providerSessionId || null,
      updatedAt: new Date().toISOString(),
    };
    await writeTurnState(turnDir, state);
  } catch (error) {
    await writer.flush();
    state = {
      ...state,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    };
    await writeTurnState(turnDir, state);
    const fallbackErrorType = `${request.provider}-error`;
    if (!writer.hasEventType(fallbackErrorType)) {
      await appendTurnEvent(turnDir, {
        type: fallbackErrorType,
        provider: request.provider,
        sessionId: state.providerSessionId || state.ccflowSessionId || null,
        ccflowSessionId: state.ccflowSessionId || null,
        error: error.message,
      });
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[ccflow-runner]', error);
  process.exit(1);
});
