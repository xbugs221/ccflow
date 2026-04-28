// PURPOSE: Report local CLI authentication state for supported agent providers.
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const router = express.Router();

router.get('/claude/status', async (req, res) => {
  try {
    const credentialsResult = await checkClaudeCredentials();

    if (credentialsResult.authenticated) {
      return res.json({
        authenticated: true,
        email: credentialsResult.email || 'Authenticated',
        method: credentialsResult.method || 'credentials_file',
        provider: credentialsResult.provider || 'claude',
        baseUrl: credentialsResult.baseUrl || null
      });
    }

    return res.json({
      authenticated: false,
      email: null,
      error: credentialsResult.error || 'Not authenticated'
    });

  } catch (error) {
    console.error('Error checking Claude auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});
router.get('/codex/status', async (req, res) => {
  try {
    const result = await checkCodexCredentials();

    res.json({
      authenticated: result.authenticated,
      email: result.email,
      error: result.error
    });

  } catch (error) {
    console.error('Error checking Codex auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});
/**
 * Checks Claude authentication credentials using three methods with priority order:
 *
 * Priority 1: ANTHROPIC_API_KEY environment variable
 * Priority 2: ~/.claude/settings.json env.ANTHROPIC_API_KEY
 * Priority 3: ~/.claude/.credentials.json OAuth tokens
 *
 * The Claude Agent SDK prioritizes environment variables over authenticated subscriptions.
 * This matching behavior ensures consistency with how the SDK authenticates.
 *
 * References:
 * - https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code
 *   "Claude Code prioritizes environment variable API keys over authenticated subscriptions"
 * - https://platform.claude.com/docs/en/agent-sdk/overview
 *   SDK authentication documentation
 *
 * @returns {Promise<Object>} Authentication status with { authenticated, email, method }
 *   - authenticated: boolean indicating if valid credentials exist
 *   - email: user email or auth method identifier
 *   - method: 'api_key' for env var, 'credentials_file' for OAuth tokens
 */
async function checkClaudeCredentials() {
  const processEnvAuth = readClaudeEnvAuth(process.env);
  if (processEnvAuth.authenticated) {
    return processEnvAuth;
  }

  const settingsEnvAuth = await readClaudeSettingsEnvAuth();
  if (settingsEnvAuth.authenticated) {
    return settingsEnvAuth;
  }

  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(content);

    const oauth = creds.claudeAiOauth;
    if (oauth && oauth.accessToken) {
      const isExpired = oauth.expiresAt && Date.now() >= oauth.expiresAt;

      if (!isExpired) {
        return {
          authenticated: true,
          email: creds.email || creds.user || null,
          method: 'credentials_file',
          provider: 'claude',
          baseUrl: null
        };
      }
    }

    return {
      authenticated: false,
      email: null
    };
  } catch (error) {
    return {
      authenticated: false,
      email: null
    };
  }
}

/**
 * Convert Claude env values into an auth summary without exposing the API key.
 */
function readClaudeEnvAuth(env) {
  const apiKey = typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY.trim() : '';
  if (!apiKey) {
    return {
      authenticated: false,
      email: null
    };
  }

  const baseUrl = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL.trim() : '';
  const isKimi = baseUrl.includes('api.kimi.com');

  return {
    authenticated: true,
    email: isKimi ? 'Kimi provider' : 'API key',
    method: 'api_key',
    provider: isKimi ? 'kimi' : 'anthropic',
    baseUrl: baseUrl || null
  };
}

/**
 * Read Claude Code settings env because Claude applies it to every session.
 */
async function readClaudeSettingsEnvAuth() {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const settingsContent = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(settingsContent);
    return readClaudeEnvAuth(settings?.env || {});
  } catch (error) {
    return {
      authenticated: false,
      email: null
    };
  }
}

async function checkCodexCredentials() {
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    const content = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(content);

    // Tokens are nested under 'tokens' key
    const tokens = auth.tokens || {};

    // Check for valid tokens (id_token or access_token)
    if (tokens.id_token || tokens.access_token) {
      // Try to extract email from id_token JWT payload
      let email = 'Authenticated';
      if (tokens.id_token) {
        try {
          // JWT is base64url encoded: header.payload.signature
          const parts = tokens.id_token.split('.');
          if (parts.length >= 2) {
            // Decode the payload (second part)
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            email = payload.email || payload.user || 'Authenticated';
          }
        } catch {
          // If JWT decoding fails, use fallback
          email = 'Authenticated';
        }
      }

      return {
        authenticated: true,
        email
      };
    }

    // Also check for OPENAI_API_KEY as fallback auth method
    if (auth.OPENAI_API_KEY) {
      return {
        authenticated: true,
        email: 'API Key Auth'
      };
    }

    return {
      authenticated: false,
      email: null,
      error: 'No valid tokens found'
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        authenticated: false,
        email: null,
        error: 'Codex not configured'
      };
    }
    return {
      authenticated: false,
      email: null,
      error: error.message
    };
  }
}

export default router;
