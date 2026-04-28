import jwt from 'jsonwebtoken';
import { userDb } from '../database/db.js';
import { IS_PLATFORM, TRUST_LOCALHOST_AUTH } from '../constants/config.js';

// Get JWT secret from environment or use default (for development)
const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';

/**
 * Normalize a host header into a plain hostname without port.
 */
const normalizeHostname = (value = '') => {
  const rawHost = String(value).split(',')[0].trim().toLowerCase();
  if (!rawHost) {
    return '';
  }

  if (rawHost.startsWith('[')) {
    const closingBracketIndex = rawHost.indexOf(']');
    if (closingBracketIndex !== -1) {
      return rawHost.slice(1, closingBracketIndex);
    }
  }

  return rawHost.replace(/:\d+$/, '');
};

/**
 * Return whether the incoming request was made through a loopback hostname.
 * This intentionally keys off the requested host so localhost direct access can
 * bypass auth while public reverse-proxy domains still require login.
 */
const isLoopbackHostRequest = (req) => {
  if (!TRUST_LOCALHOST_AUTH) {
    return false;
  }

  const forwardedHost = req?.headers?.['x-forwarded-host'];
  const directHost = req?.headers?.host;
  const hostname = req?.hostname;
  const normalizedHost = normalizeHostname(forwardedHost || directHost || hostname);

  return normalizedHost === 'localhost' || normalizedHost === '127.0.0.1' || normalizedHost === '::1';
};

/**
 * Resolve the implicit single-user identity for platform mode or trusted localhost requests.
 */
const resolveTrustedRequestUser = (req) => {
  if (!IS_PLATFORM && !isLoopbackHostRequest(req)) {
    return null;
  }

  return userDb.getFirstUser();
};

/**
 * Build the public auth status so routes can expose whether a request is already trusted.
 */
const getTrustedRequestAuthState = (req) => {
  const user = resolveTrustedRequestUser(req);

  if (!user) {
    return {
      isAuthenticated: false,
      authBypass: false,
      user: null,
    };
  }

  return {
    isAuthenticated: true,
    authBypass: true,
    user: {
      id: user.id,
      username: user.username,
    },
  };
};

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  // Platform mode and trusted localhost both reuse the single local account.
  const trustedUser = resolveTrustedRequestUser(req);
  if (trustedUser) {
    try {
      req.user = trustedUser;
      return next();
    } catch (error) {
      console.error('Trusted auth mode error:', error);
      return res.status(500).json({ error: 'Trusted auth mode: Failed to fetch user' });
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Also check query param for SSE endpoints (EventSource can't set headers)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Generate JWT token (never expires)
const generateToken = (user) => {
  return jwt.sign(
    { 
      userId: user.id, 
      username: user.username 
    },
    JWT_SECRET
    // No expiration - token lasts forever
  );
};

// WebSocket authentication function
function authenticateWebSocket(token, req) {
  // Platform mode and trusted localhost both bypass token validation.
  if (token && typeof token !== 'string') {
    return null;
  }

  const trustedUser = resolveTrustedRequestUser(req);
  if (trustedUser) {
    try {
      return { userId: trustedUser.id, username: trustedUser.username };
    } catch (error) {
      console.error('Trusted auth mode WebSocket error:', error);
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    console.error('WebSocket token verification error:', error);
    return null;
  }
}

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  getTrustedRequestAuthState,
  JWT_SECRET
};
