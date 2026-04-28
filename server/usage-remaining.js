/**
 * PURPOSE: Provide provider-specific 5h/7d remaining usage data for WebUI.
 * This module reads local provider state (Claude/Codex) and normalizes it into
 * a shared API response shape that the frontend can render consistently.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_CACHE_TTL_MS = 60_000;
const usageRemainingCache = new Map();

/**
 * Parse numeric values safely from unknown payload fields.
 */
function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

/**
 * Convert used-percent to remaining-percent and clamp to [0, 100].
 */
function toRemainingPercent(usedPercent) {
  const normalizedUsed = parseNumber(usedPercent);
  if (normalizedUsed === null) {
    return null;
  }

  const remaining = 100 - normalizedUsed;
  return Math.max(0, Math.min(100, Number(remaining.toFixed(1))));
}

/**
 * Convert Kimi limit/remaining counters to remaining-percent display values.
 */
function toKimiRemainingPercent(windowData) {
  const limit = parseNumber(windowData?.limit);
  const remaining = parseNumber(windowData?.remaining);

  if (limit === null || remaining === null || limit <= 0) {
    return null;
  }

  return Math.max(0, Math.min(100, Number(((remaining / limit) * 100).toFixed(1))));
}

/**
 * Detect Claude Code settings that route Anthropic requests through Kimi Code.
 */
function getKimiSettingsEnv(settings) {
  const env = settings?.env;
  if (!env || typeof env !== 'object') {
    return null;
  }

  const baseUrl = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : '';
  const apiKey = typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY : '';
  if (!baseUrl.includes('api.kimi.com') || !apiKey.trim()) {
    return null;
  }

  return { baseUrl, apiKey };
}

/**
 * Resolve the Kimi Code usage endpoint from either Anthropic or OpenAI base URLs.
 */
function getKimiUsageUrl(baseUrl) {
  const parsedUrl = new URL(baseUrl);
  return `${parsedUrl.origin}/coding/v1/usages`;
}

/**
 * Fetch Kimi Code 5h/7d quota data directly from the Kimi usage API.
 */
async function getKimiUsageRemaining(settings, options = {}) {
  const kimiEnv = getKimiSettingsEnv(settings);
  if (!kimiEnv) {
    return null;
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return createUnavailableUsageRemaining('claude', 'kimi-usage-api', 'fetch-unavailable');
  }

  try {
    const response = await fetchImpl(getKimiUsageUrl(kimiEnv.baseUrl), {
      headers: {
        Authorization: `Bearer ${kimiEnv.apiKey}`,
      },
    });

    if (!response.ok) {
      return createUnavailableUsageRemaining('claude', 'kimi-usage-api', `http-${response.status}`);
    }

    const payload = await response.json();
    const fiveHourWindow = Array.isArray(payload?.limits)
      ? payload.limits.find((item) => parseNumber(item?.window?.duration) === 300)?.detail
      : null;
    const fiveHourRemaining = toKimiRemainingPercent(fiveHourWindow);
    const sevenDayRemaining = toKimiRemainingPercent(payload?.usage);

    if (fiveHourRemaining === null && sevenDayRemaining === null) {
      return createUnavailableUsageRemaining('claude', 'kimi-usage-api', 'usage-response-invalid');
    }

    return buildUsageRemainingPayload({
      provider: 'claude',
      status: 'ok',
      source: 'kimi-usage-api',
      updatedAt: new Date().toISOString(),
      fiveHourRemaining,
      sevenDayRemaining,
    });
  } catch (error) {
    return createUnavailableUsageRemaining('claude', 'kimi-usage-api', 'request-failed');
  }
}

/**
 * Resolve used-percent fields from Claude/Kimi statusline cache variants.
 */
function getWindowUsedPercent(payload, snakeWindow, camelWindow) {
  const directWindow = payload?.[snakeWindow];
  const directUsed =
    directWindow?.utilization ??
    directWindow?.used_percent ??
    directWindow?.used_percentage ??
    directWindow?.usedPercent ??
    directWindow?.usedPercentage;

  if (parseNumber(directUsed) !== null) {
    return directUsed;
  }

  const rateLimits = payload?.rate_limits || payload?.rateLimits;
  const rateWindow = rateLimits?.[snakeWindow] || rateLimits?.[camelWindow];
  return (
    rateWindow?.utilization ??
    rateWindow?.used_percent ??
    rateWindow?.used_percentage ??
    rateWindow?.usedPercent ??
    rateWindow?.usedPercentage ??
    null
  );
}

/**
 * Build a stable API payload for usage remaining responses.
 */
function buildUsageRemainingPayload({
  provider,
  status,
  source,
  updatedAt,
  fiveHourRemaining,
  sevenDayRemaining,
  reason = null,
}) {
  return {
    provider,
    status,
    source,
    updatedAt,
    reason,
    fiveHourRemaining: {
      value: fiveHourRemaining,
      unit: 'percent',
    },
    sevenDayRemaining: {
      value: sevenDayRemaining,
      unit: 'percent',
    },
  };
}

/**
 * Build an unavailable payload with placeholders for both usage windows.
 */
export function createUnavailableUsageRemaining(provider, source, reason = null) {
  return buildUsageRemainingPayload({
    provider,
    status: 'unavailable',
    source,
    updatedAt: null,
    fiveHourRemaining: null,
    sevenDayRemaining: null,
    reason,
  });
}

/**
 * Load and parse Claude usage cache produced by statusline integrations.
 */
export async function getClaudeUsageRemaining(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');
  const usageCachePath = path.join(homeDir, '.claude', 'cache', 'usage-api.json');

  let settings;
  try {
    const settingsContent = await fs.readFile(settingsPath, 'utf8');
    settings = JSON.parse(settingsContent);
  } catch (error) {
    return createUnavailableUsageRemaining('claude', 'claude-settings', 'settings-not-found');
  }

  const kimiUsage = await getKimiUsageRemaining(settings, options);
  if (kimiUsage) {
    return kimiUsage;
  }

  const statusLine = settings?.statusLine;
  if (!statusLine || typeof statusLine !== 'object') {
    return createUnavailableUsageRemaining('claude', 'claude-statusline', 'statusline-not-configured');
  }

  let usagePayload;
  let usageStat;
  try {
    const usageContent = await fs.readFile(usageCachePath, 'utf8');
    usagePayload = JSON.parse(usageContent);
    usageStat = await fs.stat(usageCachePath);
  } catch (error) {
    return createUnavailableUsageRemaining('claude', 'claude-usage-cache', 'usage-cache-not-found');
  }

  const fiveHourRemaining = toRemainingPercent(getWindowUsedPercent(usagePayload, 'five_hour', 'fiveHour'));
  const sevenDayRemaining = toRemainingPercent(getWindowUsedPercent(usagePayload, 'seven_day', 'sevenDay'));

  if (fiveHourRemaining === null && sevenDayRemaining === null) {
    return createUnavailableUsageRemaining('claude', 'claude-usage-cache', 'usage-cache-invalid');
  }

  const updatedAt =
    usagePayload?.updated_at ||
    usagePayload?.updatedAt ||
    usagePayload?.fetched_at ||
    usagePayload?.fetchedAt ||
    usageStat?.mtime?.toISOString?.() ||
    null;

  return buildUsageRemainingPayload({
    provider: 'claude',
    status: 'ok',
    source: 'claude-usage-cache',
    updatedAt,
    fiveHourRemaining,
    sevenDayRemaining,
  });
}

/**
 * Recursively collect JSONL session files from Codex sessions directory.
 */
async function collectCodexSessionFiles(dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await collectCodexSessionFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    return files;
  }

  return files;
}

/**
 * Find Codex session files sorted by newest mtime first.
 */
async function findCodexSessionFilesByRecency(sessionsDir) {
  const sessionFiles = await collectCodexSessionFiles(sessionsDir);
  if (sessionFiles.length === 0) {
    return [];
  }

  const withStats = [];

  for (const filePath of sessionFiles) {
    try {
      const stat = await fs.stat(filePath);
      withStats.push({ filePath, mtimeMs: stat.mtimeMs || 0 });
    } catch (error) {
      // Ignore unreadable files and continue.
    }
  }

  return withStats
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map((item) => item.filePath);
}

/**
 * Extract the latest rate-limit payload from a Codex JSONL session file.
 */
async function parseCodexRateLimits(sessionFilePath) {
  let fileContent;
  let fileStat;

  try {
    fileContent = await fs.readFile(sessionFilePath, 'utf8');
    fileStat = await fs.stat(sessionFilePath);
  } catch (error) {
    return null;
  }

  const lines = fileContent.split('\n').filter((line) => line.trim().length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]);

      const tokenPayload = entry?.type === 'event_msg' && entry?.payload?.type === 'token_count'
        ? entry.payload
        : entry?.type === 'token_count'
          ? entry
          : null;
      const tokenInfo = tokenPayload?.info || null;
      const rateLimits = tokenPayload?.rate_limits || tokenInfo?.rate_limits;
      if (!rateLimits || typeof rateLimits !== 'object') {
        continue;
      }

      const primaryUsed = parseNumber(rateLimits?.primary?.used_percent);
      const secondaryUsed = parseNumber(rateLimits?.secondary?.used_percent);

      return {
        primaryUsed,
        secondaryUsed,
        updatedAt: entry?.timestamp || fileStat?.mtime?.toISOString?.() || null,
      };
    } catch (error) {
      // Ignore malformed lines.
    }
  }

  return null;
}

/**
 * Load and parse Codex usage limits based on configured statusline modules.
 */
export async function getCodexUsageRemaining(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const sessionsDir = path.join(homeDir, '.codex', 'sessions');

  const sessionFilesByRecency = await findCodexSessionFilesByRecency(sessionsDir);
  if (sessionFilesByRecency.length === 0) {
    return createUnavailableUsageRemaining('codex', 'codex-rate-limits', 'session-file-not-found');
  }

  let rateLimitPayload = null;
  for (const sessionFile of sessionFilesByRecency) {
    rateLimitPayload = await parseCodexRateLimits(sessionFile);
    if (rateLimitPayload) {
      break;
    }
  }

  if (!rateLimitPayload) {
    return createUnavailableUsageRemaining('codex', 'codex-rate-limits', 'rate-limits-not-found');
  }

  const fiveHourRemaining = toRemainingPercent(rateLimitPayload.primaryUsed);
  const sevenDayRemaining = toRemainingPercent(rateLimitPayload.secondaryUsed);

  if (fiveHourRemaining === null && sevenDayRemaining === null) {
    return createUnavailableUsageRemaining('codex', 'codex-rate-limits', 'rate-limits-invalid');
  }

  return buildUsageRemainingPayload({
    provider: 'codex',
    status: 'ok',
    source: 'codex-rate-limits',
    updatedAt: rateLimitPayload.updatedAt,
    fiveHourRemaining,
    sevenDayRemaining,
  });
}

/**
 * Fetch cached provider usage remaining values with short-lived in-memory caching.
 */
export async function getUsageRemaining(provider, options = {}) {
  const normalizedProvider = provider === 'codex' ? 'codex' : 'claude';
  const homeDir = options.homeDir || os.homedir();
  const cacheTtlMs = typeof options.cacheTtlMs === 'number'
    ? options.cacheTtlMs
    : DEFAULT_CACHE_TTL_MS;
  const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();

  const cacheKey = `${normalizedProvider}:${homeDir}`;
  const cached = usageRemainingCache.get(cacheKey);
  if (cached && cacheTtlMs > 0 && nowMs - cached.timestamp < cacheTtlMs) {
    return cached.payload;
  }

  const payload = normalizedProvider === 'codex'
    ? await getCodexUsageRemaining({ homeDir })
    : await getClaudeUsageRemaining({ homeDir });

  usageRemainingCache.set(cacheKey, {
    timestamp: nowMs,
    payload,
  });

  return payload;
}

/**
 * Clear in-memory cache for deterministic tests.
 */
export function clearUsageRemainingCache() {
  usageRemainingCache.clear();
}
