/**
 * PURPOSE: Load optional local .env variables before the server bootstraps.
 * Missing .env files are expected in many deployments, so only unexpected read
 * failures should be surfaced in logs.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Merge key/value pairs from the local .env file into process.env when present.
 */
function loadOptionalEnvFile() {
  try {
    const envPath = path.join(__dirname, '../.env');
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0 && !process.env[key]) {
          process.env[key] = valueParts.join('=').trim();
        }
      }
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to load local .env file:', error.message);
    }
  }
}

loadOptionalEnvFile();

if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = path.join(os.homedir(), '.ccflow', 'auth.db');
}
