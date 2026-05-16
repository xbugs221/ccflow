import jwt, { JwtPayload } from 'jsonwebtoken';
import express from 'express';
import { userDb } from '../database/db.js';
import { IS_PLATFORM, TRUST_LOCALHOST_AUTH } from '../constants/config.js';

// Get JWT secret from environment or use default (for development)
const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';

interface TrustedUser {
  id: number;
  username: string;
}

/**
 * Normalize a host header into a plain hostname without port.
 */
const normalizeHostname = (value: string = ''): string => {
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
 */
const isLoopbackHostRequest = (req: express.Request): boolean => {
  if (!TRUST_LOCALHOST_AUTH) {
    return false;
  }

  const forwardedHost = req?.headers?.['x-forwarded-host'] as string | undefined;
  const directHost = req?.headers?.host;
  const hostname = req?.hostname;
  const normalizedHost = normalizeHostname(forwardedHost || directHost || hostname);

  return normalizedHost === 'localhost' || normalizedHost === '127.0.0.1' || normalizedHost === '::1';
};

/**
 * Resolve the implicit single-user identity for platform mode or trusted localhost requests.
 */
const resolveTrustedRequestUser = (req: express.Request): TrustedUser | null => {
  if (!IS_PLATFORM && !isLoopbackHostRequest(req)) {
    return null;
  }

  return userDb.getFirstUser() as TrustedUser | null;
};

/**
 * Build the public auth status so routes can expose whether a request is already trusted.
 */
const getTrustedRequestAuthState = (req: express.Request) => {
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
const validateApiKey = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
  const trustedUser = resolveTrustedRequestUser(req);
  if (trustedUser) {
    try {
      (req as any).user = trustedUser;
      return next();
    } catch (error) {
      console.error('Trusted auth mode error:', error);
      res.status(500).json({ error: 'Trusted auth mode: Failed to fetch user' });
      return;
    }
  }

  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    const user = userDb.getUserById(decoded.userId as number);
    if (!user) {
      res.status(401).json({ error: 'Invalid token. User not found.' });
      return;
    }

    (req as any).user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(403).json({ error: 'Invalid token' });
    return;
  }
};

// Generate JWT token (never expires)
const generateToken = (user: { id: number; username: string }): string => {
  return jwt.sign(
    { 
      userId: user.id, 
      username: user.username 
    },
    JWT_SECRET
  );
};

// WebSocket authentication function
function authenticateWebSocket(token: string | undefined, req: express.Request): { userId: number; username: string } | null {
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

  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
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
