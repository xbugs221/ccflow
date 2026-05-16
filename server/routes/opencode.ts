// @ts-nocheck -- Route typing: large file, needs dedicated type pass.
/**
 * PURPOSE: Serve OpenCode provider configuration, session history, and
 * session management HTTP endpoints for the cbw web UI.
 */
import express from 'express';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import {
  resolveOpencodeCliPath,
  formatOpencodeCliNotFoundMessage,
} from '../opencode-sdk.js';

const router = express.Router();
const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const OPENCODE_AUTH_TYPES = new Set(['api', 'oauth', 'token']);

function createCliResponder(res) {
  let responded = false;
  return (status, payload) => {
    if (responded || res.headersSent) {
      return;
    }
    responded = true;
    res.status(status).json(payload);
  };
}

/**
 * Spawn the resolved OpenCode CLI.
 */
function spawnOpencodeCli(args) {
  const cliPath = resolveOpencodeCliPath();
  const proc = spawn(cliPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  return { proc, cliPath };
}

function maskSensitiveValue(value) {
  /**
   * Return only short, non-sensitive summaries for credential-like values.
   */
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  if (text.length <= 8) {
    return '***';
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function normalizeApiMetadata(raw = {}) {
  /**
   * Keep API metadata useful for display without returning secrets.
   */
  const api = raw.api && typeof raw.api === 'object' ? raw.api : raw;
  const authType = String(raw.authType || api.type || raw.type || '').trim() || null;
  return {
    type: authType,
    baseUrl: api.baseUrl || api.baseURL || api.base_url || raw.baseUrl || raw.baseURL || raw.base_url || null,
    keyPreview: api.keyPreview || api.key_preview || raw.keyPreview || raw.key_preview || maskSensitiveValue(api.key || api.apiKey || api.token || raw.key || raw.apiKey || raw.token),
  };
}

function normalizeProviderStatus(rawProviders = {}, source = 'opencode') {
  /**
   * Convert OpenCode status shapes into the settings-page provider list.
   */
  if (Array.isArray(rawProviders)) {
    return rawProviders
      .map((provider) => ({
        name: String(provider.name || provider.id || '').trim(),
        connected: Boolean(provider.connected ?? provider.available ?? provider.authenticated),
        source: provider.source || source,
        authType: String(provider.authType || provider.type || provider.api?.type || '').trim() || null,
        api: normalizeApiMetadata(provider),
      }))
      .filter((provider) => provider.name);
  }

  return Object.entries(rawProviders)
    .map(([name, value]) => {
      const detail = value && typeof value === 'object' ? value : {};
      return {
        name,
        connected: typeof value === 'boolean' ? value : Boolean(detail.connected ?? detail.available ?? detail.authenticated),
        source: detail.source || source,
        authType: String(detail.authType || detail.type || detail.api?.type || '').trim() || null,
        api: normalizeApiMetadata(detail),
      };
    })
    .filter((provider) => provider.name);
}

export function parseOpencodeAuthListText(output) {
  /**
   * Parse current OpenCode auth list text output into provider records.
   */
  const providers = [];
  let credentialSource = null;

  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_ESCAPE_PATTERN, '').trim();
    if (!line) {
      continue;
    }

    const cleanLine = line.replace(/^[┌│●└├─\-\*•\s]+/, '').trim();
    const sourceMatch = cleanLine.match(/^Credentials\s+(.+)$/i);
    if (sourceMatch) {
      credentialSource = sourceMatch[1].trim();
      continue;
    }

    if (/^\W*\d+\s+credentials?\s*$/i.test(line)) {
      continue;
    }

    const providerLine = cleanLine;
    if (!providerLine || /^credentials?\b/i.test(providerLine)) {
      continue;
    }

    const parts = providerLine.split(/\s+/);
    const last = parts[parts.length - 1] || '';
    const normalizedAuthType = last.toLowerCase();
    const hasAuthType = OPENCODE_AUTH_TYPES.has(normalizedAuthType) && parts.length > 1;
    const authType = hasAuthType ? normalizedAuthType : null;
    const name = (hasAuthType ? parts.slice(0, -1).join(' ') : providerLine).trim();
    if (!name) {
      continue;
    }
    providers.push({
      name,
      connected: true,
      source: credentialSource || 'opencode',
      authType,
      api: {
        type: authType,
        baseUrl: null,
        keyPreview: null,
      },
    });
  }

  return providers;
}

function runOpencodeCli(args) {
  /**
   * Execute one OpenCode command and collect stdout/stderr for status probing.
   */
  return new Promise((resolve, reject) => {
    const { proc, cliPath } = spawnOpencodeCli(args);
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr, cliPath }));
    proc.on('error', (error) => {
      error.cliPath = cliPath;
      reject(error);
    });
  });
}

function buildOpencodeStatusPayload({ available, providers = [], error = null }) {
  /**
   * Shape OpenCode status for the settings page.
   */
  return {
    available,
    authenticated: providers.some((provider) => provider.connected),
    email: null,
    provider: providers.find((provider) => provider.connected)?.name || null,
    baseUrl: providers.find((provider) => provider.api?.baseUrl)?.api?.baseUrl || null,
    providers,
    error,
  };
}

router.get('/status', async (_req, res) => {
  try {
    let jsonResult;
    try {
      jsonResult = await runOpencodeCli(['auth', 'list', '--json']);
    } catch (error) {
      const isMissing = error?.code === 'ENOENT';
      res.status(isMissing ? 503 : 500).json(buildOpencodeStatusPayload({
        available: false,
        providers: [],
        error: isMissing ? formatOpencodeCliNotFoundMessage(error.cliPath) : error.message,
      }));
      return;
    }

    if (jsonResult.code === 0) {
      const parsed = JSON.parse(jsonResult.stdout || '{}');
      const providers = normalizeProviderStatus(parsed.providers || parsed);
      res.status(200).json(buildOpencodeStatusPayload({ available: true, providers }));
      return;
    }

    const textResult = await runOpencodeCli(['auth', 'list']);
    if (textResult.code === 0) {
      const providers = parseOpencodeAuthListText(textResult.stdout);
      res.status(200).json(buildOpencodeStatusPayload({ available: true, providers }));
      return;
    }

    const versionResult = await runOpencodeCli(['--version']);
    res.status(200).json(buildOpencodeStatusPayload({
      available: versionResult.code === 0,
      providers: [],
      error: textResult.stderr.trim() || textResult.stdout.trim() || `OpenCode auth list exited with code ${textResult.code}`,
    }));
  } catch (error) {
    const isMissing = error?.code === 'ENOENT';
    res.status(isMissing ? 503 : 500).json(buildOpencodeStatusPayload({
      available: false,
      providers: [],
      error: isMissing ? formatOpencodeCliNotFoundMessage(error.cliPath) : error.message,
    }));
  }
});

export const __opencodeStatusInternalsForTest = {
  parseOpencodeAuthListText,
  normalizeProviderStatus,
  buildOpencodeStatusPayload,
};

router.get('/models', async (_req, res) => {
  try {
    const respond = createCliResponder(res);
    const { proc, cliPath } = spawnOpencodeCli(['models']);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const models = JSON.parse(stdout);
          respond(200, { success: true, models });
        } catch {
          respond(200, { success: true, output: stdout });
        }
      } else {
        respond(500, { error: 'OpenCode CLI command failed', details: stderr || `Exited with code ${code}` });
      }
    });

    proc.on('error', (error) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'OpenCode CLI not installed' : 'Failed to run OpenCode CLI',
        details: isMissing ? formatOpencodeCliNotFoundMessage(cliPath) : error.message,
        code: error.code,
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list models', details: error.message });
  }
});

router.get('/sessions', async (req: express.Request, res: express.Response) => {
  try {
    const { projectPath } = req.query;

    if (!projectPath) {
      return res.status(400).json({ success: false, error: 'projectPath query parameter required' });
    }

    const respond = createCliResponder(res);
    const { proc, cliPath } = spawnOpencodeCli(['session', 'list', '--format', 'json']);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        respond(500, { error: 'OpenCode CLI command failed', details: stderr || `Exited with code ${code}` });
        return;
      }

      try {
        const allSessions = JSON.parse(stdout);
        if (!Array.isArray(allSessions)) {
          respond(200, { success: true, sessions: [] });
          return;
        }

        // Filter sessions by project directory
        const normalizedProjectPath = path.resolve(projectPath);
        const sessions = allSessions.filter((session) => {
          if (!session.directory) return false;
          return path.resolve(session.directory) === normalizedProjectPath;
        });

        respond(200, { success: true, sessions });
      } catch {
        respond(200, { success: true, output: stdout, sessions: [] });
      }
    });

    proc.on('error', (error) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'OpenCode CLI not installed' : 'Failed to run OpenCode CLI',
        details: isMissing ? formatOpencodeCliNotFoundMessage(cliPath) : error.message,
        code: error.code,
      });
    });
  } catch (error) {
    console.error('Error fetching OpenCode sessions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sessions/:sessionId/messages', async (req: express.Request, res: express.Response) => {
  try {
    const { sessionId } = req.params;

    const respond = createCliResponder(res);
    const { proc, cliPath } = spawnOpencodeCli(['export', sessionId]);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        respond(500, { error: 'OpenCode CLI command failed', details: stderr || `Exited with code ${code}` });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        respond(200, { success: true, ...result });
      } catch {
        respond(200, { success: true, output: stdout });
      }
    });

    proc.on('error', (error) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'OpenCode CLI not installed' : 'Failed to run OpenCode CLI',
        details: isMissing ? formatOpencodeCliNotFoundMessage(cliPath) : error.message,
        code: error.code,
      });
    });
  } catch (error) {
    console.error(`Error fetching OpenCode session messages ${req.params.sessionId}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/sessions/:sessionId', async (req: express.Request, res: express.Response) => {
  try {
    const { sessionId } = req.params;

    const respond = createCliResponder(res);
    const { proc, cliPath } = spawnOpencodeCli(['session', 'delete', sessionId]);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        respond(200, { success: true, output: stdout });
      } else {
        respond(500, { error: 'OpenCode CLI command failed', details: stderr || `Exited with code ${code}` });
      }
    });

    proc.on('error', (error) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'OpenCode CLI not installed' : 'Failed to run OpenCode CLI',
        details: isMissing ? formatOpencodeCliNotFoundMessage(cliPath) : error.message,
        code: error.code,
      });
    });
  } catch (error) {
    console.error(`Error deleting OpenCode session ${req.params.sessionId}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
