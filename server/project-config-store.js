/**
 * PURPOSE: Provide the single filesystem writer for project-local ccflow config.
 * Business modules build the next config object; this module owns path resolution,
 * idempotent JSON formatting, directory creation, and disk writes.
 *
 * Config is stored under XDG state directory to avoid polluting source repos:
 *   ${XDG_STATE_HOME:-~/.local/state}/ccflow/conf.json          (global)
 *   ${XDG_STATE_HOME:-~/.local/state}/ccflow/repos/<repo-key>/conf.json (project)
 */
import { promises as fs } from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';

const CONFIG_READ_RETRY_DELAYS_MS = [10, 30, 75];
let configWriteCounter = 0;

function isRetryableJsonReadError(error) {
  /**
   * PURPOSE: Detect transient parse failures caused by another process reading
   * conf.json while a non-atomic writer is replacing its contents.
   */
  return error instanceof SyntaxError && /Unexpected end of JSON input/.test(error.message || '');
}

function sleep(ms) {
  /**
   * PURPOSE: Wait briefly between config read retries without blocking the
   * event loop; config files are small and retries should complete quickly.
   */
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the ccflow state root directory from environment.
 * Uses XDG_STATE_HOME/ccflow when available, falls back to ~/.local/state/ccflow.
 */
export function resolveCcflowStateRoot(env = process.env) {
  const base = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'ccflow');
}

/**
 * Generate a stable repo-key from the project absolute path.
 * Format: <basename>-<sha1-10>
 * Different absolute paths with the same basename produce distinct keys.
 */
export function resolveProjectStateKey(projectPath) {
  const absPath = path.resolve(projectPath);
  const basename = path.basename(absPath);
  const safeBasename = basename.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  const hash = crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 10);
  return `${safeBasename}-${hash}`;
}

export function getProjectLocalConfigPath(projectPath = '') {
  /**
   * Resolve the project-local config path, or the global config path when no
   * project path is supplied. Both now live under the XDG state ccflow root.
   */
  const root = resolveCcflowStateRoot();
  return projectPath
    ? path.join(root, 'repos', resolveProjectStateKey(projectPath), 'conf.json')
    : path.join(root, 'conf.json');
}

export async function readProjectLocalConfig(projectPath = '') {
  /**
   * Read conf.json as a plain object. Missing config is treated as empty.
   */
  const { config } = await readProjectLocalConfigFile(projectPath);
  return config;
}

/**
 * Resolve the legacy config path that may contain data from before the XDG
 * state migration. This is only used as a read fallback.
 */
function getLegacyConfigPath(projectPath = '') {
  return projectPath
    ? path.join(path.resolve(projectPath), '.ccflow', 'conf.json')
    : path.join(os.homedir(), '.ccflow', 'conf.json');
}

/**
 * Raw file read with retry; does NOT normalize or migrate.
 */
async function readConfigFileRaw(configPath) {
  let lastParseError = null;

  for (let attempt = 0; attempt <= CONFIG_READ_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(CONFIG_READ_RETRY_DELAYS_MS[attempt - 1]);
    }

    try {
      const rawConfig = await fs.readFile(configPath, 'utf8');
      const parsedConfig = JSON.parse(rawConfig);
      return {
        config: parsedConfig && typeof parsedConfig === 'object' && !Array.isArray(parsedConfig)
          ? parsedConfig
          : {},
        exists: true,
        rawConfig,
      };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          config: {},
          exists: false,
          rawConfig: '',
        };
      }
      if (isRetryableJsonReadError(error)) {
        lastParseError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastParseError;
}

export async function readProjectLocalConfigFile(projectPath = '') {
  /**
   * Read conf.json with existence metadata.
   *
   * Migration strategy:
   * 1. Try the new XDG state config path first.
   * 2. If it doesn't exist, try the legacy ~/.ccflow or <project>/.ccflow path.
   * 3. On successful legacy read, migrate the data to the new state path.
   * 4. Return the config regardless of source.
   */
  const newPath = getProjectLocalConfigPath(projectPath);
  const newResult = await readConfigFileRaw(newPath);

  if (newResult.exists) {
    return newResult;
  }

  // Try legacy path as migration fallback
  const legacyPath = getLegacyConfigPath(projectPath);
  const legacyResult = await readConfigFileRaw(legacyPath);

  if (legacyResult.exists) {
    // Migrate: write legacy config to new state path using the shared
    // atomic writer so concurrent first-readers never collide on temp
    // filenames. writeProjectLocalConfig is idempotent — if another
    // process already migrated the same content this call is a no-op.
    await writeProjectLocalConfig(projectPath, legacyResult.config);
    return legacyResult;
  }

  // Neither exist
  return { config: {}, exists: false, rawConfig: '' };
}

export async function writeProjectLocalConfig(projectPath = '', config = {}) {
  /**
   * Write conf.json only when formatted content changed, using atomic rename so
   * concurrent readers never observe an empty or partially written JSON file.
   */
  const configPath = getProjectLocalConfigPath(projectPath);
  const nextConfigJson = JSON.stringify(config && typeof config === 'object' && !Array.isArray(config) ? config : {}, null, 2);
  const nextConfigData = `${nextConfigJson}\n`;

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  try {
    const currentConfigData = await fs.readFile(configPath, 'utf8');
    if (currentConfigData === nextConfigData || currentConfigData === nextConfigJson) {
      return false;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  configWriteCounter += 1;
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.${configWriteCounter}.tmp`;
  await fs.writeFile(tempPath, nextConfigData, 'utf8');
  await fs.rename(tempPath, configPath);
  return true;
}
