/**
 * PURPOSE: Normalize provider session token usage into a shared context-budget
 * payload so REST and WebSocket updates expose the same remaining percentages.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_CLAUDE_CONTEXT_WINDOW = 160000;
const DEFAULT_CODEX_CONTEXT_WINDOW = 200000;
const CODEX_BASELINE_TOKENS = 12000;

/**
 * Parse numeric values safely from session payloads.
 */
function parseFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Clamp a ratio-derived percentage into the [0, 100] range.
 */
function toPercent(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

/**
 * Build the shared token usage payload returned to the frontend.
 */
export function buildSessionTokenUsagePayload({
  used,
  total,
  breakdown = null,
  source,
  updatedAt = null,
  remainingPercent = null,
}) {
  const normalizedUsed = Math.max(0, parseFiniteNumber(used, 0));
  const normalizedTotal = Math.max(0, parseFiniteNumber(total, 0));
  const remaining =
    normalizedTotal > 0
      ? Math.max(0, normalizedTotal - normalizedUsed)
      : null;
  const usedPercent =
    normalizedTotal > 0
      ? toPercent((normalizedUsed / normalizedTotal) * 100)
      : null;
  const derivedRemainingPercent =
    normalizedTotal > 0 && usedPercent !== null
      ? toPercent(100 - usedPercent)
      : null;

  return {
    used: normalizedUsed,
    total: normalizedTotal,
    remaining,
    usedPercent,
    remainingPercent:
      typeof remainingPercent === 'number' && Number.isFinite(remainingPercent)
        ? toPercent(remainingPercent)
        : derivedRemainingPercent,
    breakdown,
    source,
    updatedAt,
  };
}

/**
 * Reproduce Codex CLI's percent_of_context_window_remaining calculation.
 */
function getCodexRemainingPercent(tokensInContextWindow, contextWindow) {
  const normalizedUsed = Math.max(0, parseFiniteNumber(tokensInContextWindow, 0));
  const normalizedWindow = Math.max(0, parseFiniteNumber(contextWindow, 0));

  if (normalizedWindow <= CODEX_BASELINE_TOKENS) {
    return 0;
  }

  const effectiveWindow = normalizedWindow - CODEX_BASELINE_TOKENS;
  const used = Math.max(0, normalizedUsed - CODEX_BASELINE_TOKENS);
  const remaining = Math.max(0, effectiveWindow - used);
  return Math.round((remaining / effectiveWindow) * 100);
}

/**
 * Find the newest Codex session file that matches a session id.
 */
export async function findCodexSessionFilePath(sessionId, options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const sessionsDir = path.join(homeDir, '.codex', 'sessions');
  let latestMatch = null;

  const walk = async (dir) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.name.endsWith('.jsonl') || !entry.name.includes(sessionId)) {
        continue;
      }

      try {
        const stat = await fs.stat(fullPath);
        if (!latestMatch || stat.mtimeMs > latestMatch.mtimeMs) {
          latestMatch = { filePath: fullPath, mtimeMs: stat.mtimeMs };
        }
      } catch {
        // Ignore unreadable session files.
      }
    }
  };

  await walk(sessionsDir);
  return latestMatch?.filePath || null;
}

/**
 * Read the latest Codex token_count event from a session file.
 */
export async function getCodexSessionTokenUsageFromFile(sessionFilePath) {
  const fileContent = await fs.readFile(sessionFilePath, 'utf8');
  const fileStat = await fs.stat(sessionFilePath);
  const lines = fileContent.split('\n').filter((line) => line.trim().length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]);
      const tokenPayload =
        entry?.type === 'event_msg' && entry?.payload?.type === 'token_count'
          ? entry.payload
          : entry?.type === 'token_count'
            ? entry
            : null;
      const tokenInfo = tokenPayload?.info;
      const totalTokenUsage = tokenInfo?.total_token_usage;
      const lastTokenUsage = tokenInfo?.last_token_usage;

      if (!tokenInfo || (!totalTokenUsage && !lastTokenUsage)) {
        continue;
      }

      const currentContextUsage = lastTokenUsage || totalTokenUsage;

      return buildSessionTokenUsagePayload({
        used: currentContextUsage?.total_tokens || 0,
        total: tokenInfo.model_context_window || DEFAULT_CODEX_CONTEXT_WINDOW,
        remainingPercent: getCodexRemainingPercent(
          currentContextUsage?.total_tokens || 0,
          tokenInfo.model_context_window || DEFAULT_CODEX_CONTEXT_WINDOW
        ),
        source: 'codex-session-jsonl',
        updatedAt: entry?.timestamp || fileStat?.mtime?.toISOString?.() || null,
        breakdown: {
          input: parseFiniteNumber(currentContextUsage?.input_tokens, 0),
          cachedInput: parseFiniteNumber(currentContextUsage?.cached_input_tokens, 0),
          output: parseFiniteNumber(currentContextUsage?.output_tokens, 0),
          reasoningOutput: parseFiniteNumber(currentContextUsage?.reasoning_output_tokens, 0),
          cumulativeTotal: parseFiniteNumber(totalTokenUsage?.total_tokens, 0),
        },
      });
    } catch {
      // Ignore malformed lines and continue searching backwards.
    }
  }

  return null;
}

/**
 * Resolve Codex session token usage by session id.
 */
export async function getCodexSessionTokenUsage(sessionId, options = {}) {
  const sessionFilePath = await findCodexSessionFilePath(sessionId, options);
  if (!sessionFilePath) {
    return null;
  }

  return getCodexSessionTokenUsageFromFile(sessionFilePath);
}

/**
 * Read the latest Claude assistant usage payload from a session file.
 */
export async function getClaudeSessionTokenUsage(sessionFilePath, options = {}) {
  const fileContent = await fs.readFile(sessionFilePath, 'utf8');
  const fileStat = await fs.stat(sessionFilePath);
  const lines = fileContent.split('\n').filter((line) => line.trim().length > 0);
  const contextWindow = Number.isFinite(Number(options.contextWindow))
    ? Number(options.contextWindow)
    : DEFAULT_CLAUDE_CONTEXT_WINDOW;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]);
      if (entry?.type !== 'assistant' || !entry?.message?.usage) {
        continue;
      }

      const usage = entry.message.usage;
      const inputTokens = parseFiniteNumber(usage.input_tokens, 0);
      const cacheCreationTokens = parseFiniteNumber(usage.cache_creation_input_tokens, 0);
      const cacheReadTokens = parseFiniteNumber(usage.cache_read_input_tokens, 0);
      const outputTokens = parseFiniteNumber(usage.output_tokens, 0);
      const totalUsed = inputTokens + cacheCreationTokens + cacheReadTokens;

      return buildSessionTokenUsagePayload({
        used: totalUsed,
        total: contextWindow,
        source: 'claude-session-jsonl',
        updatedAt: entry?.timestamp || fileStat?.mtime?.toISOString?.() || null,
        breakdown: {
          input: inputTokens,
          cacheCreation: cacheCreationTokens,
          cacheRead: cacheReadTokens,
          output: outputTokens,
        },
      });
    } catch {
      // Ignore malformed lines and continue searching backwards.
    }
  }

  return null;
}

/**
 * Build a Claude token usage payload from SDK model usage snapshots.
 */
export function getClaudeSessionTokenUsageFromModelUsage(modelData, options = {}) {
  if (!modelData || typeof modelData !== 'object') {
    return null;
  }

  const inputTokens = parseFiniteNumber(
    modelData.cumulativeInputTokens ?? modelData.inputTokens,
    0
  );
  const cacheReadTokens = parseFiniteNumber(
    modelData.cumulativeCacheReadInputTokens ?? modelData.cacheReadInputTokens,
    0
  );
  const cacheCreationTokens = parseFiniteNumber(
    modelData.cumulativeCacheCreationInputTokens ?? modelData.cacheCreationInputTokens,
    0
  );
  const outputTokens = parseFiniteNumber(
    modelData.cumulativeOutputTokens ?? modelData.outputTokens,
    0
  );

  return buildSessionTokenUsagePayload({
    used: inputTokens + cacheReadTokens + cacheCreationTokens,
    total: options.contextWindow || DEFAULT_CLAUDE_CONTEXT_WINDOW,
    source: 'claude-sdk-model-usage',
    breakdown: {
      input: inputTokens,
      cacheCreation: cacheCreationTokens,
      cacheRead: cacheReadTokens,
      output: outputTokens,
    },
  });
}
