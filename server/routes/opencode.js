/**
 * PURPOSE: Serve OpenCode provider configuration, session history, and
 * session management HTTP endpoints for the ccflow web UI.
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

function normalizeProviderStatus(rawProviders = {}) {
  /**
   * Convert OpenCode status shapes into the settings-page provider list.
   */
  if (Array.isArray(rawProviders)) {
    return rawProviders
      .map((provider) => ({
        name: String(provider.name || provider.id || '').trim(),
        connected: Boolean(provider.connected ?? provider.available ?? provider.authenticated),
        source: provider.source || 'opencode',
      }))
      .filter((provider) => provider.name);
  }

  return Object.entries(rawProviders)
    .map(([name, value]) => {
      const detail = value && typeof value === 'object' ? value : {};
      return {
        name,
        connected: typeof value === 'boolean' ? value : Boolean(detail.connected ?? detail.available ?? detail.authenticated),
        source: detail.source || 'opencode',
      };
    })
    .filter((provider) => provider.name);
}

router.get('/status', async (_req, res) => {
  try {
    const respond = createCliResponder(res);
    const { proc, cliPath } = spawnOpencodeCli(['auth', 'list', '--json']);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      let providers = [];
      if (stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout);
          providers = normalizeProviderStatus(parsed.providers || parsed);
        } catch {
          providers = stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((name) => ({ name, connected: true, source: 'opencode' }));
        }
      }

      if (code === 0) {
        respond(200, {
          authenticated: providers.some((provider) => provider.connected),
          email: null,
          provider: providers.find((provider) => provider.connected)?.name || null,
          baseUrl: null,
          providers,
        });
        return;
      }

      respond(200, {
        authenticated: false,
        email: null,
        provider: null,
        baseUrl: null,
        providers,
        error: stderr.trim() || `OpenCode status exited with code ${code}`,
      });
    });

    proc.on('error', (error) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        authenticated: false,
        email: null,
        provider: null,
        baseUrl: null,
        providers: [],
        error: isMissing ? formatOpencodeCliNotFoundMessage(cliPath) : error.message,
        code: error.code,
      });
    });
  } catch (error) {
    res.status(500).json({
      authenticated: false,
      email: null,
      provider: null,
      baseUrl: null,
      providers: [],
      error: error.message,
    });
  }
});

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

router.get('/sessions', async (req, res) => {
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

router.get('/sessions/:sessionId/messages', async (req, res) => {
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

router.delete('/sessions/:sessionId', async (req, res) => {
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
