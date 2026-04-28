/**
 * PURPOSE: Resolve Claude Code model choices by querying the configured model API.
 * The frontend consumes this catalog so model buttons match the provider account.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const CUSTOM_MODEL_ENV_KEYS = ['ANTHROPIC_MODEL', 'CLAUDE_MODEL'];
const DEFAULT_ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const MODEL_FETCH_TIMEOUT_MS = 5_000;

/**
 * Convert a model id into a readable select label.
 * @param {string} model - Provider model id or Claude alias.
 * @param {string} displayName - Optional provider display name.
 * @returns {string} Label for the model picker.
 */
function formatModelLabel(model, displayName = '') {
  const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
  if (normalizedDisplayName) {
    return normalizedDisplayName;
  }

  return model
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || model;
}

/**
 * Add a model option once, preserving provider ordering.
 * @param {{ value: string; label: string }[]} options - Mutable option list.
 * @param {string} model - Model id to add.
 * @param {string} displayName - Optional provider display name.
 */
function addModelOption(options, model, displayName = '') {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel || options.some((option) => option.value === normalizedModel)) {
    return;
  }

  options.push({ value: normalizedModel, label: formatModelLabel(normalizedModel, displayName) });
}

/**
 * Read Claude Code settings from a HOME directory.
 * @param {string} homeDir - User home directory.
 * @returns {Promise<object|null>} Parsed settings or null when absent.
 */
async function readClaudeSettings(homeDir) {
  try {
    const settingsContent = await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8');
    return JSON.parse(settingsContent);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve the model-list URL from Claude-compatible base URLs.
 * @param {string} baseUrl - Configured ANTHROPIC_BASE_URL.
 * @returns {string} Concrete models endpoint.
 */
function resolveModelsUrl(baseUrl) {
  const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!normalizedBaseUrl) {
    return DEFAULT_ANTHROPIC_MODELS_URL;
  }

  const parsedUrl = new URL(normalizedBaseUrl);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/models')) {
    return parsedUrl.toString().replace(/\/+$/, '');
  }

  if (pathname.endsWith('/v1')) {
    parsedUrl.pathname = `${pathname}/models`;
    return parsedUrl.toString();
  }

  parsedUrl.pathname = `${pathname || ''}/v1/models`;
  return parsedUrl.toString();
}

/**
 * Build auth header variants for common Anthropic/OpenAI-compatible model APIs.
 * @param {string} apiKey - Provider API key.
 * @param {string} modelsUrl - Concrete model list URL.
 * @returns {Array<Record<string, string>>} Request header candidates.
 */
function getModelRequestHeaderCandidates(apiKey, modelsUrl) {
  const commonHeaders = { Accept: 'application/json' };
  const isAnthropicHost = new URL(modelsUrl).hostname.includes('anthropic.com');
  const bearerHeaders = {
    ...commonHeaders,
    Authorization: `Bearer ${apiKey}`,
  };
  const anthropicHeaders = {
    ...commonHeaders,
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  return isAnthropicHost ? [anthropicHeaders, bearerHeaders] : [bearerHeaders, anthropicHeaders];
}

/**
 * Fetch JSON with a short timeout so UI startup is not blocked by dead providers.
 * @param {string} url - URL to fetch.
 * @param {object} options - Fetch options.
 * @param {Function} fetchImpl - Fetch implementation.
 * @returns {Promise<object>} Parsed JSON payload.
 */
async function fetchJsonWithTimeout(url, options, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`http-${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Normalize Anthropic/OpenAI-compatible model-list payloads.
 * @param {object} payload - Provider response payload.
 * @returns {{ value: string; label: string }[]} Model options.
 */
function normalizeModelListPayload(payload) {
  const models = [];
  const data = Array.isArray(payload?.data) ? payload.data : [];

  for (const item of data) {
    if (typeof item === 'string') {
      addModelOption(models, item);
      continue;
    }

    addModelOption(models, item?.id, item?.display_name || item?.name);
  }

  return models;
}

/**
 * Query the configured model-list API and return available model options.
 * @param {object} env - Merged Claude env configuration.
 * @param {Function} fetchImpl - Fetch implementation.
 * @returns {Promise<{models: Array<{value: string; label: string}>, modelsUrl: string}>}
 */
async function fetchConfiguredModelCatalog(env, fetchImpl) {
  const apiKey = typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY.trim() : '';
  if (!apiKey) {
    throw new Error('missing-anthropic-api-key');
  }

  const modelsUrl = resolveModelsUrl(env.ANTHROPIC_BASE_URL);
  const headerCandidates = getModelRequestHeaderCandidates(apiKey, modelsUrl);
  let lastError = null;

  for (const headers of headerCandidates) {
    try {
      const payload = await fetchJsonWithTimeout(modelsUrl, { headers }, fetchImpl);
      const models = normalizeModelListPayload(payload);
      if (models.length === 0) {
        throw new Error('empty-model-list');
      }
      return { models, modelsUrl };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('model-list-unavailable');
}

/**
 * Build the Claude model catalog from configured endpoint and account models.
 * @param {object} options - Optional test hooks.
 * @returns {Promise<{models: Array<{value: string; label: string}>, defaultModel: string, source: string, modelsUrl?: string, fetchError?: string}>}
 */
export async function getClaudeModelCatalog(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const runtimeEnv = options.env || process.env;
  const settings = options.settings || await readClaudeSettings(homeDir);
  const settingsEnv = settings?.env && typeof settings.env === 'object' ? settings.env : {};
  const mergedEnv = { ...runtimeEnv, ...settingsEnv };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configuredModel = CUSTOM_MODEL_ENV_KEYS
    .map((envKey) => (typeof mergedEnv[envKey] === 'string' ? mergedEnv[envKey].trim() : ''))
    .find(Boolean);

  if (typeof fetchImpl === 'function') {
    try {
      const catalog = await fetchConfiguredModelCatalog(mergedEnv, fetchImpl);
      const modelValues = new Set(catalog.models.map((model) => model.value));
      return {
        models: catalog.models,
        defaultModel: configuredModel && modelValues.has(configuredModel)
          ? configuredModel
          : catalog.models[0].value,
        source: 'provider-models-api',
        modelsUrl: catalog.modelsUrl,
      };
    } catch (error) {
      return {
        models: [],
        defaultModel: '',
        source: 'provider-models-api-unavailable',
        fetchError: error?.message || 'model-list-unavailable',
      };
    }
  }

  return {
    models: [],
    defaultModel: '',
    source: 'provider-models-api-unavailable',
    fetchError: 'fetch-unavailable',
  };
}
