/**
 * PURPOSE: Provide the single filesystem writer for project-local ccflow config.
 * Business modules build the next config object; this module owns path resolution,
 * idempotent JSON formatting, directory creation, and disk writes.
 */
import { promises as fs } from 'fs';
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

export function getProjectLocalConfigPath(projectPath = '') {
  /**
   * Resolve the project-local config path, or the global config path when no
   * project path is supplied.
   */
  return projectPath
    ? path.join(path.resolve(projectPath), '.ccflow', 'conf.json')
    : path.join(os.homedir(), '.ccflow', 'conf.json');
}

export async function readProjectLocalConfig(projectPath = '') {
  /**
   * Read conf.json as a plain object. Missing config is treated as empty.
   */
  const { config } = await readProjectLocalConfigFile(projectPath);
  return config;
}

export async function readProjectLocalConfigFile(projectPath = '') {
  /**
   * Read conf.json with existence metadata for callers that migrate existing files.
   */
  const configPath = getProjectLocalConfigPath(projectPath);
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
