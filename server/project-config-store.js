/**
 * PURPOSE: Provide the single filesystem writer for project-local ccflow config.
 * Business modules build the next config object; this module owns path resolution,
 * idempotent JSON formatting, directory creation, and disk writes.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

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
  try {
    const rawConfig = await fs.readFile(getProjectLocalConfigPath(projectPath), 'utf8');
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
    throw error;
  }
}

export async function writeProjectLocalConfig(projectPath = '', config = {}) {
  /**
   * Write conf.json only when formatted content changed.
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

  await fs.writeFile(configPath, nextConfigData, 'utf8');
  return true;
}
