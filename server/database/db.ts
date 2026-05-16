import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { resolvePackageRoot } from '../utils/package-root.js';

const PKG_ROOT = resolvePackageRoot();
const __dirname = path.join(PKG_ROOT, 'server', 'database');

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const c = {
    info: (text: string): string => `${colors.cyan}${text}${colors.reset}`,
    bright: (text: string): string => `${colors.bright}${text}${colors.reset}`,
    dim: (text: string): string => `${colors.dim}${text}${colors.reset}`,
};

// Use DATABASE_PATH environment variable if set, otherwise use default location
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'auth.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

// Ensure database directory exists if custom path is provided
if (process.env.DATABASE_PATH) {
  const dbDir = path.dirname(DB_PATH);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`Created database directory: ${dbDir}`);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Failed to create database directory ${dbDir}:`, err.message);
    throw error;
  }
}

// As part of 1.19.2 we are introducing a new location for auth.db. The below handles exisitng moving legacy database from install directory to new location
const LEGACY_DB_PATH = path.join(__dirname, 'auth.db');
if (DB_PATH !== LEGACY_DB_PATH && !fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
  try {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log(`[MIGRATION] Copied database from ${LEGACY_DB_PATH} to ${DB_PATH}`);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(LEGACY_DB_PATH + suffix)) {
        fs.copyFileSync(LEGACY_DB_PATH + suffix, DB_PATH + suffix);
      }
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.warn(`[MIGRATION] Could not copy legacy database: ${e.message}`);
  }
}

// Create database connection
const db = new Database(DB_PATH);

// Show app installation path prominently
console.log('');
console.log(c.dim('═'.repeat(60)));
console.log(`${c.info('[INFO]')} App Installation: ${c.bright(PKG_ROOT)}`);
console.log(`${c.info('[INFO]')} Database: ${c.dim(path.relative(PKG_ROOT, DB_PATH))}`);
if (process.env.DATABASE_PATH) {
  console.log(`       ${c.dim('(Using custom DATABASE_PATH from environment)')}`);
}
console.log(c.dim('═'.repeat(60)));
console.log('');

interface ColumnInfo {
  name: string;
  [key: string]: unknown;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  last_login: string | null;
  is_active: number;
  git_name?: string | null;
  git_email?: string | null;
  has_completed_onboarding?: number;
}

interface CountRow {
  count: number;
}

const runMigrations = (): void => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all() as ColumnInfo[];
    const columnNames = tableInfo.map((col: ColumnInfo) => col.name);

    if (!columnNames.includes('git_name')) {
      console.log('Running migration: Adding git_name column');
      db.exec('ALTER TABLE users ADD COLUMN git_name TEXT');
    }

    if (!columnNames.includes('git_email')) {
      console.log('Running migration: Adding git_email column');
      db.exec('ALTER TABLE users ADD COLUMN git_email TEXT');
    }

    if (!columnNames.includes('has_completed_onboarding')) {
      console.log('Running migration: Adding has_completed_onboarding column');
      db.exec('ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT 0');
    }

    console.log('Database migrations completed successfully');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Error running migrations:', err.message);
    throw error;
  }
};

// Initialize database with schema
const initializeDatabase = async (): Promise<void> => {
  try {
    const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(initSQL);
    console.log('Database initialized successfully');
    runMigrations();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Error initializing database:', err.message);
    throw error;
  }
};

interface UserRecord {
  id: number;
  username: string;
}

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: (): boolean => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as CountRow;
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username: string, passwordHash: string): UserRecord => {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
      const result = stmt.run(username, passwordHash);
      return { id: Number(result.lastInsertRowid), username };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username: string): UserRow | undefined => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username) as UserRow | undefined;
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Update last login time (non-fatal — logged but not thrown)
  updateLastLogin: (userId: number): void => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn('Failed to update last login:', e.message);
    }
  },

  // Get user by ID
  getUserById: (userId: number): Pick<UserRow, 'id' | 'username' | 'created_at' | 'last_login'> | undefined => {
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login FROM users WHERE id = ? AND is_active = 1').get(userId) as Pick<UserRow, 'id' | 'username' | 'created_at' | 'last_login'> | undefined;
      return row;
    } catch (err) {
      throw err;
    }
  },

  getFirstUser: (): Pick<UserRow, 'id' | 'username' | 'created_at' | 'last_login'> | undefined => {
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login FROM users WHERE is_active = 1 LIMIT 1').get() as Pick<UserRow, 'id' | 'username' | 'created_at' | 'last_login'> | undefined;
      return row;
    } catch (err) {
      throw err;
    }
  },

  updateGitConfig: (userId: number, gitName: string, gitEmail: string): void => {
    try {
      const stmt = db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?');
      stmt.run(gitName, gitEmail, userId);
    } catch (err) {
      throw err;
    }
  },

  getGitConfig: (userId: number): Pick<UserRow, 'git_name' | 'git_email'> | undefined => {
    try {
      const row = db.prepare('SELECT git_name, git_email FROM users WHERE id = ?').get(userId) as Pick<UserRow, 'git_name' | 'git_email'> | undefined;
      return row;
    } catch (err) {
      throw err;
    }
  },

  completeOnboarding: (userId: number): void => {
    try {
      const stmt = db.prepare('UPDATE users SET has_completed_onboarding = 1 WHERE id = ?');
      stmt.run(userId);
    } catch (err) {
      throw err;
    }
  },

  hasCompletedOnboarding: (userId: number): boolean => {
    try {
      const row = db.prepare('SELECT has_completed_onboarding FROM users WHERE id = ?').get(userId) as { has_completed_onboarding: number } | undefined;
      return row?.has_completed_onboarding === 1;
    } catch (err) {
      throw err;
    }
  }
};

interface ApiKeyRecord {
  id: number;
  keyName: string;
  apiKey: string;
}

interface ApiKeyRow {
  id: number;
  key_name: string;
  api_key: string;
  created_at: string;
  last_used: string | null;
  is_active: number;
}

interface ApiKeyValidateRow {
  id: number;
  username: string;
  api_key_id: number;
}

// API Keys database operations
const apiKeysDb = {
  // Generate a new API key
  generateApiKey: (): string => {
    return 'ck_' + crypto.randomBytes(32).toString('hex');
  },

  // Create a new API key
  createApiKey: (userId: number, keyName: string): ApiKeyRecord => {
    try {
      const apiKey = apiKeysDb.generateApiKey();
      const stmt = db.prepare('INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)');
      const result = stmt.run(userId, keyName, apiKey);
      return { id: Number(result.lastInsertRowid), keyName, apiKey };
    } catch (err) {
      throw err;
    }
  },

  // Get all API keys for a user
  getApiKeys: (userId: number): ApiKeyRow[] => {
    try {
      const rows = db.prepare('SELECT id, key_name, api_key, created_at, last_used, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId) as ApiKeyRow[];
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Validate API key and get user
  validateApiKey: (apiKey: string): ApiKeyValidateRow | undefined => {
    try {
      const row = db.prepare(`
        SELECT u.id, u.username, ak.id as api_key_id
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.api_key = ? AND ak.is_active = 1 AND u.is_active = 1
      `).get(apiKey) as ApiKeyValidateRow | undefined;

      if (row) {
        // Update last_used timestamp
        db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(row.api_key_id);
      }

      return row;
    } catch (err) {
      throw err;
    }
  },

  // Delete an API key
  deleteApiKey: (userId: number, apiKeyId: number): boolean => {
    try {
      const stmt = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?');
      const result = stmt.run(apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle API key active status
  toggleApiKey: (userId: number, apiKeyId: number, isActive: boolean): boolean => {
    try {
      const stmt = db.prepare('UPDATE api_keys SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

interface CredentialRecord {
  id: number;
  credentialName: string;
  credentialType: string;
}

interface CredentialRow {
  id: number;
  credential_name: string;
  credential_type: string;
  description: string | null;
  created_at: string;
  is_active: number;
}

// User credentials database operations (for GitHub tokens, GitLab tokens, etc.)
const credentialsDb = {
  // Create a new credential
  createCredential: (userId: number, credentialName: string, credentialType: string, credentialValue: string, description: string | null = null): CredentialRecord => {
    try {
      const stmt = db.prepare('INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description) VALUES (?, ?, ?, ?, ?)');
      const result = stmt.run(userId, credentialName, credentialType, credentialValue, description);
      return { id: Number(result.lastInsertRowid), credentialName, credentialType };
    } catch (err) {
      throw err;
    }
  },

  // Get all credentials for a user, optionally filtered by type
  getCredentials: (userId: number, credentialType: string | null = null): CredentialRow[] => {
    try {
      let query = 'SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?';
      const params: (number | string)[] = [userId];

      if (credentialType) {
        query += ' AND credential_type = ?';
        params.push(credentialType);
      }

      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params) as CredentialRow[];
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Get active credential value for a user by type (returns most recent active)
  getActiveCredential: (userId: number, credentialType: string): string | null => {
    try {
      const row = db.prepare('SELECT credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(userId, credentialType) as { credential_value: string } | undefined;
      return row?.credential_value || null;
    } catch (err) {
      throw err;
    }
  },

  // Delete a credential
  deleteCredential: (userId: number, credentialId: number): boolean => {
    try {
      const stmt = db.prepare('DELETE FROM user_credentials WHERE id = ? AND user_id = ?');
      const result = stmt.run(credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle credential active status
  toggleCredential: (userId: number, credentialId: number, isActive: boolean): boolean => {
    try {
      const stmt = db.prepare('UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// Backward compatibility - keep old names pointing to new system
const githubTokensDb = {
  createGithubToken: (userId: number, tokenName: string, githubToken: string, description: string | null = null) => {
    return credentialsDb.createCredential(userId, tokenName, 'github_token', githubToken, description);
  },
  getGithubTokens: (userId: number) => {
    return credentialsDb.getCredentials(userId, 'github_token');
  },
  getActiveGithubToken: (userId: number) => {
    return credentialsDb.getActiveCredential(userId, 'github_token');
  },
  deleteGithubToken: (userId: number, tokenId: number) => {
    return credentialsDb.deleteCredential(userId, tokenId);
  },
  toggleGithubToken: (userId: number, tokenId: number, isActive: boolean) => {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  }
};

export {
  db,
  initializeDatabase,
  userDb,
  apiKeysDb,
  credentialsDb,
  githubTokensDb // Backward compatibility
};
