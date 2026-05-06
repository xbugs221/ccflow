/**
 * PROJECT DISCOVERY AND MANAGEMENT SYSTEM
 * ========================================
 * 
 * This module manages project discovery for Claude Code and Codex CLI sessions.
 * 
 * ## Architecture Overview
 * 
 * 1. **Claude Projects** (stored in ~/.claude/projects/)
 *    - Each project is a directory named with the project path encoded (/ replaced with -)
 *    - Contains .jsonl files with conversation history including 'cwd' field
 *    - Project metadata stored in ~/.ccflow/conf.json
 * 
 * ## Project Discovery Strategy
 * 
 * 1. **Claude Projects Discovery**:
 *    - Scan ~/.claude/projects/ directory for Claude project folders
 *    - Extract actual project path from .jsonl files (cwd field)
 *    - Fall back to decoded directory name if no sessions exist
 * 
 * 2. **Manual Project Addition**:
 *    - Users can manually add project paths via UI
 *    - Stored in ~/.ccflow/conf.json with 'manuallyAdded' flag
 * 
 * ## Error Handling
 * 
 * - Missing ~/.claude directory is handled gracefully with automatic creation
 * - ENOENT errors are caught and handled without crashing
 * - Empty arrays returned when no projects/sessions exist
 * 
 * ## Caching Strategy
 * 
 * - Project directory extraction is cached to minimize file I/O
 * - Cache is cleared when project configuration changes
 * - Session data is fetched on-demand, not cached
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import readline from 'readline';
import crypto from 'crypto';
import os from 'os';
import { getActiveClaudeSDKSessions } from './claude-sdk.js';
import { getActiveCodexSessions } from './openai-codex.js';
import { getCodexSessionTokenUsageFromFile } from './session-token-usage.js';
import { listProjectWorkflows, registerWorkflowChildSession } from './workflows.js';
import {
  getProjectLocalConfigPath as resolveProjectLocalConfigPath,
  readProjectLocalConfig,
  readProjectLocalConfigFile,
  writeProjectLocalConfig,
} from './project-config-store.js';
import {
  normalizeCodexFunctionCall,
  normalizeCodexRealtimeItem,
  normalizeCodexToolOutput,
} from '../shared/codex-message-normalizer.js';

// Import TaskMaster detection functions
async function detectTaskMasterFolder(projectPath) {
  try {
    const taskMasterPath = path.join(projectPath, '.taskmaster');

    // Check if .taskmaster directory exists
    try {
      const stats = await fs.stat(taskMasterPath);
      if (!stats.isDirectory()) {
        return {
          hasTaskmaster: false,
          reason: '.taskmaster exists but is not a directory'
        };
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          hasTaskmaster: false,
          reason: '.taskmaster directory not found'
        };
      }
      throw error;
    }

    // Check for key TaskMaster files
    const keyFiles = [
      'tasks/tasks.json',
      'config.json'
    ];

    const fileStatus = {};
    let hasEssentialFiles = true;

    for (const file of keyFiles) {
      const filePath = path.join(taskMasterPath, file);
      try {
        await fs.access(filePath);
        fileStatus[file] = true;
      } catch (error) {
        fileStatus[file] = false;
        if (file === 'tasks/tasks.json') {
          hasEssentialFiles = false;
        }
      }
    }

    // Parse tasks.json if it exists for metadata
    let taskMetadata = null;
    if (fileStatus['tasks/tasks.json']) {
      try {
        const tasksPath = path.join(taskMasterPath, 'tasks/tasks.json');
        const tasksContent = await fs.readFile(tasksPath, 'utf8');
        const tasksData = JSON.parse(tasksContent);

        // Handle both tagged and legacy formats
        let tasks = [];
        if (tasksData.tasks) {
          // Legacy format
          tasks = tasksData.tasks;
        } else {
          // Tagged format - get tasks from all tags
          Object.values(tasksData).forEach(tagData => {
            if (tagData.tasks) {
              tasks = tasks.concat(tagData.tasks);
            }
          });
        }

        // Calculate task statistics
        const stats = tasks.reduce((acc, task) => {
          acc.total++;
          acc[task.status] = (acc[task.status] || 0) + 1;

          // Count subtasks
          if (task.subtasks) {
            task.subtasks.forEach(subtask => {
              acc.subtotalTasks++;
              acc.subtasks = acc.subtasks || {};
              acc.subtasks[subtask.status] = (acc.subtasks[subtask.status] || 0) + 1;
            });
          }

          return acc;
        }, {
          total: 0,
          subtotalTasks: 0,
          pending: 0,
          'in-progress': 0,
          done: 0,
          review: 0,
          deferred: 0,
          cancelled: 0,
          subtasks: {}
        });

        taskMetadata = {
          taskCount: stats.total,
          subtaskCount: stats.subtotalTasks,
          completed: stats.done || 0,
          pending: stats.pending || 0,
          inProgress: stats['in-progress'] || 0,
          review: stats.review || 0,
          completionPercentage: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
          lastModified: (await fs.stat(tasksPath)).mtime.toISOString()
        };
      } catch (parseError) {
        console.warn('Failed to parse tasks.json:', parseError.message);
        taskMetadata = { error: 'Failed to parse tasks.json' };
      }
    }

    return {
      hasTaskmaster: true,
      hasEssentialFiles,
      files: fileStatus,
      metadata: taskMetadata,
      path: taskMasterPath
    };

  } catch (error) {
    console.error('Error detecting TaskMaster folder:', error);
    return {
      hasTaskmaster: false,
      reason: `Error checking directory: ${error.message}`
    };
  }
}

// Cache for extracted project directories
const projectDirectoryCache = new Map();
const PROJECT_ARCHIVE_FILE_NAME = 'project-archive.json';
const PROJECT_ARCHIVE_VERSION = 1;
const PROJECT_DISPLAY_NAME_BY_PATH_KEY = 'displayNameByPath';
const MANUAL_SESSION_DRAFTS_KEY = 'manualSessionDrafts';
const SESSION_SUMMARY_BY_ID_KEY = 'sessionSummaryById';
const LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY = 'sessionSummaryOverrideById';
const LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY = 'codexSessionSummaryById';
const SESSION_WORKFLOW_METADATA_BY_ID_KEY = 'sessionWorkflowMetadataById';
const SESSION_UI_STATE_BY_PATH_KEY = 'sessionUiStateByPath';
const SESSION_MODEL_STATE_BY_ID_KEY = 'sessionModelStateById';
const SESSION_ROUTE_INDEX_KEY = 'sessionRouteIndex';
const LEGACY_SESSION_ROUTE_INDEX_BY_PATH_KEY = 'sessionRouteIndexByPath';
const MANUAL_SESSION_ROUTE_COUNTER_KEY = 'manualSessionRouteCounter';
const LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY = 'manualSessionRouteCounterByPath';
const PROJECT_CONFIG_SCHEMA_VERSION = 2;
const sessionPathExistenceCache = new Map();
const codexSessionFileCache = new Map();
let codexSessionsIndexCache = null;
let codexSessionsIndexPromise = null;
let projectsSnapshotCache = null;
let projectsSnapshotPromise = null;
const SESSION_PATH_CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(process.env.SESSION_PATH_CACHE_TTL_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 60 * 1000;
})();
const CODEX_INDEX_CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(process.env.CODEX_INDEX_CACHE_TTL_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 1000;
})();
const PROJECTS_CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(process.env.PROJECTS_CACHE_TTL_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 1000;
})();
const PROJECT_OVERVIEW_SESSION_LIMIT = Number.MAX_SAFE_INTEGER;

// Clear cache when needed (called when project files change)
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
  projectsSnapshotCache = null;
  projectsSnapshotPromise = null;
  codexSessionsIndexCache = null;
  codexSessionsIndexPromise = null;
  codexSessionFileCache.clear();
}

function clearSessionPathExistenceCache() {
  sessionPathExistenceCache.clear();
}

/**
 * Read only the tail window needed for paginated JSONL session rendering.
 * Scans the file from the end so the common "show latest messages" path
 * avoids parsing the whole file when only the last page is needed.
 * @param {string} filePath - Session JSONL path.
 * @param {number} limit - Number of entries to return.
 * @param {number} offset - Number of newest entries to skip.
 * @returns {Promise<{ lines: string[], total: number }>} Selected raw JSONL lines and total non-empty line count.
 */
async function readJsonlTailWindow(filePath, limit, offset = 0) {
  const chunkSize = 64 * 1024;
  const desiredCount = Math.max(0, limit + offset);
  const fileHandle = await fs.open(filePath, 'r');

  try {
    const { size } = await fileHandle.stat();
    if (size === 0) {
      return { lines: [], total: 0 };
    }

    let position = size;
    let remainder = '';
    let total = 0;
    const newestFirstLines = [];

    /**
     * Count a logical JSONL line and keep it if it falls inside the requested tail window.
     * @param {string} line - Raw JSONL line content.
     */
    const recordLine = (line) => {
      if (!line || !line.trim()) {
        return;
      }

      total += 1;
      if (newestFirstLines.length < desiredCount) {
        newestFirstLines.push({
          line,
          reverseIndex: total - 1,
        });
      }
    };

    while (position > 0) {
      const start = Math.max(0, position - chunkSize);
      const length = position - start;
      const buffer = Buffer.alloc(length);

      await fileHandle.read(buffer, 0, length, start);

      const combined = buffer.toString('utf8') + remainder;
      const parts = combined.split('\n');
      remainder = parts.shift() || '';

      for (let index = parts.length - 1; index >= 0; index -= 1) {
        recordLine(parts[index]);
      }

      position = start;
    }

    recordLine(remainder);

    const newestWindow = newestFirstLines
      .slice(offset, offset + limit)
      .map((entry) => ({
        line: entry.line,
        lineNumber: total - entry.reverseIndex,
      }));
    return {
      lines: newestWindow.reverse(),
      total,
    };
  } finally {
    await fileHandle.close();
  }
}

/**
 * Read all JSONL lines after a known line count, for incremental append.
 * The caller already has the first `afterLine` lines; this returns only new ones.
 * @param {string} filePath - Session JSONL path.
 * @param {number} afterLine - Number of lines the caller already has.
 * @returns {Promise<{ lines: string[], total: number }>} New lines and current total.
 */
async function readJsonlAfterLine(filePath, afterLine) {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const { size } = await fileHandle.stat();
    if (size === 0) {
      return { lines: [], total: 0 };
    }

    const content = await fileHandle.readFile('utf8');
    const allLines = content
      .split('\n')
      .filter(line => line.trim())
      .map((line, index) => ({
        line,
        lineNumber: index + 1,
      }));
    const total = allLines.length;
    const newLines = allLines.slice(afterLine);
    return { lines: newLines, total };
  } finally {
    await fileHandle.close();
  }
}

/**
 * Build a stable Claude message key from session line coordinates.
 * @param {string} sessionId
 * @param {number} lineNumber
 * @param {number} [subIndex]
 * @returns {string}
 */
function buildClaudeMessageKey(sessionId, lineNumber, subIndex = 0) {
  const baseKey = `claude:${sessionId}:line:${lineNumber}`;
  return subIndex > 0 ? `${baseKey}:msg:${subIndex}` : baseKey;
}

/**
 * Build a stable Codex message key from session line coordinates.
 * @param {string} sessionId
 * @param {number} lineNumber
 * @param {number} [subIndex]
 * @returns {string}
 */
function buildCodexMessageKey(sessionId, lineNumber, subIndex = 0) {
  return `codex:${sessionId}:line:${lineNumber}:msg:${subIndex}`;
}

/**
 * Encode an absolute project path into the Claude-style project directory name.
 * @param {string} projectPath
 * @returns {string}
 */
function encodeProjectPathAsName(projectPath) {
  return String(projectPath || '').replace(/\//g, '-');
}

/**
 * Normalize arbitrary transcript content into searchable plain text.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSearchableText(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSearchableText(item?.text ?? item?.content ?? item))
      .filter(Boolean)
      .join('\n');
  }

  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') {
      return value.text;
    }
    if (typeof value.content === 'string') {
      return value.content;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return value == null ? '' : String(value);
}

/**
 * Build a short snippet around the first keyword hit.
 * @param {string} text
 * @param {string} query
 * @returns {string}
 */
function buildSearchSnippet(text, query) {
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalizedText) {
    return '';
  }

  const lowerText = normalizedText.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const hitIndex = lowerText.indexOf(lowerQuery);
  if (hitIndex < 0) {
    return normalizedText.slice(0, 160);
  }

  const start = Math.max(0, hitIndex - 48);
  const end = Math.min(normalizedText.length, hitIndex + query.length + 72);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedText.length ? '...' : '';
  return `${prefix}${normalizedText.slice(start, end)}${suffix}`;
}

/**
 * Return true when transcript text contains the case-insensitive query.
 * @param {string} text
 * @param {string} query
 * @returns {boolean}
 */
function matchesSearchQuery(text, query) {
  if (!text || !query) {
    return false;
  }

  return text.toLowerCase().includes(query.toLowerCase());
}

/**
 * Derive the Codex resume thread from a JSONL file name.
 * @param {string} filePath - Codex JSONL path or basename.
 * @returns {{ thread: string, sessionFileName: string }} Resume thread and display filename.
 */
function deriveCodexThreadFromJsonlPath(filePath) {
  const sessionFileName = path.basename(String(filePath || ''));
  const rolloutMatch = sessionFileName.match(
    /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/,
  );
  const fallbackThread = sessionFileName.endsWith('.jsonl')
    ? sessionFileName.slice(0, -'.jsonl'.length)
    : sessionFileName;

  return {
    thread: rolloutMatch?.[1] || fallbackThread,
    sessionFileName,
  };
}

/**
 * Resolve a Codex session ID to its on-disk JSONL path with memoization.
 * @param {string} sessionId - Codex session identifier.
 * @returns {Promise<string | null>} Matching JSONL path if found.
 */
async function findCodexSessionFilePath(sessionId) {
  const cachedPath = codexSessionFileCache.get(sessionId);
  if (cachedPath) {
    try {
      await fs.access(cachedPath);
      return cachedPath;
    } catch {
      codexSessionFileCache.delete(sessionId);
    }
  }

  const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');

  /**
   * Walk the Codex sessions tree until a matching session file is found.
   * @param {string} dir - Directory to inspect.
   * @returns {Promise<string | null>} Found session file path.
   */
  const walk = async (dir) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = await walk(fullPath);
          if (found) {
            return found;
          }
        } else if (entry.name.includes(sessionId) && entry.name.endsWith('.jsonl')) {
          return fullPath;
        }
      }
    } catch {
      // Ignore unreadable directories and continue searching other branches.
    }

    return null;
  };

  const resolvedPath = await walk(codexSessionsDir);
  if (resolvedPath) {
    codexSessionFileCache.set(sessionId, resolvedPath);
  }

  return resolvedPath;
}

/**
 * Recursively list all Codex session JSONL files.
 * @param {string} [rootDir]
 * @returns {Promise<string[]>}
 */
async function listCodexSessionFiles(rootDir = path.join(os.homedir(), '.codex', 'sessions')) {
  const discoveredFiles = [];

  /**
   * Walk one directory and collect JSONL files.
   * @param {string} dir
   * @returns {Promise<void>}
   */
  const walk = async (dir) => {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        discoveredFiles.push(fullPath);
      }
    }
  };

  await walk(rootDir);
  return discoveredFiles;
}

/**
 * Iterate JSONL lines from file end to file start, allowing callers to stop early.
 * @param {string} filePath - JSONL file path.
 * @param {(line: string) => (boolean | void | Promise<boolean | void>)} visitLine - Reverse-order visitor.
 * @returns {Promise<void>}
 */
async function walkJsonlLinesInReverse(filePath, visitLine) {
  const chunkSize = 64 * 1024;
  const fileHandle = await fs.open(filePath, 'r');

  try {
    const { size } = await fileHandle.stat();
    if (size === 0) {
      return;
    }

    let position = size;
    let remainder = '';

    const emitLine = async (line) => {
      if (!line || !line.trim()) {
        return true;
      }

      const shouldContinue = await visitLine(line);
      return shouldContinue !== false;
    };

    while (position > 0) {
      const start = Math.max(0, position - chunkSize);
      const length = position - start;
      const buffer = Buffer.alloc(length);

      await fileHandle.read(buffer, 0, length, start);

      const combined = buffer.toString('utf8') + remainder;
      const parts = combined.split('\n');
      remainder = parts.shift() || '';

      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const shouldContinue = await emitLine(parts[index]);
        if (!shouldContinue) {
          return;
        }
      }

      position = start;
    }

    await emitLine(remainder);
  } finally {
    await fileHandle.close();
  }
}

/**
 * Create a stable synthetic project name for live-only sessions.
 * @param {string} projectPath - Absolute project path.
 * @param {Set<string>} usedProjectNames - Already reserved project names.
 * @param {string} provider - Session provider identifier.
 * @returns {string} Unique synthetic project name.
 */
function createLiveProjectName(projectPath, usedProjectNames, provider) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  let baseProjectName = projectPath.replace(/[\\/:\s~_]/g, '-');

  if (!baseProjectName) {
    baseProjectName = `${provider}-${crypto.createHash('md5').update(normalizedProjectPath || projectPath).digest('hex').slice(0, 12)}`;
  }

  let projectName = baseProjectName;
  if (usedProjectNames.has(projectName)) {
    const suffix = crypto.createHash('md5').update(normalizedProjectPath || projectPath).digest('hex').slice(0, 8);
    projectName = `${baseProjectName}-${provider}-${suffix}`;
  }

  while (usedProjectNames.has(projectName)) {
    projectName = `${projectName}-1`;
  }

  return projectName;
}

/**
 * Build a synthetic sidebar session from an active provider process.
 * @param {Object} session - Active session descriptor.
 * @param {'claude'|'codex'} provider - Session provider.
 * @returns {Object} Sidebar-compatible session object.
 */
function createSyntheticActiveSession(session, provider) {
  const startedAt = session.startedAt || new Date().toISOString();
  const summary = provider === 'codex' ? 'Active Codex session' : 'Active Claude Code session';

  return {
    id: session.id,
    summary,
    createdAt: startedAt,
    lastActivity: startedAt,
    updated_at: startedAt,
    messageCount: 0,
    projectPath: session.projectPath || '',
    status: 'active',
  };
}

/**
 * Merge live provider sessions into discovered projects so new sessions are visible before history files land.
 * @param {Object} params - Merge context.
 * @param {Array<object>} params.projects - Mutable project collection.
 * @param {Object} params.config - Project config index.
 * @param {Set<string>} params.usedProjectNames - Reserved project names.
 * @param {Set<string>} params.knownProjectPaths - Normalized project paths already in the project list.
 * @returns {Promise<void>}
 */
async function mergeActiveProviderSessionsIntoProjects({
  projects,
  config,
  usedProjectNames,
  knownProjectPaths,
}) {
  const activeProviderSessions = [
    ...getActiveClaudeSDKSessions().map((session) => ({ ...session, provider: 'claude' })),
    ...getActiveCodexSessions().map((session) => ({ ...session, provider: 'codex' })),
  ];

  for (const session of activeProviderSessions) {
    const normalizedProjectPath = normalizeComparablePath(session.projectPath);
    if (!session.id || !normalizedProjectPath) {
      continue;
    }
    const sessionProjectConfig = await loadProjectConfig(session.projectPath);
    const sessionWorkflowMetadata = getSessionWorkflowMetadataMap(sessionProjectConfig);
    if (sessionWorkflowMetadata[session.id]?.workflowId) {
      continue;
    }

    let project = projects.find(
      (candidate) => normalizeComparablePath(candidate.fullPath || candidate.path) === normalizedProjectPath,
    );

    if (!project) {
      const projectPath = session.projectPath;
      const projectName = createLiveProjectName(projectPath, usedProjectNames, session.provider);
      const autoDisplayName = await generateDisplayName(projectName, projectPath);
      const resolvedDisplayName = resolveProjectDisplayName(
        config,
        projectName,
        projectPath,
        autoDisplayName,
      );

      project = {
        name: projectName,
        path: projectPath,
        routePath: buildProjectRoutePath(projectPath),
        displayName: resolvedDisplayName.displayName,
        fullPath: projectPath,
        isCustomName: resolvedDisplayName.isCustomName,
        sessions: [],
        codexSessions: [],
        sessionMeta: {
          hasMore: false,
          total: 0,
        },
      };

      projects.push(project);
      usedProjectNames.add(projectName);
      knownProjectPaths.add(normalizedProjectPath);
    }

    const targetKey = session.provider === 'codex' ? 'codexSessions' : 'sessions';
    const targetSessions = Array.isArray(project[targetKey]) ? project[targetKey] : [];
    if (targetSessions.some((existingSession) => existingSession.id === session.id)) {
      continue;
    }

    project[targetKey] = [createSyntheticActiveSession(session, session.provider), ...targetSessions];

    if (session.provider === 'claude') {
      const currentTotal = Number(project.sessionMeta?.total || 0);
      project.sessionMeta = {
        ...project.sessionMeta,
        total: currentTotal + 1,
      };
    }
  }
}

function resolveSessionProjectPath(session, fallbackProjectPath = '') {
  if (session?.cwd && typeof session.cwd === 'string' && session.cwd.trim()) {
    return session.cwd.trim();
  }

  if (session?.projectPath && typeof session.projectPath === 'string' && session.projectPath.trim()) {
    return session.projectPath.trim();
  }

  if (typeof fallbackProjectPath === 'string' && fallbackProjectPath.trim()) {
    return fallbackProjectPath.trim();
  }

  return '';
}

async function projectPathExists(projectPath, options = {}) {
  const { forceRefresh = false } = options;
  const normalizedPath = normalizeComparablePath(projectPath);
  if (!normalizedPath) {
    return false;
  }

  const now = Date.now();
  const cached = sessionPathExistenceCache.get(normalizedPath);
  if (
    !forceRefresh &&
    cached &&
    now - cached.checkedAt < SESSION_PATH_CACHE_TTL_MS
  ) {
    return cached.exists;
  }

  let exists = false;
  try {
    await fs.access(normalizedPath);
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[SessionVisibility] Failed to check project path: ${normalizedPath}`, error.message);
    }
  }

  sessionPathExistenceCache.set(normalizedPath, {
    exists,
    checkedAt: now
  });

  return exists;
}

async function annotateSessionVisibility(session, fallbackProjectPath = '') {
  const sessionProjectPath = resolveSessionProjectPath(session, fallbackProjectPath);
  if (!sessionProjectPath) {
    return {
      ...session,
      projectPath: fallbackProjectPath || session.projectPath || '',
      projectPathExists: true
    };
  }

  const exists = await projectPathExists(sessionProjectPath);
  if (exists) {
    return {
      ...session,
      projectPath: sessionProjectPath,
      projectPathExists: true
    };
  }

  return {
    ...session,
    status: session.status === 'hidden' ? 'hidden' : 'archived',
    archived: true,
    hidden: true,
    visibilityReason: 'missing_project_path',
    projectPath: sessionProjectPath,
    projectPathExists: false
  };
}

async function annotateSessionCollectionVisibility(sessions, fallbackProjectPath = '') {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return [];
  }

  return Promise.all(
    sessions.map((session) => annotateSessionVisibility(session, fallbackProjectPath))
  );
}

function isSessionVisibleByDefault(session) {
  return !(
    session?.hidden === true ||
    session?.archived === true ||
    session?.status === 'archived' ||
    session?.status === 'hidden'
  );
}

function filterHiddenArchivedSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return [];
  }

  return sessions.filter(isSessionVisibleByDefault);
}

function getProjectLocalConfigPath(projectPath) {
  return resolveProjectLocalConfigPath(projectPath);
}

// Load project configuration file
async function loadProjectConfig(projectPath = '') {
  try {
    const { config: parsedConfig, exists } = await readProjectLocalConfigFile(projectPath);
    if (!exists) {
      return {};
    }
    const normalizedConfig = normalizeProjectConfigForRead(parsedConfig, projectPath);
    await writeProjectLocalConfig(projectPath, normalizedConfig);
    return normalizedConfig;
  } catch (error) {
    // Return empty config if file doesn't exist
    return {};
  }
}

/**
 * PURPOSE: Read project-local config into the v2 chat/workflows shape while
 * accepting legacy session maps as migration input.
 */
function normalizeProjectConfigForRead(config, projectPath = '') {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }
  return normalizeProjectConfigForSave(config, projectPath);
}

/**
 * PURPOSE: Build a conf.json v2 chat record from scattered legacy session state.
 */
function buildProjectChatRecord(sessionId, title, modelState = {}, uiState = {}, metadata = {}) {
  const record = { sessionId };
  if (typeof title === 'string' && title.trim()) {
    record.title = title.trim();
  }
  if (typeof metadata.provider === 'string' && metadata.provider.trim()) {
    record.provider = metadata.provider.trim();
  }
  if (typeof metadata.stageKey === 'string' && metadata.stageKey.trim()) {
    record.stageKey = metadata.stageKey.trim();
  }
  if (typeof metadata.workflowId === 'string' && metadata.workflowId.trim()) {
    record.workflowId = metadata.workflowId.trim();
  }
  if (typeof metadata.summary === 'string' && metadata.summary.trim()) {
    record.summary = metadata.summary.trim();
  }
  if (record.summary && record.summary === record.title) {
    delete record.summary;
  }
  if (typeof metadata.startRequestId === 'string' && metadata.startRequestId.trim()) {
    record.startRequestId = metadata.startRequestId.trim();
  }
  if (typeof metadata.pendingProviderSessionId === 'string' && metadata.pendingProviderSessionId.trim()) {
    record.pendingProviderSessionId = metadata.pendingProviderSessionId.trim();
  }
  if (metadata.cancelRequested === true) {
    record.cancelRequested = true;
  }
  if (typeof modelState.model === 'string' && modelState.model.trim()) {
    record.model = modelState.model.trim();
  }
  if (typeof modelState.reasoningEffort === 'string' && modelState.reasoningEffort.trim()) {
    record.reasoningEffort = modelState.reasoningEffort.trim();
  }
  if (typeof modelState.thinkingMode === 'string' && modelState.thinkingMode.trim()) {
    record.thinkingMode = modelState.thinkingMode.trim();
  }
  if (uiState && typeof uiState === 'object' && !Array.isArray(uiState) && Object.keys(uiState).length > 0) {
    record.ui = { ...uiState };
  }
  return record;
}

/**
 * PURPOSE: Remove empty UI state and duplicate session rows from one route bucket.
 */
function normalizeProjectChatBucket(chat = {}) {
  const seenSessionIds = new Set();
  return Object.entries(chat && typeof chat === 'object' && !Array.isArray(chat) ? chat : {})
    .reduce((bucket, [routeIndex, record]) => {
      const sessionId = typeof record?.sessionId === 'string' ? record.sessionId.trim() : '';
      if (!sessionId || seenSessionIds.has(sessionId)) {
        return bucket;
      }
      seenSessionIds.add(sessionId);
      const nextRecord = {
        ...(record && typeof record === 'object' && !Array.isArray(record) ? record : {}),
        sessionId,
      };
      if (nextRecord.ui && typeof nextRecord.ui === 'object' && !Array.isArray(nextRecord.ui) && Object.keys(nextRecord.ui).length === 0) {
        delete nextRecord.ui;
      }
      if (nextRecord.summary && nextRecord.summary === nextRecord.title) {
        delete nextRecord.summary;
      }
      bucket[routeIndex] = nextRecord;
      return bucket;
    }, {});
}

/**
 * PURPOSE: Allocate the next route number within one workflow-local chat bucket.
 */
function getNextWorkflowChatRouteIndex(workflow = {}) {
  return Object.keys(workflow?.chat || {}).reduce((maxValue, key) => {
    const parsed = Number(key);
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, 0) + 1;
}

/**
 * PURPOSE: Keep persisted session UI flags limited to meaningful true values.
 */
function normalizeSessionUiState(rawState = {}) {
  const state = {};
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    return state;
  }
  if (rawState.favorite === true) {
    state.favorite = true;
  }
  if (rawState.pending === true) {
    state.pending = true;
  }
  if (rawState.hidden === true) {
    state.hidden = true;
  }
  return state;
}

/**
 * PURPOSE: Resolve the provider stored on a v2 chat record.
 */
function normalizeProjectChatProvider(provider) {
  return provider === 'claude' ? 'claude' : 'codex';
}

/**
 * PURPOSE: Decode legacy UI-state map keys into provider/path/session parts.
 */
function parseSessionUiStateKey(stateKey) {
  const [provider, ...rest] = String(stateKey || '').split(':');
  const sessionId = rest.pop();
  const projectPath = rest.join(':');
  if (!provider || !projectPath || !sessionId) {
    return null;
  }
  return {
    provider: normalizeProjectChatProvider(provider),
    projectPath,
    sessionId,
  };
}

/**
 * PURPOSE: Find the v2 chat record for one provider session.
 */
function findProjectChatRecord(config, sessionId, provider = null) {
  const providerMatches = (record) => {
    if (!provider) {
      return true;
    }
    return !record?.provider || normalizeProjectChatProvider(record.provider) === provider;
  };

  for (const [routeIndex, record] of Object.entries(config?.chat || {})) {
    if (record?.sessionId === sessionId && providerMatches(record)) {
      return { scope: 'chat', routeIndex, record };
    }
  }
  for (const [workflowIndex, workflow] of Object.entries(config?.workflows || {})) {
    for (const [routeIndex, record] of Object.entries(workflow?.chat || {})) {
      if (record?.sessionId === sessionId && providerMatches(record)) {
        return { scope: 'workflow', workflowIndex, routeIndex, record };
      }
    }
  }
  return null;
}

/**
 * PURPOSE: Write one normalized UI state onto a located v2 chat record.
 */
function writeProjectChatRecordUiState(record, provider, uiState) {
  const nextState = normalizeSessionUiState(uiState);
  if (provider) {
    record.provider = provider;
  }
  if (Object.keys(nextState).length === 0) {
    delete record.ui;
    return;
  }
  record.ui = nextState;
}

/**
 * PURPOSE: Migrate legacy sessionUiStateByPath entries into v2 chat records before saving.
 */
function mergeLegacySessionUiStateIntoProjectChat(config, normalizedConfig, projectPath = '') {
  const legacyMap = config?.[SESSION_UI_STATE_BY_PATH_KEY];
  if (!legacyMap || typeof legacyMap !== 'object' || Array.isArray(legacyMap)) {
    return;
  }

  const normalizedProjectPath = normalizeComparablePath(projectPath);
  Object.entries(legacyMap).forEach(([stateKey, rawState]) => {
    const parsedKey = parseSessionUiStateKey(stateKey);
    if (!parsedKey || parsedKey.projectPath !== normalizedProjectPath) {
      return;
    }

    const location = findProjectChatRecord(normalizedConfig, parsedKey.sessionId, parsedKey.provider);
    if (!location) {
      return;
    }

    writeProjectChatRecordUiState(location.record, parsedKey.provider, {
      ...normalizeSessionUiState(rawState),
      ...normalizeSessionUiState(location.record.ui),
    });
  });
}

/**
 * PURPOSE: Return the numeric workflow config key derived from wN style ids.
 */
function getWorkflowConfigIndex(config, workflowId) {
  const matched = String(workflowId || '').match(/^w(\d+)$/);
  if (matched) {
    return matched[1];
  }
  const maxIndex = Object.keys(config.workflows || {}).reduce((maxValue, key) => {
    const parsed = Number(key);
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, 0);
  return String(maxIndex + 1);
}

const PROJECT_WORKFLOW_STAGE_KEYS = [
  'planning',
  'execution',
  'review_1',
  'repair_1',
  'review_2',
  'repair_2',
  'review_3',
  'repair_3',
  'archive',
];

function normalizeProjectWorkflowStageKey(stageKey) {
  /**
   * PURPOSE: Keep project config workflow stage keys aligned with workflow store
   * routing without importing workflow internals into this config module.
   */
  if (stageKey === 'ready_for_acceptance') return 'archive';
  if (stageKey === 'verification') return 'review_1';
  const normalizedStageKey = String(stageKey || '').trim();
  return PROJECT_WORKFLOW_STAGE_KEYS.includes(normalizedStageKey) ? normalizedStageKey : '';
}

function normalizeProjectWorkflowProvider(provider) {
  /**
   * PURPOSE: Persist only supported workflow provider engines.
   */
  return provider === 'claude' ? 'claude' : 'codex';
}

function normalizeProjectWorkflowProviderMap(providerMap = {}) {
  /**
   * PURPOSE: Convert provider maps into canonical stage keys and omit codex
   * defaults from persisted config.
   */
  if (!providerMap || typeof providerMap !== 'object' || Array.isArray(providerMap)) {
    return {};
  }
  return Object.entries(providerMap).reduce((providers, [stageKey, provider]) => {
    const normalizedStageKey = normalizeProjectWorkflowStageKey(stageKey);
    const normalizedProvider = normalizeProjectWorkflowProvider(provider);
    if (normalizedStageKey && normalizedProvider !== 'codex') {
      providers[normalizedStageKey] = normalizedProvider;
    }
    return providers;
  }, {});
}

function buildProjectWorkflowProviderMap(workflow = {}) {
  /**
   * PURPOSE: Migrate old provider locations into the compact providers map.
   */
  const providers = {
    ...normalizeProjectWorkflowProviderMap(workflow.providers),
    ...normalizeProjectWorkflowProviderMap(workflow.stageProviders),
  };
  if (Array.isArray(workflow.stageStatuses)) {
    workflow.stageStatuses.forEach((stage) => {
      const stageKey = normalizeProjectWorkflowStageKey(stage?.key);
      const provider = normalizeProjectWorkflowProvider(stage?.provider);
      if (stageKey && provider !== 'codex') {
        providers[stageKey] = provider;
      }
    });
  }
  return providers;
}

function buildProjectWorkflowDerivedStageState(stage = 'planning') {
  /**
   * PURPOSE: Derive linear stage progress from the current workflow stage.
   */
  const stageKey = normalizeProjectWorkflowStageKey(stage) || 'planning';
  const activeIndex = Math.max(PROJECT_WORKFLOW_STAGE_KEYS.indexOf(stageKey), 0);
  return Object.fromEntries(PROJECT_WORKFLOW_STAGE_KEYS.map((key, index) => [
    key,
    index < activeIndex ? 'completed' : (index === activeIndex ? 'active' : 'pending'),
  ]));
}

function buildProjectWorkflowStageState(workflow = {}) {
  /**
   * PURPOSE: Persist only stage status overrides that differ from the current
   * stage-derived state.
   */
  const derived = buildProjectWorkflowDerivedStageState(workflow.stage || 'planning');
  const state = {};
  if (workflow.stageState && typeof workflow.stageState === 'object' && !Array.isArray(workflow.stageState)) {
    Object.entries(workflow.stageState).forEach(([stageKey, status]) => {
      const normalizedStageKey = normalizeProjectWorkflowStageKey(stageKey);
      const normalizedStatus = String(status || '').trim();
      if (normalizedStageKey && normalizedStatus && normalizedStatus !== derived[normalizedStageKey]) {
        state[normalizedStageKey] = normalizedStatus;
      }
    });
  }
  if (Array.isArray(workflow.stageStatuses)) {
    workflow.stageStatuses.forEach((stage) => {
      const stageKey = normalizeProjectWorkflowStageKey(stage?.key);
      const status = String(stage?.status || '').trim();
      if (stageKey && status && status !== derived[stageKey]) {
        state[stageKey] = status;
      }
    });
  }
  return state;
}

function normalizeProjectWorkflowRecord(workflow = {}) {
  /**
   * PURPOSE: Keep conf.json workflow records canonical when generic project
   * config save paths touch workflow data.
   */
  const normalized = {
    ...(workflow && typeof workflow === 'object' && !Array.isArray(workflow) ? workflow : {}),
    chat: normalizeProjectChatBucket(workflow?.chat),
  };
  const providers = buildProjectWorkflowProviderMap(workflow);
  const stageState = buildProjectWorkflowStageState(workflow);
  delete normalized.id;
  delete normalized.routeIndex;
  delete normalized.legacyId;
  delete normalized.legacyWorkflowId;
  delete normalized.childSessions;
  delete normalized.stageProviders;
  delete normalized.stageStatuses;
  delete normalized.providers;
  delete normalized.stageState;
  delete normalized.openspecChangeDetected;
  delete normalized.openspecTaskProgress;
  if (normalized.openspecChangeName) {
    delete normalized.openspecChangePrefix;
  }
  if (Object.keys(providers).length > 0) {
    normalized.providers = providers;
  }
  if (Object.keys(stageState).length > 0) {
    normalized.stageState = stageState;
  }
  if (Object.keys(normalized.chat).length === 0) {
    delete normalized.chat;
  }
  return normalized;
}

/**
 * PURPOSE: Remove legacy session maps from v2 persisted config output.
 */
function normalizeProjectConfigForSave(config, projectPath = '') {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }

  const normalized = Object.fromEntries(Object.entries(config).filter(([key]) => ![
    MANUAL_SESSION_DRAFTS_KEY,
    SESSION_SUMMARY_BY_ID_KEY,
    LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY,
    LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY,
    SESSION_UI_STATE_BY_PATH_KEY,
    SESSION_MODEL_STATE_BY_ID_KEY,
    SESSION_ROUTE_INDEX_KEY,
    LEGACY_SESSION_ROUTE_INDEX_BY_PATH_KEY,
    MANUAL_SESSION_ROUTE_COUNTER_KEY,
    LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY,
  ].includes(key)));
  normalized.schemaVersion = PROJECT_CONFIG_SCHEMA_VERSION;
  normalized.chat = normalizeProjectChatBucket(config.chat);
  normalized.workflows = Object.entries(config.workflows && typeof config.workflows === 'object' && !Array.isArray(config.workflows)
    ? config.workflows
    : {}).reduce((workflows, [workflowIndex, workflow]) => {
    workflows[workflowIndex] = normalizeProjectWorkflowRecord(workflow);
    return workflows;
  }, {});
  mergeLegacySessionUiStateIntoProjectChat(config, normalized, projectPath);

  delete normalized[LEGACY_SESSION_ROUTE_INDEX_BY_PATH_KEY];

  const summaryById = getSessionSummaryOverrideMap(config);
  if (Object.keys(summaryById).length > 0) {
    normalized[SESSION_SUMMARY_BY_ID_KEY] = summaryById;
  } else {
    delete normalized[SESSION_SUMMARY_BY_ID_KEY];
  }
  delete normalized[LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY];
  delete normalized[LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY];

  const routeCounter = getManualSessionRouteCounter(normalized, projectPath);
  if (routeCounter > 0) {
    normalized[MANUAL_SESSION_ROUTE_COUNTER_KEY] = routeCounter;
  }
  delete normalized[LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY];

  const workflowMetadataById = getSessionWorkflowMetadataMap(config);
  if (Object.keys(workflowMetadataById).length > 0) {
    normalized[SESSION_WORKFLOW_METADATA_BY_ID_KEY] = workflowMetadataById;
  }
  const modelStateById = getSessionModelStateMap(config);
  const uiStateByPath = getSessionUiStateMap(config, projectPath);
  const uiStateBySessionId = Object.entries(uiStateByPath).reduce((stateById, [key, state]) => {
    const sessionId = String(key).split(':').pop();
    if (sessionId && state && typeof state === 'object' && !Array.isArray(state)) {
      stateById[sessionId] = state;
    }
    return stateById;
  }, {});

  Object.entries(getManualSessionDraftMap(config)).forEach(([draftId, draft]) => {
    const routeIndex = isWorkflowOwnedDraft(draft)
      ? (Number(draft?.routeIndex) || parseManualSessionRouteIndex(draftId))
      : (parseManualSessionRouteIndex(draftId) || Number(draft?.routeIndex));
    if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
      return;
    }
    if (isWorkflowOwnedDraft(draft)) {
      const workflowIndex = getWorkflowConfigIndex(normalized, draft.workflowId);
      const workflow = {
        ...(normalized.workflows[workflowIndex] || {}),
        title: normalized.workflows[workflowIndex]?.title || `工作流${workflowIndex}`,
        chat: { ...(normalized.workflows[workflowIndex]?.chat || {}) },
      };
      const workflowRouteIndex = Object.values(workflow.chat).some((record) => record?.sessionId === draftId)
        ? Object.entries(workflow.chat).find(([, record]) => record?.sessionId === draftId)?.[0]
        : String(getNextWorkflowChatRouteIndex(workflow));
      workflow.chat[workflowRouteIndex] = buildProjectChatRecord(
        draftId,
        draft.label,
        modelStateById[draftId],
        uiStateBySessionId[draftId],
        draft,
      );
      normalized.workflows[workflowIndex] = workflow;
    } else {
      normalized.chat[String(routeIndex)] = buildProjectChatRecord(
        draftId,
        draft.label,
        modelStateById[draftId],
        uiStateBySessionId[draftId],
        draft,
      );
    }
  });

  const workflowOwnedSessionIds = new Set();
  Object.values(normalized.workflows || {}).forEach((workflow) => {
    Object.values(workflow?.chat || {}).forEach((record) => {
      if (record?.sessionId) {
        workflowOwnedSessionIds.add(record.sessionId);
      }
    });
  });
  Object.entries(normalized.chat || {}).forEach(([routeIndex, record]) => {
    const sessionId = String(record?.sessionId || '');
    if (!sessionId.startsWith('c') && workflowOwnedSessionIds.has(sessionId)) {
      delete normalized.chat[routeIndex];
    }
  });

  if (Object.keys(normalized.chat).length === 0) delete normalized.chat;
  if (Object.keys(normalized.workflows).length === 0) delete normalized.workflows;
  [
    MANUAL_SESSION_DRAFTS_KEY,
    SESSION_SUMMARY_BY_ID_KEY,
    LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY,
    LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY,
    SESSION_UI_STATE_BY_PATH_KEY,
    SESSION_MODEL_STATE_BY_ID_KEY,
    SESSION_ROUTE_INDEX_KEY,
    LEGACY_SESSION_ROUTE_INDEX_BY_PATH_KEY,
    MANUAL_SESSION_ROUTE_COUNTER_KEY,
    LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY,
  ].forEach((key) => {
    delete normalized[key];
  });

  return normalized;
}

/**
 * PURPOSE: Keep workflow control-plane records from being erased by generic
 * project config saves that only intended to update normal chat/session data.
 */
function mergeCurrentWorkflowConfig(currentConfig, nextConfig) {
  const currentWorkflows = currentConfig?.workflows && typeof currentConfig.workflows === 'object' && !Array.isArray(currentConfig.workflows)
    ? currentConfig.workflows
    : {};
  if (Object.keys(currentWorkflows).length === 0) {
    return nextConfig;
  }

  const nextWorkflows = nextConfig.workflows && typeof nextConfig.workflows === 'object' && !Array.isArray(nextConfig.workflows)
    ? nextConfig.workflows
    : {};
  const mergedWorkflows = { ...nextWorkflows };

  Object.entries(currentWorkflows).forEach(([workflowIndex, currentWorkflow]) => {
    const nextWorkflow = mergedWorkflows[workflowIndex];
    if (!nextWorkflow || typeof nextWorkflow !== 'object' || Array.isArray(nextWorkflow)) {
      mergedWorkflows[workflowIndex] = currentWorkflow;
      return;
    }

    if (!currentWorkflow || typeof currentWorkflow !== 'object' || Array.isArray(currentWorkflow)) {
      return;
    }

    const currentChat = currentWorkflow.chat && typeof currentWorkflow.chat === 'object' && !Array.isArray(currentWorkflow.chat)
      ? currentWorkflow.chat
      : {};
    const nextChat = nextWorkflow.chat && typeof nextWorkflow.chat === 'object' && !Array.isArray(nextWorkflow.chat)
      ? nextWorkflow.chat
      : {};
    mergedWorkflows[workflowIndex] = {
      ...nextWorkflow,
      ...currentWorkflow,
      chat: {
        ...currentChat,
        ...nextChat,
      },
    };
    if (Object.keys(mergedWorkflows[workflowIndex].chat).length === 0) {
      delete mergedWorkflows[workflowIndex].chat;
    }
  });

  if (Object.keys(mergedWorkflows).length > 0) {
    nextConfig.workflows = mergedWorkflows;
  }
  return nextConfig;
}

// Save project configuration file
async function saveProjectConfig(config, projectPath = '') {
  let nextConfig = normalizeProjectConfigForSave(config, projectPath);
  try {
    const currentConfig = await readProjectLocalConfig(projectPath);
    nextConfig = mergeCurrentWorkflowConfig(currentConfig, nextConfig);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await writeProjectLocalConfig(projectPath, nextConfig);
}

/**
 * Return the normalized "display name by path" map from project config.
 */
function getDisplayNameByPathMap(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }

  const rawMap = config[PROJECT_DISPLAY_NAME_BY_PATH_KEY];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {};
  }

  return rawMap;
}

/**
 * Return the unified session summary map, including legacy split fields.
 */
function getSessionSummaryOverrideMap(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  if (config.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const summaryById = {};
    Object.values(config.chat || {}).forEach((record) => {
      if (record?.sessionId && record?.title) summaryById[record.sessionId] = record.title;
    });
    Object.values(config.workflows || {}).forEach((workflow) => {
      Object.values(workflow?.chat || {}).forEach((record) => {
        if (record?.sessionId && record?.title) summaryById[record.sessionId] = record.title;
      });
    });
    return summaryById;
  }

  return [
    config[LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY],
    config[LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY],
    config[SESSION_SUMMARY_BY_ID_KEY],
  ].reduce((summaryById, rawMap) => {
    if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
      return summaryById;
    }
    return {
      ...summaryById,
      ...normalizeSessionSummaryMapForRead(rawMap, config),
    };
  }, {});
}

/**
 * Persist a session summary in the unified local project map.
 */
function writeSessionSummaryOverride(config, sessionId, summary) {
  config[SESSION_SUMMARY_BY_ID_KEY] = {
    ...getSessionSummaryOverrideMap(config),
    [sessionId]: summary,
  };
  delete config[LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY];
  delete config[LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY];
}

/**
 * Check whether a config object key is a positive integer route number.
 */
function isPositiveRouteIndexKey(key) {
  const routeIndex = Number(key);
  return Number.isInteger(routeIndex) && routeIndex > 0 && String(routeIndex) === String(key);
}

/**
 * Convert persisted summary overrides to the runtime session-id keyed shape.
 */
function normalizeSessionSummaryMapForRead(rawMap, config) {
  return Object.entries(rawMap || {}).reduce((summaryById, [key, summary]) => {
    const sessionId = isPositiveRouteIndexKey(key)
      ? findSessionIdByRouteIndex(config, Number(key))
      : key;
    if (sessionId) {
      summaryById[sessionId] = summary;
    }
    return summaryById;
  }, {});
}

/**
 * Remove one summary override while accepting both compact and legacy persisted keys.
 */
function deleteSessionSummaryOverride(config, sessionId) {
  const summaryById = getSessionSummaryOverrideMap(config);
  if (!Object.prototype.hasOwnProperty.call(summaryById, sessionId)) {
    return false;
  }
  delete summaryById[sessionId];
  if (Object.keys(summaryById).length === 0) {
    delete config[SESSION_SUMMARY_BY_ID_KEY];
  } else {
    config[SESSION_SUMMARY_BY_ID_KEY] = summaryById;
  }
  delete config[LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY];
  delete config[LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY];
  return true;
}

/**
 * PURPOSE: Remove v2 project chat route records bound to a deleted backend session.
 */
function deleteProjectChatRecords(config, sessionId, provider = null) {
  let changed = false;

  const shouldDeleteRecord = (record) => {
    if (record?.sessionId !== sessionId) {
      return false;
    }
    return !provider || !record.provider || record.provider === provider;
  };

  Object.entries(config.chat || {}).forEach(([routeIndex, record]) => {
    if (shouldDeleteRecord(record)) {
      delete config.chat[routeIndex];
      changed = true;
    }
  });
  if (config.chat && Object.keys(config.chat).length === 0) {
    delete config.chat;
  }

  Object.values(config.workflows || {}).forEach((workflow) => {
    Object.entries(workflow?.chat || {}).forEach(([routeIndex, record]) => {
      if (shouldDeleteRecord(record)) {
        delete workflow.chat[routeIndex];
        changed = true;
      }
    });
    if (workflow?.chat && Object.keys(workflow.chat).length === 0) {
      delete workflow.chat;
    }
  });

  return changed;
}

/**
 * Return persisted workflow ownership metadata keyed by real provider session id.
 */
function getSessionWorkflowMetadataMap(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  if (config.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const storedMetadata = config[SESSION_WORKFLOW_METADATA_BY_ID_KEY] && typeof config[SESSION_WORKFLOW_METADATA_BY_ID_KEY] === 'object'
      ? config[SESSION_WORKFLOW_METADATA_BY_ID_KEY]
      : {};
    return Object.entries(config.workflows || {}).reduce((metadataById, [workflowIndex, workflow]) => {
      Object.values(workflow?.chat || {}).forEach((record) => {
        if (record?.sessionId) {
          if (!metadataById[record.sessionId]) {
            metadataById[record.sessionId] = {
              workflowId: typeof record.workflowId === 'string' && record.workflowId.trim()
                ? record.workflowId.trim()
                : `w${workflowIndex}`,
              provider: record.provider,
              stageKey: record.stageKey,
            };
          }
        }
      });
      return metadataById;
    }, { ...storedMetadata });
  }

  const rawMap = config[SESSION_WORKFLOW_METADATA_BY_ID_KEY];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {};
  }

  return rawMap;
}

/**
 * Return the normalized manual draft session map from project config.
 */
function getManualSessionDraftMap(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  if (config.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const drafts = {};
    Object.entries(config.chat || {}).forEach(([routeIndex, record]) => {
      if (parseManualSessionRouteIndex(record?.sessionId)) {
        drafts[record.sessionId] = {
          id: record.sessionId,
          provider: record.provider || 'codex',
          label: record.title,
          routeIndex: Number(routeIndex),
          startRequestId: record.startRequestId,
          pendingProviderSessionId: record.pendingProviderSessionId,
          cancelRequested: record.cancelRequested === true,
        };
      }
    });
    Object.entries(config.workflows || {}).forEach(([workflowIndex, workflow]) => {
      Object.entries(workflow?.chat || {}).forEach(([routeIndex, record]) => {
        if (parseManualSessionRouteIndex(record?.sessionId)) {
          drafts[record.sessionId] = {
            id: record.sessionId,
            provider: record.provider || 'codex',
            label: record.title,
            summary: record.summary,
            workflowId: typeof record.workflowId === 'string' && record.workflowId.trim()
              ? record.workflowId.trim()
              : `w${workflowIndex}`,
            routeIndex: Number(routeIndex),
            stageKey: record.stageKey,
            startRequestId: record.startRequestId,
            pendingProviderSessionId: record.pendingProviderSessionId,
            cancelRequested: record.cancelRequested === true,
          };
        }
      });
    });
    const rawMap = config[MANUAL_SESSION_DRAFTS_KEY];
    if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
      Object.entries(rawMap).forEach(([draftId, draft]) => {
        drafts[draftId] = {
          ...(draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {}),
          id: typeof draft?.id === 'string' && draft.id ? draft.id : draftId,
        };
      });
    }
    return drafts;
  }

  const rawMap = config[MANUAL_SESSION_DRAFTS_KEY];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {};
  }

  return Object.fromEntries(Object.entries(rawMap).map(([draftId, draft]) => [
    draftId,
    {
      ...(draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {}),
      id: typeof draft?.id === 'string' && draft.id ? draft.id : draftId,
    },
  ]));
}

/**
 * Parse the human-readable manual session id used in project routes.
 */
function parseManualSessionRouteIndex(sessionId) {
  const matched = String(sessionId || '').match(/^c(\d+)$/);
  if (!matched) {
    return null;
  }
  const parsed = Number(matched[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Return the canonical manual session id for a project-local route number.
 */
function buildManualSessionId(routeIndex) {
  return Number.isInteger(routeIndex) && routeIndex > 0 ? `c${routeIndex}` : null;
}

/**
 * Pick the visible label for a session without depending on provider history files.
 */
function applySessionSummaryOverride(session, summaryOverrideById) {
  if (!session || typeof session !== 'object') {
    return session;
  }

  const override = summaryOverrideById?.[session.id];
  if (typeof override !== 'string' || !override.trim()) {
    return session;
  }

  return {
    ...session,
    title: override,
    summary: override,
    name: override,
  };
}

/**
 * Attach workflow ownership metadata captured while finalizing a draft session.
 */
function applySessionWorkflowMetadata(session, workflowMetadataById, provider = '') {
  if (!session || typeof session !== 'object') {
    return session;
  }

  const metadata = workflowMetadataById?.[session.id];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return session;
  }
  const sessionProvider = String(provider || session.provider || '').trim();
  const metadataProvider = String(metadata.provider || '').trim();
  if (sessionProvider && metadataProvider && sessionProvider !== metadataProvider) {
    return session;
  }

  return {
    ...session,
    workflowId: typeof metadata.workflowId === 'string' ? metadata.workflowId : session.workflowId,
    stageKey: typeof metadata.stageKey === 'string' ? metadata.stageKey : session.stageKey,
  };
}

/**
 * Apply persisted UI-facing metadata to a provider session.
 */
function applySessionMetadataOverrides(session, summaryOverrideById, workflowMetadataById, provider = '') {
  return applySessionWorkflowMetadata(
    applySessionSummaryOverride(session, summaryOverrideById),
    workflowMetadataById,
    provider,
  );
}

/**
 * Convert one stored draft entry into the same shape as sidebar sessions.
 * Workflow-owned drafts keep their workflow metadata so read models can avoid
 * treating them as standalone manual sessions.
 */
function buildManualDraftSession(draft) {
  const label = typeof draft?.label === 'string' && draft.label.trim()
    ? draft.label.trim()
    : '新会话';
  const createdAt = draft?.createdAt || new Date().toISOString();
  const updatedAt = draft?.updatedAt || createdAt;

  return {
    id: draft.id,
    routeIndex: parseManualSessionRouteIndex(draft.id) || (Number.isInteger(draft?.routeIndex) ? draft.routeIndex : undefined),
    title: label,
    summary: label,
    name: label,
    createdAt,
    updated_at: updatedAt,
    lastActivity: updatedAt,
    messageCount: 0,
    projectPath: draft.projectPath || '',
    status: 'draft',
    providerSessionId: typeof draft?.pendingProviderSessionId === 'string' ? draft.pendingProviderSessionId : undefined,
    workflowId: typeof draft?.workflowId === 'string' ? draft.workflowId : undefined,
    stageKey: typeof draft?.stageKey === 'string' ? draft.stageKey : undefined,
  };
}

/**
 * Check whether a stored draft is owned by workflow orchestration.
 */
function isWorkflowOwnedDraft(draft) {
  return typeof draft?.workflowId === 'string' && draft.workflowId.trim();
}

/**
 * Check whether a provider session belongs to workflow orchestration.
 */
function isWorkflowOwnedSession(session, workflowMetadataById = {}) {
  if (typeof session?.workflowId === 'string' && session.workflowId.trim()) {
    return true;
  }

  const metadata = workflowMetadataById?.[session?.id];
  const sessionProvider = String(session?.provider || '').trim();
  const metadataProvider = String(metadata?.provider || '').trim();
  if (sessionProvider && metadataProvider && sessionProvider !== metadataProvider) {
    return false;
  }
  return typeof metadata?.workflowId === 'string' && metadata.workflowId.trim();
}

function getSessionDisplayText(session = {}) {
  /**
   * PURPOSE: Normalize provider-specific title fields so orphan workflow
   * sessions can be recognized before they leak into manual-session lists.
   */
  return String(session.title || session.summary || session.name || session.message || '').trim();
}

function buildWorkflowAutoSessionPrefixes(workflow = {}) {
  /**
   * PURPOSE: Mirror backend-owned workflow stage titles. These titles are the
   * only durable clue left when provider sessions are created but not indexed.
   */
  const workflowTitle = String(workflow.title || workflow.objective || '').trim();
  if (!workflowTitle) {
    return [];
  }
  return [
    `规划提案：${workflowTitle}`,
    `提案落地：${workflowTitle}`,
    `归档：${workflowTitle}`,
    ...[1, 2, 3].flatMap((passIndex) => [
      `评审${passIndex}：${workflowTitle}`,
      `修复${passIndex}：${workflowTitle}`,
    ]),
  ];
}

function isLikelyWorkflowAutoSession(session, workflows = [], provider = '') {
  /**
   * PURPOSE: Hide workflow-owned provider sessions that failed to persist their
   * workflow metadata. The workflow detail recovery path remains responsible for
   * re-attaching them when possible.
   */
  if (session?.workflowId || session?.stageKey) {
    return true;
  }

  const displayText = getSessionDisplayText(session);
  if (!displayText) {
    return false;
  }

  if (workflows.some((workflow) => (
    buildWorkflowAutoSessionPrefixes(workflow).some((prefix) => displayText.startsWith(prefix))
  ))) {
    return true;
  }

  return provider === 'claude'
    && workflows.length > 0
    && displayText.startsWith('执行 OpenSpec 变更中的任务');
}

/**
 * Build the set of route-bucket ids that must not consume project manual cN numbers.
 */
function getWorkflowOwnedRouteSessionIds(config) {
  const workflowOwnedIds = new Set();
  Object.entries(getSessionWorkflowMetadataMap(config)).forEach(([sessionId, metadata]) => {
    if (typeof metadata?.workflowId === 'string' && metadata.workflowId.trim()) {
      workflowOwnedIds.add(sessionId);
    }
  });
  Object.entries(getManualSessionDraftMap(config)).forEach(([sessionId, draft]) => {
    if (isWorkflowOwnedDraft(draft)) {
      workflowOwnedIds.add(sessionId);
    }
  });
  return workflowOwnedIds;
}

/**
 * Return manual drafts that belong to one project/provider collection.
 */
function getManualDraftSessionsForProject(config, { projectName, projectPath, provider }) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  const drafts = Object.values(getManualSessionDraftMap(config))
    .filter((draft) => {
      if (!draft || typeof draft !== 'object') {
        return false;
      }

      if (draft.provider !== provider) {
        return false;
      }

      if (isWorkflowOwnedDraft(draft)) {
        return false;
      }

      if (!draft.projectName && !draft.projectPath) {
        return true;
      }

      if (provider === 'claude') {
        return draft.projectName === projectName;
      }

      return normalizeComparablePath(draft.projectPath) === normalizedProjectPath;
    })
    .map((draft) => buildManualDraftSession(draft));

  return drafts.sort(
    (sessionA, sessionB) => new Date(sessionB.lastActivity || 0) - new Date(sessionA.lastActivity || 0),
  );
}

/**
 * Return the normalized persisted UI-state map for sessions.
 */
function getSessionUiStateMap(config, projectPath = '') {
  if (!config || typeof config !== 'object') {
    return {};
  }
  if (config.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const uiByPath = {};
    const addRecordState = (record) => {
      const uiState = normalizeSessionUiState(record?.ui);
      if (!record?.sessionId || Object.keys(uiState).length === 0) {
        return;
      }
      const providers = typeof record.provider === 'string' && record.provider.trim()
        ? [normalizeProjectChatProvider(record.provider)]
        : ['claude', 'codex'];
      providers.forEach((recordProvider) => {
        const stateKey = buildSessionUiStateKey(projectPath, recordProvider, record.sessionId);
        if (stateKey && !uiByPath[stateKey]) {
          uiByPath[stateKey] = uiState;
        }
      });
    };
    Object.values(config.chat || {}).forEach((record) => {
      addRecordState(record);
    });
    Object.values(config.workflows || {}).forEach((workflow) => {
      Object.values(workflow?.chat || {}).forEach((record) => {
        addRecordState(record);
      });
    });
    const rawMap = config[SESSION_UI_STATE_BY_PATH_KEY];
    if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
      Object.entries(rawMap).forEach(([stateKey, rawState]) => {
        if (!uiByPath[stateKey]) {
          const uiState = normalizeSessionUiState(rawState);
          if (Object.keys(uiState).length > 0) {
            uiByPath[stateKey] = uiState;
          }
        }
      });
    }
    return uiByPath;
  }

  const rawMap = config[SESSION_UI_STATE_BY_PATH_KEY];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {};
  }

  return rawMap;
}

/**
 * Build a stable config key for one provider session under one project path.
 */
function buildSessionUiStateKey(projectPath, provider, sessionId) {
  const normalizedPath = normalizeComparablePath(projectPath);
  if (!normalizedPath || !sessionId) {
    return null;
  }

  return `${provider}:${normalizedPath}:${sessionId}`;
}

/**
 * Attach persisted UI flags to a session payload.
 */
function applySessionUiState(session, projectPath, provider, config) {
  const sessionUiStateMap = getSessionUiStateMap(config, projectPath);
  const stateKey = buildSessionUiStateKey(projectPath, provider, session?.id);
  const persistedState = stateKey ? sessionUiStateMap[stateKey] : null;

  if (!persistedState || typeof persistedState !== 'object') {
    return session;
  }

  return {
    ...session,
    favorite: persistedState.favorite === true,
    pending: persistedState.pending === true,
    hidden: persistedState.hidden === true || session.hidden === true,
  };
}

/**
 * Build the canonical project route path from the filesystem path.
 */
function buildProjectRoutePath(projectPath) {
  /**
   * HOME itself has no relative segment, but it still needs a project-scoped
   * route prefix so child session routes never become bare `/cN` or `//cN`.
   */
  const normalizedPath = normalizeComparablePath(projectPath);
  if (!normalizedPath) {
    return '/';
  }

  const normalizedHome = normalizeComparablePath(os.homedir());
  if (normalizedHome && (normalizedPath === normalizedHome || normalizedPath.startsWith(`${normalizedHome}/`))) {
    const relativePath = normalizedPath.slice(normalizedHome.length).replace(/^\/+/g, '');
    return relativePath ? `/${relativePath}` : '/~';
  }

  return normalizedPath;
}

/**
 * Resolve a real session id from the current chat route map.
 */
function findSessionIdByRouteIndex(config, routeIndex) {
  if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
    return null;
  }

  const record = config?.chat?.[String(routeIndex)];
  return typeof record?.sessionId === 'string' && record.sessionId ? record.sessionId : null;
}

/**
 * Read the per-project high-water route counter for standalone manual sessions.
 */
function getManualSessionRouteCounter(config, projectPath) {
  if (!config || typeof config !== 'object') {
    return 0;
  }

  const counter = Number(config[MANUAL_SESSION_ROUTE_COUNTER_KEY]);
  if (Number.isInteger(counter) && counter > 0) {
    return counter;
  }

  const bucketKey = normalizeComparablePath(projectPath);
  const legacyMap = config[LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY];
  const legacyCounter = Number(bucketKey && legacyMap?.[bucketKey]);
  return Number.isInteger(legacyCounter) && legacyCounter > 0 ? legacyCounter : 0;
}

/**
 * Return the next standalone manual session number without recycling deleted ids.
 */
function getMaxStandaloneSessionRouteIndex(config, projectPath) {
  const workflowOwnedRouteSessionIds = getWorkflowOwnedRouteSessionIds(config);

  const chatMax = Object.entries(config?.chat || {}).reduce((maxValue, [routeIndexKey, record]) => {
    if (workflowOwnedRouteSessionIds.has(record?.sessionId)) {
      return maxValue;
    }

    const parsed = Number(routeIndexKey);
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, 0);

  return Object.entries(getManualSessionDraftMap(config)).reduce((maxValue, [draftId, draft]) => {
    if (isWorkflowOwnedDraft(draft)) {
      return maxValue;
    }
    const parsed = parseManualSessionRouteIndex(draftId) || Number(draft?.routeIndex);
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, chatMax);
}

/**
 * Return the next standalone manual session number without recycling deleted ids.
 */
function getNextManualSessionRouteIndex(config, projectPath, currentStandaloneCount = 0) {
  const persistedCounter = getManualSessionRouteCounter(config, projectPath);
  const maxStandaloneRouteIndex = getMaxStandaloneSessionRouteIndex(config, projectPath);
  const baselineCounter = Number.isInteger(persistedCounter) && persistedCounter > 0
    ? persistedCounter
    : Number(currentStandaloneCount || 0);
  return Math.max(
    baselineCounter,
    Number(currentStandaloneCount || 0),
    maxStandaloneRouteIndex,
  ) + 1;
}

/**
 * Persist the highest assigned standalone manual session number for one project.
 */
function writeManualSessionRouteCounter(config, projectPath, routeIndex) {
  if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
    return;
  }

  config[MANUAL_SESSION_ROUTE_COUNTER_KEY] = Math.max(
    getManualSessionRouteCounter(config, projectPath),
    routeIndex,
  );
  delete config[LEGACY_MANUAL_SESSION_ROUTE_COUNTER_BY_PATH_KEY];
}

/**
 * Delete a key from a config map and remove the map when it becomes empty.
 */
function deleteConfigMapEntry(config, mapKey, entryKey) {
  const rawMap = config?.[mapKey];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(rawMap, entryKey)) {
    return false;
  }

  delete rawMap[entryKey];
  if (Object.keys(rawMap).length === 0) {
    delete config[mapKey];
  }
  return true;
}

/**
 * Return the per-session model control map from project config.
 */
function getSessionModelStateMap(config) {
  if (config?.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const modelById = {};
    Object.values(config.chat || {}).forEach((record) => {
      if (record?.sessionId) {
        modelById[record.sessionId] = {
          model: record.model,
          reasoningEffort: record.reasoningEffort,
          thinkingMode: record.thinkingMode,
        };
      }
    });
    Object.values(config.workflows || {}).forEach((workflow) => {
      Object.values(workflow?.chat || {}).forEach((record) => {
        if (record?.sessionId) {
          modelById[record.sessionId] = {
            model: record.model,
            reasoningEffort: record.reasoningEffort,
            thinkingMode: record.thinkingMode,
          };
        }
      });
    });
    const rawMap = config?.[SESSION_MODEL_STATE_BY_ID_KEY];
    if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
      Object.entries(rawMap).forEach(([sessionId, state]) => {
        modelById[sessionId] = { ...modelById[sessionId], ...state };
      });
    }
    return modelById;
  }
  const rawMap = config?.[SESSION_MODEL_STATE_BY_ID_KEY];
  return rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap) ? rawMap : {};
}

/**
 * Normalize a persisted model control entry for frontend consumption.
 */
function normalizeSessionModelState(rawState) {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    return {};
  }

  const state = {};
  if (typeof rawState.model === 'string' && rawState.model.trim()) {
    state.model = rawState.model.trim();
  }
  if (typeof rawState.reasoningEffort === 'string' && rawState.reasoningEffort.trim()) {
    state.reasoningEffort = rawState.reasoningEffort.trim();
  }
  if (typeof rawState.thinkingMode === 'string' && rawState.thinkingMode.trim()) {
    state.thinkingMode = rawState.thinkingMode.trim();
  }
  if (typeof rawState.updatedAt === 'string' && rawState.updatedAt.trim()) {
    state.updatedAt = rawState.updatedAt.trim();
  }
  return state;
}

/**
 * Attach persisted Codex model controls to one session.
 */
function applySessionModelState(session, modelStateById) {
  const state = normalizeSessionModelState(modelStateById?.[session?.id]);
  if (!Object.keys(state).length) {
    return session;
  }

  return {
    ...session,
    model: state.model || session.model,
    reasoningEffort: state.reasoningEffort || session.reasoningEffort,
    thinkingMode: state.thinkingMode || session.thinkingMode,
  };
}

/**
 * Read the persisted model controls for a session in one project.
 */
async function getSessionModelState(projectPath = '', sessionId = '') {
  if (!sessionId) {
    return {};
  }
  const config = await loadProjectConfig(projectPath);
  return normalizeSessionModelState(getSessionModelStateMap(config)[sessionId]);
}

/**
 * Persist model controls for a session without disturbing other config fields.
 */
async function updateSessionModelState(projectPath = '', sessionId = '', patch = {}) {
  if (!sessionId) {
    throw new Error('Session id is required');
  }

  const config = await loadProjectConfig(projectPath);
  const modelStateById = {
    ...getSessionModelStateMap(config),
  };
  const previous = normalizeSessionModelState(modelStateById[sessionId]);
  const next = {
    ...previous,
  };

  if (typeof patch.model === 'string' && patch.model.trim()) {
    next.model = patch.model.trim();
  }
  if (typeof patch.reasoningEffort === 'string' && patch.reasoningEffort.trim()) {
    next.reasoningEffort = patch.reasoningEffort.trim();
  }
  if (typeof patch.thinkingMode === 'string' && patch.thinkingMode.trim()) {
    next.thinkingMode = patch.thinkingMode.trim();
  }
  next.updatedAt = new Date().toISOString();

  modelStateById[sessionId] = next;
  config[SESSION_MODEL_STATE_BY_ID_KEY] = modelStateById;
  await saveProjectConfig(config, projectPath);
  return next;
}

/**
 * Remove one deleted session from all project config indexes without rewinding counters.
 */
async function cleanupDeletedSessionConfig(sessionId, projectPath = '', provider = null) {
  const pathsToClean = [...new Set([projectPath || '', ''])];

  for (const configPath of pathsToClean) {
    const config = await loadProjectConfig(configPath);
    let changed = false;

    changed = deleteConfigMapEntry(config, MANUAL_SESSION_DRAFTS_KEY, sessionId) || changed;
    changed = deleteSessionSummaryOverride(config, sessionId) || changed;
    changed = deleteConfigMapEntry(config, LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY, sessionId) || changed;
    changed = deleteConfigMapEntry(config, LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY, sessionId) || changed;
    changed = deleteConfigMapEntry(config, SESSION_WORKFLOW_METADATA_BY_ID_KEY, sessionId) || changed;
    changed = deleteConfigMapEntry(config, SESSION_MODEL_STATE_BY_ID_KEY, sessionId) || changed;
    changed = deleteProjectChatRecords(config, sessionId, provider) || changed;

    const uiStateMap = getSessionUiStateMap(config, configPath);
    Object.keys(uiStateMap).forEach((stateKey) => {
      const matchesProvider = !provider || stateKey.startsWith(`${provider}:`);
      if (matchesProvider && stateKey.endsWith(`:${sessionId}`)) {
        delete uiStateMap[stateKey];
        changed = true;
      }
    });
    if (Object.keys(uiStateMap).length === 0) {
      delete config[SESSION_UI_STATE_BY_PATH_KEY];
    }

    if (changed) {
      await saveProjectConfig(config, configPath);
    }
  }
}

/**
 * Attach stable, non-recycled route indices to one project's manual sessions.
 */
function attachSessionRouteIndices(config, projectPath, provider, sessions = []) {
  /**
   * Rebuild route numbers from immutable creation time so deleting conf.json
   * still produces older sessions with smaller cN values.
   */
  const workflowOwnedRouteSessionIds = getWorkflowOwnedRouteSessionIds(config);
  config.schemaVersion = PROJECT_CONFIG_SCHEMA_VERSION;
  config.chat = config.chat && typeof config.chat === 'object' && !Array.isArray(config.chat) ? config.chat : {};

  const sessionIds = new Set(sessions.map((session) => session?.id).filter(Boolean));
  const reservedRouteIndices = new Set();
  let maxRouteIndex = Object.entries(config.chat).reduce((maxValue, [routeIndexKey, record]) => {
    const parsed = Number(routeIndexKey);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return maxValue;
    }
    if (!sessionIds.has(record?.sessionId) && !workflowOwnedRouteSessionIds.has(record?.sessionId)) {
      reservedRouteIndices.add(parsed);
    }
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, 0);
  const usedRouteIndices = new Set();
  let changed = false;

  const routeIndexBySessionId = new Map();
  const sessionsByCreation = [...sessions].sort((sessionA, sessionB) => (
    new Date(sessionA?.createdAt || sessionA?.created_at || sessionA?.lastActivity || 0).getTime()
    - new Date(sessionB?.createdAt || sessionB?.created_at || sessionB?.lastActivity || 0).getTime()
  ));

  sessionsByCreation.forEach((session) => {
    if (!session?.id) {
      return;
    }

    const existingRouteEntry = Object.entries(config.chat).find(([, record]) => record?.sessionId === session.id);
    let routeIndex = Number(existingRouteEntry?.[0]);
    if (
      !Number.isInteger(routeIndex)
      || routeIndex <= 0
      || reservedRouteIndices.has(routeIndex)
      || usedRouteIndices.has(routeIndex)
    ) {
      maxRouteIndex += 1;
      routeIndex = maxRouteIndex;
      changed = true;
    }
    usedRouteIndices.add(routeIndex);
    routeIndexBySessionId.set(session.id, routeIndex);
    if (session.id) {
      const nextRecord = {
        ...(config.chat[String(routeIndex)] || {}),
        sessionId: session.id,
        title: session.title || session.summary || session.name || config.chat[String(routeIndex)]?.title,
        provider,
      };
      if (config.chat[String(routeIndex)]?.ui && Object.keys(config.chat[String(routeIndex)].ui).length > 0) {
        nextRecord.ui = config.chat[String(routeIndex)].ui;
      }
      if (JSON.stringify(config.chat[String(routeIndex)] || {}) !== JSON.stringify(nextRecord)) {
        config.chat[String(routeIndex)] = nextRecord;
        changed = true;
      }
    }
  });

  const indexedSessions = sessions.map((session) => {
    if (!session?.id) {
      return session;
    }
    return {
      ...session,
      routeIndex: routeIndexBySessionId.get(session.id),
    };
  });

  return {
    sessions: indexedSessions,
    changed,
  };
}

/**
 * Resolve a custom display name from path-keyed config first, then legacy name-keyed config.
 */
function getCustomDisplayName(config, projectName, projectPath) {
  const normalizedPath = normalizeComparablePath(projectPath);
  const displayNameByPath = getDisplayNameByPathMap(config);
  const byPath = normalizedPath ? displayNameByPath[normalizedPath] : null;

  if (typeof byPath === 'string' && byPath.trim()) {
    return byPath.trim();
  }

  const byProjectName = config?.[projectName]?.displayName;
  if (typeof byProjectName === 'string' && byProjectName.trim()) {
    return byProjectName.trim();
  }

  return null;
}

/**
 * Build the display-name payload used by project discovery responses.
 */
function resolveProjectDisplayName(config, projectName, projectPath, fallbackDisplayName) {
  const customDisplayName = getCustomDisplayName(config, projectName, projectPath);
  if (customDisplayName) {
    return {
      displayName: customDisplayName,
      isCustomName: true
    };
  }

  return {
    displayName: fallbackDisplayName,
    isCustomName: false
  };
}

/**
 * Build the default archive payload for projects hidden from active lists.
 */
function createDefaultProjectArchiveIndex() {
  return {
    version: PROJECT_ARCHIVE_VERSION,
    archivedProjects: {}
  };
}

/**
 * Normalize archive payload shape to avoid runtime crashes with partial/legacy data.
 */
function normalizeProjectArchiveIndex(rawIndex) {
  if (!rawIndex || typeof rawIndex !== 'object') {
    return createDefaultProjectArchiveIndex();
  }

  return {
    version: Number.isInteger(rawIndex.version) ? rawIndex.version : PROJECT_ARCHIVE_VERSION,
    archivedProjects: rawIndex.archivedProjects && typeof rawIndex.archivedProjects === 'object'
      ? rawIndex.archivedProjects
      : {}
  };
}

/**
 * Resolve archive file location. Defaults to ~/.claude/project-archive.json.
 */
function getProjectArchiveFilePath(homeDir = os.homedir()) {
  return path.join(homeDir, '.claude', PROJECT_ARCHIVE_FILE_NAME);
}

/**
 * Load archived project index from disk. Missing/invalid file falls back to defaults.
 */
async function loadProjectArchiveIndex(options = {}) {
  const archivePath = options.archivePath || getProjectArchiveFilePath(options.homeDir);
  try {
    const archiveData = await fs.readFile(archivePath, 'utf8');
    const parsed = JSON.parse(archiveData);
    return normalizeProjectArchiveIndex(parsed);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to parse project archive index (${archivePath}):`, error.message);
    }
    return createDefaultProjectArchiveIndex();
  }
}

/**
 * Persist archived project index to disk.
 */
async function saveProjectArchiveIndex(archiveIndex, options = {}) {
  const archivePath = options.archivePath || getProjectArchiveFilePath(options.homeDir);
  const normalizedArchive = normalizeProjectArchiveIndex(archiveIndex);

  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.writeFile(archivePath, JSON.stringify(normalizedArchive, null, 2), 'utf8');
}

/**
 * Check whether an fs error means the project path is truly missing.
 */
function isMissingProjectPathError(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}

/**
 * Validate a project path for existence and classify archive-eligible failures.
 */
async function validateProjectPathAvailability(projectPath, options = {}) {
  if (!projectPath || typeof projectPath !== 'string') {
    return {
      exists: false,
      shouldArchive: false,
      errorCode: 'INVALID_PATH',
    };
  }

  const accessFn = options.access || fs.access;
  try {
    await accessFn(projectPath);
    return {
      exists: true,
      shouldArchive: false,
      errorCode: null,
    };
  } catch (error) {
    return {
      exists: false,
      shouldArchive: isMissingProjectPathError(error),
      errorCode: error?.code || 'UNKNOWN',
    };
  }
}

/**
 * Decide whether a project should be excluded from active list and archived.
 */
async function evaluateProjectArchival({
  projectPath,
  source,
  archiveIndex,
  options = {}
}) {
  const normalizedPath = normalizeComparablePath(projectPath);
  if (!normalizedPath) {
    return {
      excludeFromList: false,
      archiveUpdated: false,
      reason: 'invalid-path',
      normalizedPath: '',
    };
  }

  const normalizedArchive = normalizeProjectArchiveIndex(archiveIndex);
  const availability = await validateProjectPathAvailability(projectPath, options);
  if (normalizedArchive.archivedProjects[normalizedPath]) {
    if (availability.exists || !availability.shouldArchive) {
      delete normalizedArchive.archivedProjects[normalizedPath];
      return {
        excludeFromList: false,
        archiveUpdated: true,
        reason: availability.exists ? 'archive-cleared-path-exists' : 'archive-cleared-non-archive-error',
        normalizedPath,
      };
    }

    return {
      excludeFromList: true,
      archiveUpdated: false,
      reason: 'already-archived',
      normalizedPath,
    };
  }

  if (availability.exists) {
    return {
      excludeFromList: false,
      archiveUpdated: false,
      reason: 'path-exists',
      normalizedPath,
    };
  }

  if (!availability.shouldArchive) {
    return {
      excludeFromList: false,
      archiveUpdated: false,
      reason: 'non-archive-error',
      normalizedPath,
    };
  }

  const timestamp = options.now instanceof Date
    ? options.now.toISOString()
    : new Date().toISOString();
  normalizedArchive.archivedProjects[normalizedPath] = {
    normalizedPath,
    path: projectPath,
    source,
    reason: 'path-missing',
    archivedAt: timestamp,
    lastCheckedAt: timestamp,
    errorCode: availability.errorCode,
  };

  return {
    excludeFromList: true,
    archiveUpdated: true,
    reason: 'archived-missing-path',
    normalizedPath,
  };
}

// Generate display name from the project directory path.
// Uses the directory name directly so projects are labelled by their folder name.
async function generateDisplayName(projectName, actualProjectDir = null) {
  const projectPath = actualProjectDir || projectName.replace(/-/g, '/');

  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    return parts[parts.length - 1] || projectPath;
  }

  return projectPath;
}

// Extract the actual project directory from JSONL sessions (with caching)
async function extractProjectDirectory(projectName) {
  // Check cache first
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName);
  }

  // Check project config for originalPath (manually added projects via UI or platform)
  // This handles projects with dashes in their directory names correctly
  const config = await loadProjectConfig();
  if (config[projectName]?.originalPath) {
    const originalPath = config[projectName].originalPath;
    projectDirectoryCache.set(projectName, originalPath);
    return originalPath;
  }

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
  const cwdCounts = new Map();
  let latestTimestamp = 0;
  let latestCwd = null;
  let extractedPath;

  try {
    // Check if the project directory exists
    await fs.access(projectDir);

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      // Fall back to decoded project name if no sessions
      extractedPath = projectName.replace(/-/g, '/');
    } else {
      // Process all JSONL files to collect cwd values
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);

              if (entry.cwd) {
                // Count occurrences of each cwd
                cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);

                // Track the most recent cwd
                const timestamp = new Date(entry.timestamp || 0).getTime();
                if (timestamp > latestTimestamp) {
                  latestTimestamp = timestamp;
                  latestCwd = entry.cwd;
                }
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        }
      }

      // Determine the best cwd to use
      if (cwdCounts.size === 0) {
        // No cwd found, fall back to decoded project name
        extractedPath = projectName.replace(/-/g, '/');
      } else if (cwdCounts.size === 1) {
        // Only one cwd, use it
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // Multiple cwd values - prefer the most recent one if it has reasonable usage
        const mostRecentCount = cwdCounts.get(latestCwd) || 0;
        const maxCount = Math.max(...cwdCounts.values());

        // Use most recent if it has at least 25% of the max count
        if (mostRecentCount >= maxCount * 0.25) {
          extractedPath = latestCwd;
        } else {
          // Otherwise use the most frequently used cwd
          for (const [cwd, count] of cwdCounts.entries()) {
            if (count === maxCount) {
              extractedPath = cwd;
              break;
            }
          }
        }

        // Fallback (shouldn't reach here)
        if (!extractedPath) {
          extractedPath = latestCwd || projectName.replace(/-/g, '/');
        }
      }
    }

    // Cache the result
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;

  } catch (error) {
    // If the directory doesn't exist, just use the decoded project name
    if (error.code === 'ENOENT') {
      extractedPath = projectName.replace(/-/g, '/');
    } else {
      console.error(`Error extracting project directory for ${projectName}:`, error);
      // Fall back to decoded project name for other errors
      extractedPath = projectName.replace(/-/g, '/');
    }

    // Cache the fallback result too
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;
  }
}

/**
 * Merge worktree sub-projects into their parent project.
 * Detects projects whose path contains /.worktrees/ and folds their sessions
 * into the matching parent project, then removes the worktree entries.
 */
function mergeWorktreeProjects(projects) {
  const WORKTREE_SEGMENT = '/.worktrees/';
  const parentMap = new Map(); // parentPath -> project index
  const worktreeIndices = [];

  // First pass: index parent projects and identify worktree projects
  for (let i = 0; i < projects.length; i++) {
    const projectPath = projects[i].path || projects[i].fullPath || '';
    if (projectPath.includes(WORKTREE_SEGMENT)) {
      worktreeIndices.push(i);
    } else {
      parentMap.set(normalizeComparablePath(projectPath), i);
    }
  }

  if (worktreeIndices.length === 0) {
    return;
  }

  // Second pass: merge worktree sessions into parent
  const toRemove = new Set();
  for (const wtIdx of worktreeIndices) {
    const wtProject = projects[wtIdx];
    const wtPath = wtProject.path || wtProject.fullPath || '';
    const parentPath = wtPath.substring(0, wtPath.indexOf(WORKTREE_SEGMENT));
    const normalizedParent = normalizeComparablePath(parentPath);
    const parentIdx = parentMap.get(normalizedParent);

    if (parentIdx === undefined) {
      // No matching parent project found — keep worktree as standalone
      continue;
    }

    const parent = projects[parentIdx];

    // Derive a branch label from the worktree path for session context
    const branchName = wtPath.substring(wtPath.indexOf(WORKTREE_SEGMENT) + WORKTREE_SEGMENT.length);

    // Merge claude sessions
    if (wtProject.sessions?.length > 0) {
      const taggedSessions = wtProject.sessions.map(s => ({
        ...s,
        worktreeBranch: branchName,
        __projectName: s.__projectName || wtProject.name,
      }));
      parent.sessions = [...(parent.sessions || []), ...taggedSessions];
      parent.sessionMeta = {
        ...parent.sessionMeta,
        total: (parent.sessionMeta?.total || 0) + (wtProject.sessionMeta?.total || 0),
      };
    }

    // Merge Codex sessions if present
    for (const key of ['codexSessions']) {
      if (wtProject[key]?.length > 0) {
        parent[key] = [
          ...(parent[key] || []),
          ...wtProject[key].map((session) => ({
            ...session,
            __projectName: session.__projectName || wtProject.name,
          })),
        ];
      }
    }

    toRemove.add(wtIdx);
  }

  // Remove merged worktree projects (reverse order to preserve indices)
  const sortedRemove = [...toRemove].sort((a, b) => b - a);
  for (const idx of sortedRemove) {
    projects.splice(idx, 1);
  }
}

async function getProjects(progressCallback = null) {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const config = await loadProjectConfig();
  const projectArchiveIndex = await loadProjectArchiveIndex();
  const projects = [];
  const existingProjects = new Set();
  const knownProjectPaths = new Set();
  const usedProjectNames = new Set();
  const codexSessionsIndexRef = { sessionsByProject: null };
  let archiveIndexChanged = false;
  let totalProjects = 0;
  let processedProjects = 0;
  let directories = [];

  /**
   * Apply missing-path archival policy and tell caller whether to skip this project.
   */
  const shouldSkipProject = async (projectPath, source) => {
    const archiveDecision = await evaluateProjectArchival({
      projectPath,
      source,
      archiveIndex: projectArchiveIndex,
    });

    if (archiveDecision.archiveUpdated) {
      archiveIndexChanged = true;
    }

    return archiveDecision.excludeFromList;
  };

  try {
    // Check if the .claude/projects directory exists
    await fs.access(claudeDir);

    // First, get existing Claude projects from the file system
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    directories = entries.filter(e => e.isDirectory());

    // Build set of existing project names for later
    directories.forEach(e => existingProjects.add(e.name));

    // Count manual projects not already in directories
    const manualProjectsCount = Object.entries(config)
      .filter(([name, cfg]) => cfg.manuallyAdded && !existingProjects.has(name))
      .length;

    totalProjects = directories.length + manualProjectsCount;

    for (const entry of directories) {
      processedProjects++;

      // Emit progress
      if (progressCallback) {
        progressCallback({
          phase: 'loading',
          current: processedProjects,
          total: totalProjects,
          currentProject: entry.name
        });
      }

      // Extract actual project directory from JSONL sessions
      const actualProjectDir = await extractProjectDirectory(entry.name);
      if (await shouldSkipProject(actualProjectDir, 'claude')) {
        continue;
      }

      // Get display name from config or generate one
      const autoDisplayName = await generateDisplayName(entry.name, actualProjectDir);
      const resolvedDisplayName = resolveProjectDisplayName(
        config,
        entry.name,
        actualProjectDir,
        autoDisplayName
      );
      const fullPath = actualProjectDir;

      const project = {
        name: entry.name,
        path: actualProjectDir,
        routePath: buildProjectRoutePath(actualProjectDir),
        displayName: resolvedDisplayName.displayName,
        fullPath: fullPath,
        isCustomName: resolvedDisplayName.isCustomName,
        sessions: [],
        sessionMeta: {
          hasMore: false,
          total: 0
        }
      };

      // Project overview must surface every already-loaded manual session card.
      try {
        const sessionResult = await getSessions(entry.name, PROJECT_OVERVIEW_SESSION_LIMIT, 0, {
          includeHidden: true,
          excludeWorkflowChildSessions: true,
        });
        project.sessions = sessionResult.sessions || [];
        project.sessionMeta = {
          hasMore: sessionResult.hasMore,
          total: sessionResult.total
        };
      } catch (e) {
        console.warn(`Could not load sessions for project ${entry.name}:`, e.message);
        project.sessionMeta = {
          hasMore: false,
          total: 0
        };
      }

      // Also fetch Codex sessions for this project
      try {
        project.codexSessions = await getCodexSessions(actualProjectDir, {
          limit: PROJECT_OVERVIEW_SESSION_LIMIT,
          indexRef: codexSessionsIndexRef,
          includeHidden: true,
          excludeWorkflowChildSessions: true,
        });
      } catch (e) {
        console.warn(`Could not load Codex sessions for project ${entry.name}:`, e.message);
        project.codexSessions = [];
      }
      await attachManualSessionNextRouteIndex(project, actualProjectDir);

      // Add TaskMaster detection
      try {
        const taskMasterResult = await detectTaskMasterFolder(actualProjectDir);
        project.taskmaster = {
          hasTaskmaster: taskMasterResult.hasTaskmaster,
          hasEssentialFiles: taskMasterResult.hasEssentialFiles,
          metadata: taskMasterResult.metadata,
          status: taskMasterResult.hasTaskmaster && taskMasterResult.hasEssentialFiles ? 'configured' : 'not-configured'
        };
      } catch (e) {
        console.warn(`Could not detect TaskMaster for project ${entry.name}:`, e.message);
        project.taskmaster = {
          hasTaskmaster: false,
          hasEssentialFiles: false,
          metadata: null,
          status: 'error'
        };
      }

      usedProjectNames.add(project.name);
      const normalizedProjectPath = normalizeComparablePath(actualProjectDir);
      if (normalizedProjectPath) {
        knownProjectPaths.add(normalizedProjectPath);
      }

      projects.push(project);
    }
  } catch (error) {
    // If the directory doesn't exist (ENOENT), that's okay - just continue with empty projects
    if (error.code !== 'ENOENT') {
      console.error('Error reading projects directory:', error);
    }
    // Calculate total for manual projects only (no directories exist)
    totalProjects = Object.entries(config)
      .filter(([name, cfg]) => cfg.manuallyAdded)
      .length;
  }

  // Add manually configured projects that don't exist as folders yet
  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (!existingProjects.has(projectName) && projectConfig.manuallyAdded) {
      processedProjects++;

      // Emit progress for manual projects
      if (progressCallback) {
        progressCallback({
          phase: 'loading',
          current: processedProjects,
          total: totalProjects,
          currentProject: projectName
        });
      }

      // Use the original path if available, otherwise extract from potential sessions
      let actualProjectDir = projectConfig.originalPath;

      if (!actualProjectDir) {
        try {
          actualProjectDir = await extractProjectDirectory(projectName);
        } catch (error) {
          // Fall back to decoded project name
          actualProjectDir = projectName.replace(/-/g, '/');
        }
      }
      if (await shouldSkipProject(actualProjectDir, 'manual')) {
        continue;
      }

      const autoDisplayName = await generateDisplayName(projectName, actualProjectDir);
      const resolvedDisplayName = resolveProjectDisplayName(
        config,
        projectName,
        actualProjectDir,
        autoDisplayName
      );

      const project = {
        name: projectName,
        path: actualProjectDir,
        routePath: buildProjectRoutePath(actualProjectDir),
        displayName: resolvedDisplayName.displayName,
        fullPath: actualProjectDir,
        isCustomName: resolvedDisplayName.isCustomName,
        isManuallyAdded: true,
        sessions: [],
        sessionMeta: {
          hasMore: false,
          total: 0
        },
        codexSessions: []
      };

      // Try to fetch Codex sessions for manual projects too
      try {
        project.codexSessions = await getCodexSessions(actualProjectDir, {
          limit: PROJECT_OVERVIEW_SESSION_LIMIT,
          indexRef: codexSessionsIndexRef,
          includeHidden: true,
          excludeWorkflowChildSessions: true,
        });
      } catch (e) {
        console.warn(`Could not load Codex sessions for manual project ${projectName}:`, e.message);
      }
      await attachManualSessionNextRouteIndex(project, actualProjectDir);

      // Add TaskMaster detection for manual projects
      try {
        const taskMasterResult = await detectTaskMasterFolder(actualProjectDir);

        // Determine TaskMaster status
        let taskMasterStatus = 'not-configured';
        if (taskMasterResult.hasTaskmaster && taskMasterResult.hasEssentialFiles) {
          taskMasterStatus = 'taskmaster-only'; // We don't check MCP for manual projects in bulk
        }

        project.taskmaster = {
          status: taskMasterStatus,
          hasTaskmaster: taskMasterResult.hasTaskmaster,
          hasEssentialFiles: taskMasterResult.hasEssentialFiles,
          metadata: taskMasterResult.metadata
        };
      } catch (error) {
        console.warn(`TaskMaster detection failed for manual project ${projectName}:`, error.message);
        project.taskmaster = {
          status: 'error',
          hasTaskmaster: false,
          hasEssentialFiles: false,
          error: error.message
        };
      }

      usedProjectNames.add(project.name);
      const normalizedProjectPath = normalizeComparablePath(actualProjectDir);
      if (normalizedProjectPath) {
        knownProjectPaths.add(normalizedProjectPath);
      }

      projects.push(project);
    }
  }

  // Add Codex-only projects that are not present in Claude/manual discovery.
  if (!codexSessionsIndexRef.sessionsByProject) {
    codexSessionsIndexRef.sessionsByProject = await buildCodexSessionsIndex();
  }

  for (const [normalizedProjectPath, codexSessions] of codexSessionsIndexRef.sessionsByProject.entries()) {
    if (!normalizedProjectPath || knownProjectPaths.has(normalizedProjectPath)) {
      continue;
    }

    const inferredProjectPath = codexSessions?.[0]?.cwd || normalizedProjectPath;
    if (await shouldSkipProject(inferredProjectPath, 'codex')) {
      continue;
    }
    let baseProjectName = inferredProjectPath.replace(/[\\/:\s~_]/g, '-');
    if (!baseProjectName) {
      baseProjectName = `codex-${crypto.createHash('md5').update(normalizedProjectPath).digest('hex').slice(0, 12)}`;
    }

    let projectName = baseProjectName;
    if (usedProjectNames.has(projectName)) {
      const suffix = crypto.createHash('md5').update(normalizedProjectPath).digest('hex').slice(0, 8);
      projectName = `${baseProjectName}-codex-${suffix}`;
    }
    while (usedProjectNames.has(projectName)) {
      projectName = `${projectName}-1`;
    }

    const autoDisplayName = await generateDisplayName(projectName, inferredProjectPath);
    const resolvedDisplayName = resolveProjectDisplayName(
      config,
      projectName,
      inferredProjectPath,
      autoDisplayName
    );
    const codexOnlyProject = {
      name: projectName,
      path: inferredProjectPath,
      routePath: buildProjectRoutePath(inferredProjectPath),
      displayName: resolvedDisplayName.displayName,
      fullPath: inferredProjectPath,
      isCustomName: resolvedDisplayName.isCustomName,
      sessions: [],
      codexSessions: await getCodexSessions(inferredProjectPath, {
        limit: PROJECT_OVERVIEW_SESSION_LIMIT,
        indexRef: codexSessionsIndexRef,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
      }),
      sessionMeta: {
        hasMore: false,
        total: 0
      }
    };
    await attachManualSessionNextRouteIndex(codexOnlyProject, inferredProjectPath);

    projects.push(codexOnlyProject);
    usedProjectNames.add(projectName);
    knownProjectPaths.add(normalizedProjectPath);
  }

  await mergeActiveProviderSessionsIntoProjects({
    projects,
    config,
    usedProjectNames,
    knownProjectPaths,
  });

  // Merge worktree sub-projects into their parent project.
  // Claude Code creates separate project directories for git worktrees (e.g.
  // "-home-user-repo--worktrees-branch"), but users expect to see all sessions
  // under the single parent project.
  mergeWorktreeProjects(projects);

  if (archiveIndexChanged) {
    try {
      await saveProjectArchiveIndex(projectArchiveIndex);
    } catch (error) {
      console.warn('Failed to persist project archive index:', error.message);
    }
  }

  // Emit completion after all projects (including manual) are processed
  if (progressCallback) {
    progressCallback({
      phase: 'complete',
      current: totalProjects,
      total: totalProjects
    });
  }

  return projects;
}

async function getSessions(projectName, limit = 5, offset = 0, options = {}) {
  const { includeHidden = false, excludeWorkflowChildSessions = false } = options;
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    let config = await loadProjectConfig();
    let summaryOverrideById = getSessionSummaryOverrideMap(config);
    let workflowMetadataById = getSessionWorkflowMetadataMap(config);
    let files = [];
    try {
      files = await fs.readdir(projectDir);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
    // agent-*.jsonl files contain session start data at this point. This needs to be revisited
    // periodically to make sure only accurate data is there and no new functionality is added there
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));
    const fallbackProjectPath = await extractProjectDirectory(projectName);
    config = await loadProjectConfig(fallbackProjectPath);
    summaryOverrideById = getSessionSummaryOverrideMap(config);
    workflowMetadataById = getSessionWorkflowMetadataMap(config);
    const manualDraftSessions = getManualDraftSessionsForProject(config, {
      projectName,
      projectPath: fallbackProjectPath,
      provider: 'claude',
    });

    if (jsonlFiles.length === 0) {
      const annotatedDraftSessions = await annotateSessionCollectionVisibility(manualDraftSessions, fallbackProjectPath);
      const draftSessionsWithUiState = annotatedDraftSessions.map((session) => applySessionUiState(
        session,
        fallbackProjectPath,
        'claude',
        config,
      ));
      const indexedDraftSessions = attachSessionRouteIndices(
        config,
        fallbackProjectPath,
        'claude',
        draftSessionsWithUiState,
      );
      if (indexedDraftSessions.changed) {
        await saveProjectConfig(config, fallbackProjectPath);
      }
      const sessionsForResponse = includeHidden
        ? indexedDraftSessions.sessions
        : filterHiddenArchivedSessions(indexedDraftSessions.sessions);
      const hasMore = limit > 0 ? offset + limit < sessionsForResponse.length : false;
      return {
        sessions: limit > 0 ? sessionsForResponse.slice(offset, offset + limit) : sessionsForResponse,
        hasMore,
        total: sessionsForResponse.length,
        offset,
        limit,
      };
    }

    // Sort files by modification time (newest first)
    const filesWithStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );
    filesWithStats.sort((a, b) => b.mtime - a.mtime);

    const allSessions = new Map();
    const allEntries = [];
    const uuidToSessionMap = new Map();

    // Collect all sessions and entries from all files
    for (const { file } of filesWithStats) {
      const jsonlFile = path.join(projectDir, file);
      const result = await parseJsonlSessions(jsonlFile);

      result.sessions.forEach(session => {
        if (!allSessions.has(session.id)) {
          allSessions.set(session.id, session);
        }
      });

      allEntries.push(...result.entries);

      // Early exit optimization for large projects
      if (allSessions.size >= (limit + offset) * 2 && allEntries.length >= Math.min(3, filesWithStats.length)) {
        break;
      }
    }

    // Build UUID-to-session mapping for timeline detection
    allEntries.forEach(entry => {
      if (entry.uuid && entry.sessionId) {
        uuidToSessionMap.set(entry.uuid, entry.sessionId);
      }
    });

    // Group sessions by first user message ID
    const sessionGroups = new Map(); // firstUserMsgId -> { latestSession, allSessions[] }
    const sessionToFirstUserMsgId = new Map(); // sessionId -> firstUserMsgId

    // Find the first user message for each session
    allEntries.forEach(entry => {
      if (entry.sessionId && entry.type === 'user' && entry.parentUuid === null && entry.uuid) {
        // This is a first user message in a session (parentUuid is null)
        const firstUserMsgId = entry.uuid;

        if (!sessionToFirstUserMsgId.has(entry.sessionId)) {
          sessionToFirstUserMsgId.set(entry.sessionId, firstUserMsgId);

          const session = allSessions.get(entry.sessionId);
          if (session) {
            if (!sessionGroups.has(firstUserMsgId)) {
              sessionGroups.set(firstUserMsgId, {
                latestSession: session,
                allSessions: [session]
              });
            } else {
              const group = sessionGroups.get(firstUserMsgId);
              group.allSessions.push(session);

              // Update latest session if this one is more recent
              if (new Date(session.lastActivity) > new Date(group.latestSession.lastActivity)) {
                group.latestSession = session;
              }
            }
          }
        }
      }
    });

    // Collect all sessions that don't belong to any group (standalone sessions)
    const groupedSessionIds = new Set();
    sessionGroups.forEach(group => {
      group.allSessions.forEach(session => groupedSessionIds.add(session.id));
    });

    const standaloneSessionsArray = Array.from(allSessions.values())
      .filter(session => !groupedSessionIds.has(session.id));

    // Combine grouped sessions (only show latest from each group) + standalone sessions
    const latestFromGroups = Array.from(sessionGroups.values()).map(group => {
      const session = { ...group.latestSession };
      // Add metadata about grouping
      if (group.allSessions.length > 1) {
        session.isGrouped = true;
        session.groupSize = group.allSessions.length;
        session.groupSessions = group.allSessions.map(s => s.id);
      }
      return session;
    });
    let candidateSessions = [...latestFromGroups, ...standaloneSessionsArray]
      .map((session) => applySessionMetadataOverrides(session, summaryOverrideById, workflowMetadataById, 'claude'))
      .concat(manualDraftSessions)
      .filter(session => !session.summary.startsWith('{ "'))
      .sort((a, b) => new Date(b.createdAt || b.lastActivity || 0) - new Date(a.createdAt || a.lastActivity || 0));
    if (excludeWorkflowChildSessions) {
      /**
       * PURPOSE: Keep workflow child sessions inside workflow detail only.
       * The project homepage manual-session collection must stay focused on
       * sessions users can enter directly outside workflow orchestration.
       */
      const workflows = await listProjectWorkflows(fallbackProjectPath);
      const workflowClaudeSessionIds = new Set(
        workflows.flatMap((workflow) => (workflow.childSessions || []))
          .filter((session) => (!session?.provider || session.provider === 'claude') && session?.id)
          .map((session) => session.id),
      );
      candidateSessions = candidateSessions.filter((session) => (
        !workflowClaudeSessionIds.has(session.id)
        && !isLikelyWorkflowAutoSession(session, workflows, 'claude')
      ));
    }
    const annotatedSessions = await annotateSessionCollectionVisibility(candidateSessions, fallbackProjectPath);
    const sessionsWithUiState = annotatedSessions.map((session) => applySessionUiState(
      session,
      fallbackProjectPath,
      'claude',
      config,
    ));
    const visibleOrAllSessions = includeHidden
      ? sessionsWithUiState
      : filterHiddenArchivedSessions(sessionsWithUiState);
    const indexedSessions = attachSessionRouteIndices(
      config,
      fallbackProjectPath,
      'claude',
      visibleOrAllSessions,
    );
    if (indexedSessions.changed) {
      await saveProjectConfig(config, fallbackProjectPath);
    }
    const sessionsForResponse = indexedSessions.sessions;

    const hiddenCount = sessionsWithUiState.length - sessionsForResponse.length;
    if (hiddenCount > 0) {
      console.info(
        `[SessionVisibility] Project ${projectName}: hidden ${hiddenCount} session(s) with missing project paths`,
      );
    }

    const total = sessionsForResponse.length;
    const paginatedSessions = sessionsForResponse.slice(offset, offset + limit);
    const hasMore = limit > 0 ? offset + limit < total : false;

    return {
      sessions: paginatedSessions,
      hasMore,
      total,
      offset,
      limit
    };
  } catch (error) {
    if (isMissingProjectPathError(error)) {
      return { sessions: [], hasMore: false, total: 0 };
    }

    console.error(`Error reading sessions for project ${projectName}:`, error);
    return { sessions: [], hasMore: false, total: 0 };
  }
}

async function parseJsonlSessions(filePath) {
  const sessions = new Map();
  const entries = [];
  const pendingSummaries = new Map(); // leafUuid -> summary for entries without sessionId

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);

          // Handle summary entries that don't have sessionId yet
          if (entry.type === 'summary' && entry.summary && !entry.sessionId && entry.leafUuid) {
            pendingSummaries.set(entry.leafUuid, entry.summary);
          }

          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              const entryDate = entry.timestamp ? new Date(entry.timestamp) : null;
              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: 'New Session',
                messageCount: 0,
                createdAt: entryDate,
                lastActivity: entryDate,
                cwd: entry.cwd || '',
                firstUserMessage: null,
                lastAssistantMessage: null
              });
            }

            const session = sessions.get(entry.sessionId);

            // Apply pending summary if this entry has a parentUuid that matches a pending summary
            if (session.summary === 'New Session' && entry.parentUuid && pendingSummaries.has(entry.parentUuid)) {
              session.summary = pendingSummaries.get(entry.parentUuid);
            }

            // Update summary from summary entries with sessionId
            if (entry.type === 'summary' && entry.summary) {
              session.summary = entry.summary;
            }

            // Track first user and latest assistant messages (skip system messages)
            if (entry.message?.role === 'user' && entry.message?.content) {
              const content = entry.message.content;

              // Extract text from array format if needed
              let textContent = content;
              if (Array.isArray(content) && content.length > 0 && content[0].type === 'text') {
                textContent = content[0].text;
              }

              const isSystemMessage = typeof textContent === 'string' && (
                textContent.startsWith('<command-name>') ||
                textContent.startsWith('<command-message>') ||
                textContent.startsWith('<command-args>') ||
                textContent.startsWith('<local-command-stdout>') ||
                textContent.startsWith('<system-reminder>') ||
                textContent.startsWith('Caveat:') ||
                textContent.startsWith('This session is being continued from a previous') ||
                textContent.startsWith('Invalid API key') ||
                textContent.includes('{"subtasks":') || // Filter Task Master prompts
                textContent.includes('CRITICAL: You MUST respond with ONLY a JSON') || // Filter Task Master system prompts
                isBootstrapSessionPrompt(textContent)
              );

              if (typeof textContent === 'string' && textContent.length > 0 && !isSystemMessage) {
                session.firstUserMessage = session.firstUserMessage || textContent;
              }
            } else if (entry.message?.role === 'assistant' && entry.message?.content) {
              // Skip API error messages using the isApiErrorMessage flag
              if (entry.isApiErrorMessage === true) {
                // Skip this message entirely
              } else {
                // Track last assistant text message
                let assistantText = null;

                if (Array.isArray(entry.message.content)) {
                  for (const part of entry.message.content) {
                    if (part.type === 'text' && part.text) {
                      assistantText = part.text;
                    }
                  }
                } else if (typeof entry.message.content === 'string') {
                  assistantText = entry.message.content;
                }

                // Additional filter for assistant messages with system content
                const isSystemAssistantMessage = typeof assistantText === 'string' && (
                  assistantText.startsWith('Invalid API key') ||
                  assistantText.includes('{"subtasks":') ||
                  assistantText.includes('CRITICAL: You MUST respond with ONLY a JSON')
                );

                if (assistantText && !isSystemAssistantMessage) {
                  session.lastAssistantMessage = assistantText;
                }
              }
            }

            session.messageCount++;

            if (entry.timestamp) {
              const entryDate = new Date(entry.timestamp);
              if (!Number.isNaN(entryDate.getTime())) {
                const createdAtTime = new Date(session.createdAt || 0).getTime();
                if (!Number.isFinite(createdAtTime) || createdAtTime <= 0) {
                  session.createdAt = entryDate;
                }
                session.lastActivity = entryDate;
              }
            }
          }
        } catch (parseError) {
          // Skip malformed lines silently
        }
      }
    }

    // After processing all entries, set final summary based on last message if no summary exists
    for (const session of sessions.values()) {
      if (session.summary === 'New Session') {
        // Prefer the first user instruction so long conversations keep their original intent.
        const defaultSummary = session.firstUserMessage || session.lastAssistantMessage;
        if (defaultSummary) {
          session.summary = defaultSummary.length > 50 ? defaultSummary.substring(0, 50) + '...' : defaultSummary;
        }
      }
    }

    // Filter out sessions that contain JSON responses (Task Master errors)
    const allSessions = Array.from(sessions.values());
    const filteredSessions = allSessions.filter(session => {
      const shouldFilter = session.summary.startsWith('{ "');
      if (shouldFilter) {
      }
      // Log a sample of summaries to debug
      if (Math.random() < 0.01) { // Log 1% of sessions
      }
      return !shouldFilter;
    });


    return {
      sessions: filteredSessions,
      entries: entries
    };

  } catch (error) {
    console.error('Error reading JSONL file:', error);
    return { sessions: [], entries: [] };
  }
}

/**
 * Decide whether a prompt is only used to bootstrap a new manual session.
 * These prompts should not become the visible session summary.
 */
function isBootstrapSessionPrompt(text) {
  if (typeof text !== 'string') {
    return false;
  }

  const normalized = text.trim().toLowerCase();
  return normalized === 'warmup' || normalized === 'ping';
}

// Parse an agent JSONL file and extract tool uses
async function parseAgentTools(filePath) {
  const tools = [];

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          // Look for assistant messages with tool_use
          if (entry.message?.role === 'assistant' && Array.isArray(entry.message?.content)) {
            for (const part of entry.message.content) {
              if (part.type === 'tool_use') {
                tools.push({
                  toolId: part.id,
                  toolName: part.name,
                  toolInput: part.input,
                  timestamp: entry.timestamp
                });
              }
            }
          }
          // Look for tool results
          if (entry.message?.role === 'user' && Array.isArray(entry.message?.content)) {
            for (const part of entry.message.content) {
              if (part.type === 'tool_result') {
                // Find the matching tool and add result
                const tool = tools.find(t => t.toolId === part.tool_use_id);
                if (tool) {
                  tool.toolResult = {
                    content: typeof part.content === 'string' ? part.content :
                      Array.isArray(part.content) ? part.content.map(c => c.text || '').join('\n') :
                        JSON.stringify(part.content),
                    isError: Boolean(part.is_error)
                  };
                }
              }
            }
          }
        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }
  } catch (error) {
    console.warn(`Error parsing agent file ${filePath}:`, error.message);
  }

  return tools;
}

// Get messages for a specific session with pagination support.
// When afterLine is provided (>= 0), returns only lines after that count
// for incremental append, bypassing the tail-window pagination entirely.
async function getSessionMessages(projectName, sessionId, limit = null, offset = 0, afterLine = null) {
  // 直接读取 {sessionId}.jsonl，避免全目录扫描
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const messages = [];
    let fallbackTotal = null;

    // 优先直接读 sessionId 对应的文件，跳过全量 readdir + 遍历
    const directFile = path.join(projectDir, `${sessionId}.jsonl`);
    let foundDirect = false;
    try {
      await fs.access(directFile);
      foundDirect = true;
    } catch { /* file doesn't exist, fall through to scan */ }

    if (foundDirect) {
      let total = null;

      // afterLine 模式：只返回第 N 行之后的增量内容
      if (afterLine !== null && afterLine >= 0) {
        const result = await readJsonlAfterLine(directFile, afterLine);
        total = result.total;

        for (const entry of result.lines) {
          try {
            const parsed = JSON.parse(entry.line);
            parsed.messageKey = buildClaudeMessageKey(sessionId, entry.lineNumber);
            parsed.__lineNumber = entry.lineNumber;
            messages.push(parsed);
          } catch (parseError) {
            console.warn('Error parsing line:', parseError.message);
          }
        }
      } else if (limit !== null) {
        const tailWindow = await readJsonlTailWindow(directFile, limit, offset);
        total = tailWindow.total;

        for (const entry of tailWindow.lines) {
          try {
            const parsed = JSON.parse(entry.line);
            parsed.messageKey = buildClaudeMessageKey(sessionId, entry.lineNumber);
            parsed.__lineNumber = entry.lineNumber;
            messages.push(parsed);
          } catch (parseError) {
            console.warn('Error parsing line:', parseError.message);
          }
        }
      } else {
        const fileStream = fsSync.createReadStream(directFile);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        let lineNumber = 0;
        for await (const line of rl) {
          if (line.trim()) {
            lineNumber += 1;
            try {
              const parsed = JSON.parse(line);
              parsed.messageKey = buildClaudeMessageKey(sessionId, lineNumber);
              parsed.__lineNumber = lineNumber;
              messages.push(parsed);
            } catch (parseError) {
              console.warn('Error parsing line:', parseError.message);
            }
          }
        }
      }

      if (messages.length === 0) {
        return (limit === null && afterLine === null) ? [] : { messages: [], total: total || 0, hasMore: false };
      }

      // 加载 subagent 工具信息（并行读取）
      const agentIds = new Set();
      for (const message of messages) {
        if (message.toolUseResult?.agentId) {
          agentIds.add(message.toolUseResult.agentId);
        }
      }

      if (agentIds.size > 0) {
        const agentToolsCache = new Map();
        await Promise.all([...agentIds].map(async (agentId) => {
          const agentFilePath = path.join(projectDir, `agent-${agentId}.jsonl`);
          try {
            await fs.access(agentFilePath);
            const tools = await parseAgentTools(agentFilePath);
            agentToolsCache.set(agentId, tools);
          } catch { /* agent file not found, skip */ }
        }));

        for (const message of messages) {
          if (message.toolUseResult?.agentId) {
            const agentTools = agentToolsCache.get(message.toolUseResult.agentId);
            if (agentTools && agentTools.length > 0) {
              message.subagentTools = agentTools;
            }
          }
        }
      }

      const sortedMessages = messages.sort((a, b) =>
        new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
      );

      if (limit === null && afterLine === null) {
        return sortedMessages;
      }

      const resolvedTotal = total ?? sortedMessages.length;
      return {
        messages: sortedMessages,
        total: resolvedTotal,
        hasMore: afterLine !== null ? false : resolvedTotal > (offset + sortedMessages.length),
      };
    } else {
      // Fallback: 扫描所有 JSONL 文件（兼容文件名不等于 sessionId 的情况）
      let files = [];
      try {
        files = await fs.readdir(projectDir);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));
      fallbackTotal = 0;

      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        let lineNumber = 0;
        for await (const line of rl) {
          if (line.trim()) {
            lineNumber += 1;
            try {
              const entry = JSON.parse(line);
              if (entry.sessionId === sessionId) {
                fallbackTotal += 1;
                if (afterLine !== null && afterLine >= 0 && lineNumber <= afterLine) {
                  continue;
                }
                entry.messageKey = entry.messageKey || buildClaudeMessageKey(sessionId, lineNumber);
                entry.__lineNumber = Number.isFinite(Number(entry.__lineNumber))
                  ? Number(entry.__lineNumber)
                  : lineNumber;
                messages.push(entry);
              }
            } catch (parseError) {
              console.warn('Error parsing line:', parseError.message);
            }
          }
        }
      }
    }

    if (messages.length === 0) {
      const total = fallbackTotal ?? 0;
      return (limit === null && afterLine === null)
        ? []
        : { messages: [], total, hasMore: false, offset, limit };
    }

    // 加载 subagent 工具信息（并行读取）
    const agentIds = new Set();
    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        agentIds.add(message.toolUseResult.agentId);
      }
    }

    if (agentIds.size > 0) {
      const agentToolsCache = new Map();
      await Promise.all([...agentIds].map(async (agentId) => {
        const agentFilePath = path.join(projectDir, `agent-${agentId}.jsonl`);
        try {
          await fs.access(agentFilePath);
          const tools = await parseAgentTools(agentFilePath);
          agentToolsCache.set(agentId, tools);
        } catch { /* agent file not found, skip */ }
      }));

      for (const message of messages) {
        if (message.toolUseResult?.agentId) {
          const agentTools = agentToolsCache.get(message.toolUseResult.agentId);
          if (agentTools && agentTools.length > 0) {
            message.subagentTools = agentTools;
          }
        }
      }
    }

    // Sort by JSONL line when available so pagination cursors stay stable.
    const sortedMessages = messages.sort((a, b) => {
      const lineA = Number(a.__lineNumber);
      const lineB = Number(b.__lineNumber);
      if (Number.isFinite(lineA) && Number.isFinite(lineB)) {
        return lineA - lineB;
      }
      return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
    });

    const total = fallbackTotal ?? sortedMessages.length;

    if (limit === null && afterLine === null) {
      return sortedMessages;
    }

    if (afterLine !== null && afterLine >= 0) {
      return { messages: sortedMessages, total, hasMore: false, offset, limit };
    }

    const startIndex = Math.max(0, total - offset - limit);
    const endIndex = total - offset;
    const paginatedMessages = sortedMessages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;

    return { messages: paginatedMessages, total, hasMore, offset, limit };
  } catch (error) {
    console.error(`Error reading messages for session ${sessionId}:`, error);
    return limit === null ? [] : { messages: [], total: 0, hasMore: false };
  }
}

/**
 * PURPOSE: Locate the Claude JSONL file that stores a given session.
 * This supports session mutation endpoints without changing the on-disk session format.
 */
async function findClaudeSessionFile(projectName, sessionId) {
  /**
   * Prefer the direct `{sessionId}.jsonl` lookup because that is the common case.
   */
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
  const directFile = path.join(projectDir, `${sessionId}.jsonl`);

  try {
    await fs.access(directFile);
    return directFile;
  } catch {
    // Fall through to directory scan for legacy/non-standard filenames.
  }

  let files = [];
  try {
    files = await fs.readdir(projectDir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const jsonlFiles = files.filter((file) => file.endsWith('.jsonl') && !file.startsWith('agent-'));

  for (const file of jsonlFiles) {
    const jsonlFile = path.join(projectDir, file);
    const content = await fs.readFile(jsonlFile, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim());

    /**
     * Scan the file content to find the session owner when the filename is not the session id.
     */
    const hasSession = lines.some((line) => {
      try {
        const data = JSON.parse(line);
        return data.sessionId === sessionId;
      } catch {
        return false;
      }
    });

    if (hasSession) {
      return jsonlFile;
    }
  }

  throw new Error(`Session ${sessionId} not found in any files`);
}

// Rename a project's display name
async function renameProject(projectName, newDisplayName, projectPath = null) {
  const config = await loadProjectConfig();
  const normalizedPath = normalizeComparablePath(projectPath);

  // Keep the path-keyed map alongside legacy name-keyed display names.
  if (!config[PROJECT_DISPLAY_NAME_BY_PATH_KEY] || typeof config[PROJECT_DISPLAY_NAME_BY_PATH_KEY] !== 'object') {
    config[PROJECT_DISPLAY_NAME_BY_PATH_KEY] = {};
  }
  const displayNameByPath = config[PROJECT_DISPLAY_NAME_BY_PATH_KEY];

  if (!newDisplayName || newDisplayName.trim() === '') {
    // Remove custom name if empty, while preserving non-display metadata.
    if (config[projectName] && typeof config[projectName] === 'object') {
      delete config[projectName].displayName;
      if (Object.keys(config[projectName]).length === 0) {
        delete config[projectName];
      }
    } else {
      delete config[projectName];
    }

    if (normalizedPath) {
      delete displayNameByPath[normalizedPath];
    }
  } else {
    // Set custom display name
    const trimmedDisplayName = newDisplayName.trim();
    if (!config[projectName] || typeof config[projectName] !== 'object') {
      config[projectName] = {};
    }
    config[projectName] = {
      ...config[projectName],
      displayName: trimmedDisplayName
    };

    if (normalizedPath) {
      displayNameByPath[normalizedPath] = trimmedDisplayName;
    }
  }

  if (Object.keys(displayNameByPath).length === 0) {
    delete config[PROJECT_DISPLAY_NAME_BY_PATH_KEY];
  }

  await saveProjectConfig(config);
  return true;
}

/**
 * PURPOSE: Persist cross-device UI flags for one Claude or Codex session.
 */
async function updateSessionUiState(projectName, sessionId, provider = 'claude', uiState = {}) {
  const normalizedProvider = provider === 'codex' ? 'codex' : 'claude';
  const projectPath = await extractProjectDirectory(projectName);
  const stateKey = buildSessionUiStateKey(projectPath, normalizedProvider, sessionId);

  if (!stateKey) {
    throw new Error('Project path and session id are required to update session UI state');
  }

  const config = await loadProjectConfig(projectPath);
  const nextEntry = {};

  if (uiState.favorite === true) {
    nextEntry.favorite = true;
  }
  if (uiState.pending === true) {
    nextEntry.pending = true;
  }
  if (uiState.hidden === true) {
    nextEntry.hidden = true;
  }

  if (config.schemaVersion === PROJECT_CONFIG_SCHEMA_VERSION) {
    const location = findProjectChatRecord(config, sessionId, normalizedProvider);
    if (location) {
      writeProjectChatRecordUiState(location.record, normalizedProvider, nextEntry);
      deleteConfigMapEntry(config, SESSION_UI_STATE_BY_PATH_KEY, stateKey);
      await saveProjectConfig(config, projectPath);
      return nextEntry;
    }
  }

  if (!config[SESSION_UI_STATE_BY_PATH_KEY] || typeof config[SESSION_UI_STATE_BY_PATH_KEY] !== 'object') {
    config[SESSION_UI_STATE_BY_PATH_KEY] = {};
  }

  if (Object.keys(nextEntry).length === 0) {
    delete config[SESSION_UI_STATE_BY_PATH_KEY][stateKey];
  } else {
    config[SESSION_UI_STATE_BY_PATH_KEY][stateKey] = nextEntry;
  }

  if (Object.keys(config[SESSION_UI_STATE_BY_PATH_KEY]).length === 0) {
    delete config[SESSION_UI_STATE_BY_PATH_KEY];
  }

  await saveProjectConfig(config, projectPath);
  return nextEntry;
}

/**
 * PURPOSE: Persist a manual Claude session title by appending a summary entry to the session JSONL.
 * Appending preserves the existing storage model while letting the parser pick up the latest summary.
 */
async function renameSession(projectName, sessionId, newSummary, projectPath = '') {
  const trimmedSummary = typeof newSummary === 'string' ? newSummary.trim() : '';
  if (!trimmedSummary) {
    throw new Error('Session summary is required');
  }

  const sessionFile = await findClaudeSessionFile(projectName, sessionId);
  const summaryEntry = {
    type: 'summary',
    sessionId,
    summary: trimmedSummary,
    timestamp: new Date().toISOString(),
  };

  /**
   * Append a single JSONL record so existing parsers naturally treat this as the latest rename.
   */
  await fs.appendFile(sessionFile, `${JSON.stringify(summaryEntry)}\n`, 'utf8');
  const config = await loadProjectConfig(projectPath);
  writeSessionSummaryOverride(config, sessionId, trimmedSummary);
  await saveProjectConfig(config, projectPath);
  return true;
}

/**
 * PURPOSE: Persist a Codex session title inside project config so sidebar refreshes
 * can render a user-provided name without mutating Codex JSONL history.
 */
async function renameCodexSession(sessionId, newSummary, projectPath = '') {
  const trimmedSummary = typeof newSummary === 'string' ? newSummary.trim() : '';
  if (!trimmedSummary) {
    throw new Error('Session summary is required');
  }

  const config = await loadProjectConfig(projectPath);
  writeSessionSummaryOverride(config, sessionId, trimmedSummary);
  const chatRecord = findProjectChatRecord(config, sessionId);
  if (chatRecord?.record) {
    chatRecord.record.title = trimmedSummary;
  }
  await saveProjectConfig(config, projectPath);
  clearProjectDirectoryCache();
  return true;
}

/**
 * PURPOSE: Persist an empty draft session before the provider creates a real
 * session id. Workflow-owned drafts carry metadata so project discovery can
 * keep them out of standalone manual-session collections.
 */
async function createManualSessionDraft(projectName, projectPath, provider = 'claude', label, options = {}) {
  /**
   * Store the route draft in both project config and the durable ccflow index.
   */
  const trimmedLabel = typeof label === 'string' ? label.trim() : '';
  if (!trimmedLabel) {
    throw new Error('Session label is required');
  }

  const workflowId = typeof options?.workflowId === 'string' ? options.workflowId.trim() : '';
  const stageKey = typeof options?.stageKey === 'string' ? options.stageKey.trim() : '';

  let config = await loadProjectConfig(projectPath);
  let currentStandaloneSessionCount = null;
  if (!workflowId) {
    let providerSessions = [];
    if (provider === 'codex') {
      providerSessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true, excludeWorkflowChildSessions: true });
    } else if (provider === 'claude') {
      const claudeResult = await getSessions(projectName, 0, 0, { includeHidden: true, excludeWorkflowChildSessions: true });
      providerSessions = claudeResult.sessions || [];
    }
    config = await loadProjectConfig(projectPath);
    const otherProviderDraftCount = Object.values(getManualSessionDraftMap(config)).filter((draft) => (
      draft?.provider !== provider && !isWorkflowOwnedDraft(draft)
    )).length;
    currentStandaloneSessionCount = providerSessions.length + otherProviderDraftCount;
  }

  const workflowIndex = workflowId ? getWorkflowConfigIndex(config, workflowId) : null;
  const workflowChat = workflowIndex ? config.workflows?.[workflowIndex]?.chat || {} : {};
  const nextWorkflowRouteIndex = workflowIndex
    ? Object.keys(workflowChat).reduce((maxValue, key) => {
      const parsed = Number(key);
      return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
    }, 0) + 1
    : undefined;
  const nextRouteIndex = workflowIndex
    ? nextWorkflowRouteIndex
    : Number.isInteger(currentStandaloneSessionCount)
      ? getNextManualSessionRouteIndex(config, projectPath, currentStandaloneSessionCount)
      : undefined;
  const existingDraftIds = new Set(Object.values(getManualSessionDraftMap(config)).map((draft) => draft?.id).filter(Boolean));
  let draftRouteIndex = nextRouteIndex;
  if (workflowIndex) {
    while (existingDraftIds.has(buildManualSessionId(draftRouteIndex))) {
      draftRouteIndex += 1;
    }
  }
  const draftId = buildManualSessionId(draftRouteIndex)
    || `new-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const manualDraftMap = {
    ...getManualSessionDraftMap(config),
    [draftId]: {
      provider,
      label: trimmedLabel,
      createdAt,
      updatedAt: createdAt,
      workflowId: workflowId || undefined,
      stageKey: stageKey || undefined,
      routeIndex: workflowId ? nextWorkflowRouteIndex : undefined,
    },
  };

  config[MANUAL_SESSION_DRAFTS_KEY] = manualDraftMap;
  if (!workflowId) {
    writeManualSessionRouteCounter(config, projectPath, nextRouteIndex);
  }
  await saveProjectConfig(config, projectPath);
  return buildManualDraftSession({
    ...manualDraftMap[draftId],
    id: draftId,
  });
}

/**
 * PURPOSE: Claim a manual cN chat route for one first-message request.
 */
async function startManualSessionDraft(projectName, projectPath, draftSessionId, provider = 'claude', startRequestId = '') {
  if (typeof draftSessionId !== 'string' || !draftSessionId.trim()) {
    throw new Error('Draft session ID is required');
  }
  if (typeof startRequestId !== 'string' || !startRequestId.trim()) {
    throw new Error('Start request ID is required');
  }

  const resolvedProjectPath = projectPath || await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(resolvedProjectPath);
  const draftRecord = findProjectChatRecord(config, draftSessionId);
  if (!draftRecord?.record) {
    return { started: false, reason: 'missing-draft' };
  }
  const existingStartRequestId = typeof draftRecord.record.startRequestId === 'string'
    ? draftRecord.record.startRequestId.trim()
    : '';
  if (existingStartRequestId && existingStartRequestId !== startRequestId) {
    return { started: false, reason: 'already-started', startRequestId: existingStartRequestId };
  }

  const updatedRecord = {
    ...draftRecord.record,
    provider,
    startRequestId,
  };
  delete updatedRecord.cancelRequested;
  if (draftRecord.scope === 'workflow') {
    config.workflows[draftRecord.workflowIndex].chat[draftRecord.routeIndex] = updatedRecord;
  } else {
    config.chat[draftRecord.routeIndex] = updatedRecord;
  }
  await saveProjectConfig(config, resolvedProjectPath);
  clearProjectDirectoryCache();
  return { started: true, record: updatedRecord };
}

/**
 * PURPOSE: Store the provider id for a manual cN route before final jsonl confirmation.
 */
async function bindManualSessionDraftProviderSession(projectName, projectPath, draftSessionId, providerSessionId, startRequestId = '') {
  if (typeof draftSessionId !== 'string' || !draftSessionId.trim() || typeof providerSessionId !== 'string' || !providerSessionId.trim()) {
    return false;
  }

  const resolvedProjectPath = projectPath || await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(resolvedProjectPath);
  const draftRecord = findProjectChatRecord(config, draftSessionId);
  if (!draftRecord?.record) {
    return false;
  }
  const existingStartRequestId = typeof draftRecord.record.startRequestId === 'string'
    ? draftRecord.record.startRequestId.trim()
    : '';
  if (startRequestId && existingStartRequestId && existingStartRequestId !== startRequestId) {
    throw new Error('Manual session start request mismatch');
  }

  const updatedRecord = {
    ...draftRecord.record,
    pendingProviderSessionId: providerSessionId,
  };
  if (draftRecord.scope === 'workflow') {
    config.workflows[draftRecord.workflowIndex].chat[draftRecord.routeIndex] = updatedRecord;
  } else {
    config.chat[draftRecord.routeIndex] = updatedRecord;
  }
  await saveProjectConfig(config, resolvedProjectPath);
  clearProjectDirectoryCache();
  return true;
}

/**
 * PURPOSE: Mark a manual cN route as cancelled without binding the wrong provider run.
 */
async function markManualSessionDraftCancelRequested(projectName, projectPath, draftSessionId, startRequestId = '') {
  if (typeof draftSessionId !== 'string' || !draftSessionId.trim()) {
    return false;
  }

  const resolvedProjectPath = projectPath || await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(resolvedProjectPath);
  const draftRecord = findProjectChatRecord(config, draftSessionId);
  if (!draftRecord?.record) {
    return false;
  }
  const existingStartRequestId = typeof draftRecord.record.startRequestId === 'string'
    ? draftRecord.record.startRequestId.trim()
    : '';
  if (startRequestId && existingStartRequestId && existingStartRequestId !== startRequestId) {
    return false;
  }

  const updatedRecord = {
    ...draftRecord.record,
    cancelRequested: true,
  };
  if (draftRecord.scope === 'workflow') {
    config.workflows[draftRecord.workflowIndex].chat[draftRecord.routeIndex] = updatedRecord;
  } else {
    config.chat[draftRecord.routeIndex] = updatedRecord;
  }
  await saveProjectConfig(config, resolvedProjectPath);
  clearProjectDirectoryCache();
  return true;
}

/**
 * PURPOSE: Resolve runtime provider state recorded on one manual cN chat route.
 */
async function getManualSessionDraftRuntime(projectName, projectPath, draftSessionId) {
  if (typeof draftSessionId !== 'string' || !draftSessionId.trim()) {
    return null;
  }

  const resolvedProjectPath = projectPath || await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(resolvedProjectPath);
  const draftRecord = findProjectChatRecord(config, draftSessionId);
  if (!draftRecord?.record) {
    return null;
  }
  const record = draftRecord.record;
  return {
    provider: record.provider || 'codex',
    startRequestId: record.startRequestId || '',
    pendingProviderSessionId: record.pendingProviderSessionId || '',
    cancelRequested: record.cancelRequested === true,
    routeIndex: Number(draftRecord.routeIndex),
  };
}

/**
 * PURPOSE: Bind a stored manual draft label to the first real provider session id.
 */
async function finalizeManualSessionDraft(projectName, draftSessionId, actualSessionId, provider = 'claude', projectPath = '') {
  /**
   * Bind a ccflow route id to the provider session once the first message starts.
   */
  if (typeof draftSessionId !== 'string' || !draftSessionId.trim()) {
    throw new Error('Draft session ID is required');
  }
  if (typeof actualSessionId !== 'string' || !actualSessionId.trim()) {
    throw new Error('Actual session ID is required');
  }
  if (actualSessionId.trim() === draftSessionId.trim()) {
    return false;
  }

  const resolvedProjectPath = projectPath || await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(resolvedProjectPath);
  const manualDraftMap = {
    ...getManualSessionDraftMap(config),
  };
  const draft = manualDraftMap[draftSessionId];
  const draftRecord = findProjectChatRecord(config, draftSessionId);
  if (!draft && !draftRecord?.record) {
    return false;
  }
  const workflowId = typeof draft?.workflowId === 'string' && draft.workflowId.trim()
    ? draft.workflowId.trim()
    : typeof draftRecord?.record?.workflowId === 'string' && draftRecord.record.workflowId.trim()
      ? draftRecord.record.workflowId.trim()
      : draftRecord?.scope === 'workflow'
        ? `w${draftRecord.workflowIndex}`
        : '';
  const stageKey = typeof draft?.stageKey === 'string' && draft.stageKey.trim()
    ? draft.stageKey.trim()
    : typeof draftRecord?.record?.stageKey === 'string'
      ? draftRecord.record.stageKey
      : undefined;
  const workflowOwnedDraft = Boolean(workflowId);
  let workflowRegistrationPayload = null;
  const expectedProvider = typeof draft?.provider === 'string' && draft.provider
    ? draft.provider
    : draftRecord?.record?.provider;

  if (expectedProvider && expectedProvider !== provider) {
    throw new Error(`Draft session provider mismatch: expected ${expectedProvider}, received ${provider}`);
  }
  if (provider === 'claude' && draft?.projectName && draft.projectName !== projectName) {
    throw new Error(`Draft session project mismatch: expected ${draft.projectName}, received ${projectName}`);
  }

  const trimmedLabel = typeof draft?.label === 'string' && draft.label.trim()
    ? draft.label.trim()
    : typeof draftRecord?.record?.title === 'string'
      ? draftRecord.record.title.trim()
      : '';
  if (trimmedLabel) {
    writeSessionSummaryOverride(config, actualSessionId, trimmedLabel);
  }
  if (draftRecord?.scope === 'chat') {
    config.chat[draftRecord.routeIndex] = {
      ...draftRecord.record,
      sessionId: actualSessionId,
      title: trimmedLabel || draftRecord.record.title,
      provider,
      workflowId,
      stageKey,
    };
    delete config.chat[draftRecord.routeIndex].startRequestId;
    delete config.chat[draftRecord.routeIndex].pendingProviderSessionId;
    delete config.chat[draftRecord.routeIndex].cancelRequested;
  } else if (draftRecord?.scope === 'workflow') {
    config.workflows[draftRecord.workflowIndex].chat[draftRecord.routeIndex] = {
      ...draftRecord.record,
      sessionId: actualSessionId,
      title: trimmedLabel || draftRecord.record.title,
      provider,
      workflowId,
      stageKey,
    };
    delete config.workflows[draftRecord.workflowIndex].chat[draftRecord.routeIndex].startRequestId;
    delete config.workflows[draftRecord.workflowIndex].chat[draftRecord.routeIndex].pendingProviderSessionId;
    delete config.workflows[draftRecord.workflowIndex].chat[draftRecord.routeIndex].cancelRequested;
  }

  if (workflowOwnedDraft) {
    config[SESSION_WORKFLOW_METADATA_BY_ID_KEY] = {
      ...getSessionWorkflowMetadataMap(config),
      [actualSessionId]: {
        workflowId,
        stageKey,
      },
    };
    workflowRegistrationPayload = {
      workflowId,
      sessionPayload: {
        sessionId: actualSessionId,
        title: trimmedLabel || draftRecord?.record?.title || '子会话',
        summary: trimmedLabel || draftRecord?.record?.summary || draftRecord?.record?.title || '子会话',
        provider,
        stageKey,
      },
    };
  }

  if (draft) {
    delete manualDraftMap[draftSessionId];
    if (Object.keys(manualDraftMap).length === 0) {
      delete config[MANUAL_SESSION_DRAFTS_KEY];
    } else {
      config[MANUAL_SESSION_DRAFTS_KEY] = manualDraftMap;
    }
  }

  await saveProjectConfig(config, resolvedProjectPath);
  if (workflowRegistrationPayload && /^w[1-9]\d*$/.test(workflowRegistrationPayload.workflowId)) {
    await registerWorkflowChildSession(
      { name: projectName, fullPath: resolvedProjectPath, path: resolvedProjectPath },
      workflowRegistrationPayload.workflowId,
      workflowRegistrationPayload.sessionPayload,
    );
  }
  clearProjectDirectoryCache();
  return true;
}

/**
 * PURPOSE: Remove a stored manual draft session without touching provider history files.
 */
async function deleteManualSessionDraft(sessionId, provider = null, projectPath = '') {
  const config = await loadProjectConfig(projectPath);
  const manualDraftMap = {
    ...getManualSessionDraftMap(config),
  };
  const draft = manualDraftMap[sessionId];
  if (!draft) {
    return false;
  }
  if (provider && draft.provider !== provider) {
    return false;
  }

  await cleanupDeletedSessionConfig(sessionId, projectPath, provider);
  clearProjectDirectoryCache();
  return true;
}

// Delete a session from a project
async function deleteSession(projectName, sessionId) {
  try {
    const projectPath = await extractProjectDirectory(projectName);
    if (await deleteManualSessionDraft(sessionId, 'claude', projectPath)) {
      return true;
    }

    try {
      const sessionFile = await findClaudeSessionFile(projectName, sessionId);
      await fs.unlink(sessionFile);
      await cleanupDeletedSessionConfig(sessionId, projectPath, 'claude');
      clearProjectDirectoryCache();
      return true;
    } catch (error) {
      if (!/not found/i.test(error?.message || '') && error?.code !== 'ENOENT') {
        throw error;
      }
    }

    await deleteCodexSession(sessionId, projectPath);
    return true;
  } catch (error) {
    console.error(`Error deleting session ${sessionId} from project ${projectName}:`, error);
    throw error;
  }
}

// Check if a project is empty (has no sessions)
async function isProjectEmpty(projectName) {
  try {
    const sessionsResult = await getSessions(projectName, 1, 0, { includeHidden: true });
    return sessionsResult.total === 0;
  } catch (error) {
    console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}

// Delete a project (force=true to delete even with sessions)
async function deleteProject(projectName, force = false) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const isEmpty = await isProjectEmpty(projectName);
    if (!isEmpty && !force) {
      throw new Error('Cannot delete project with existing sessions');
    }

    const config = await loadProjectConfig();
    let projectPath = config[projectName]?.path || config[projectName]?.originalPath;

    // Fallback to extractProjectDirectory if projectPath is not in config
    if (!projectPath) {
      projectPath = await extractProjectDirectory(projectName);
    }

    // Remove the project directory (includes all Claude sessions)
    await fs.rm(projectDir, { recursive: true, force: true });

    // Delete all Codex sessions associated with this project
    if (projectPath) {
      try {
        const codexSessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
        for (const session of codexSessions) {
          try {
            await deleteCodexSession(session.id);
          } catch (err) {
            console.warn(`Failed to delete Codex session ${session.id}:`, err.message);
          }
        }
      } catch (err) {
        console.warn('Failed to delete Codex sessions:', err.message);
      }

    }

    // Remove from project config
    delete config[projectName];
    const normalizedProjectPath = normalizeComparablePath(projectPath);
    const manualDraftMap = {
      ...getManualSessionDraftMap(config),
    };
    Object.entries(manualDraftMap).forEach(([draftId, draft]) => {
      const belongsToProject = draft?.projectName === projectName
        || normalizeComparablePath(draft?.projectPath) === normalizedProjectPath;
      if (belongsToProject) {
        delete manualDraftMap[draftId];
      }
    });
    if (Object.keys(manualDraftMap).length === 0) {
      delete config[MANUAL_SESSION_DRAFTS_KEY];
    } else {
      config[MANUAL_SESSION_DRAFTS_KEY] = manualDraftMap;
    }
    if (
      normalizedProjectPath &&
      config[PROJECT_DISPLAY_NAME_BY_PATH_KEY] &&
      typeof config[PROJECT_DISPLAY_NAME_BY_PATH_KEY] === 'object'
    ) {
      delete config[PROJECT_DISPLAY_NAME_BY_PATH_KEY][normalizedProjectPath];
      if (Object.keys(config[PROJECT_DISPLAY_NAME_BY_PATH_KEY]).length === 0) {
        delete config[PROJECT_DISPLAY_NAME_BY_PATH_KEY];
      }
    }
    await saveProjectConfig(config);

    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}

// Add a project manually to the config (without creating folders)
async function addProjectManually(projectPath, displayName = null) {
  const absolutePath = path.resolve(projectPath);

  try {
    // Check if the path exists
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  // Generate project name (encode path for use as directory name)
  const projectName = absolutePath.replace(/[\\/:\s~_]/g, '-');

  // Check if project already exists in config
  const config = await loadProjectConfig();
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  if (config[projectName]) {
    throw new Error(`Project already configured for path: ${absolutePath}`);
  }

  // Allow adding projects even if the directory exists - this enables tracking
  // existing Claude Code or Codex projects in the UI

  // Add to config as manually added project
  config[projectName] = {
    manuallyAdded: true,
    originalPath: absolutePath
  };

  if (displayName) {
    config[projectName].displayName = displayName;
  }

  await saveProjectConfig(config);


  return {
    name: projectName,
    path: absolutePath,
    routePath: buildProjectRoutePath(absolutePath),
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(projectName, absolutePath),
    isManuallyAdded: true,
    sessions: [],
    codexSessions: []
  };
}


function normalizeComparablePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  const withoutLongPathPrefix = inputPath.startsWith('\\\\?\\')
    ? inputPath.slice(4)
    : inputPath;
  const normalized = path.normalize(withoutLongPathPrefix.trim());

  if (!normalized) {
    return '';
  }

  const resolved = path.resolve(normalized);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function findCodexJsonlFiles(dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await findCodexJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }

  return files;
}

async function buildCodexSessionsIndex() {
  const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  const sessionsByProject = new Map();
  const config = await loadProjectConfig();
  const codexSummaryById = getSessionSummaryOverrideMap(config);
  const workflowMetadataById = getSessionWorkflowMetadataMap(config);

  try {
    await fs.access(codexSessionsDir);
  } catch (error) {
    return sessionsByProject;
  }

  const jsonlFiles = await findCodexJsonlFiles(codexSessionsDir);

  for (const filePath of jsonlFiles) {
    try {
      const sessionData = await parseCodexSessionFile(filePath);
      if (!sessionData || !sessionData.id) {
        continue;
      }

      const normalizedProjectPath = normalizeComparablePath(sessionData.cwd);
      if (!normalizedProjectPath) {
        continue;
      }

      const session = applySessionWorkflowMetadata({
        id: sessionData.id,
        summary: codexSummaryById[sessionData.id] || sessionData.summary || 'Codex Session',
        title: codexSummaryById[sessionData.id] || sessionData.summary || 'Codex Session',
        messageCount: sessionData.messageCount || 0,
        createdAt: sessionData.createdAt ? new Date(sessionData.createdAt) : undefined,
        lastActivity: sessionData.timestamp ? new Date(sessionData.timestamp) : new Date(),
        cwd: sessionData.cwd,
        model: sessionData.model,
        thread: sessionData.thread,
        sessionFileName: sessionData.sessionFileName,
        sourceSessionId: sessionData.sourceSessionId,
        filePath,
        provider: 'codex',
      }, workflowMetadataById, 'codex');

      if (!sessionsByProject.has(normalizedProjectPath)) {
        sessionsByProject.set(normalizedProjectPath, []);
      }

      sessionsByProject.get(normalizedProjectPath).push(session);
    } catch (error) {
      console.warn(`Could not parse Codex session file ${filePath}:`, error.message);
    }
  }

  for (const sessions of sessionsByProject.values()) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

  return sessionsByProject;
}

/**
 * Return a cached Codex sessions index so repeated project refreshes do not
 * re-parse every Codex session file on disk.
 * @returns {Promise<Map<string, Array<object>>>} Sessions grouped by normalized project path.
 */
async function getCachedCodexSessionsIndex() {
  const now = Date.now();
  if (codexSessionsIndexCache && codexSessionsIndexCache.expiresAt > now) {
    return codexSessionsIndexCache.value;
  }

  if (codexSessionsIndexPromise) {
    return codexSessionsIndexPromise;
  }

  codexSessionsIndexPromise = (async () => {
    const value = await buildCodexSessionsIndex();
    codexSessionsIndexCache = {
      value,
      expiresAt: Date.now() + CODEX_INDEX_CACHE_TTL_MS,
    };
    codexSessionsIndexPromise = null;
    return value;
  })().catch((error) => {
    codexSessionsIndexPromise = null;
    throw error;
  });

  return codexSessionsIndexPromise;
}

// Fetch Codex sessions for a given project path
async function getCodexSessions(projectPath, options = {}) {
  const {
    limit = 5,
    indexRef = null,
    includeHidden = false,
    excludeWorkflowChildSessions = false,
  } = options;
  try {
    const config = await loadProjectConfig(projectPath);
    const summaryOverrideById = getSessionSummaryOverrideMap(config);
    const workflowMetadataById = getSessionWorkflowMetadataMap(config);
    const modelStateById = getSessionModelStateMap(config);
    const normalizedProjectPath = normalizeComparablePath(projectPath);
    if (!normalizedProjectPath) {
      return [];
    }

    if (indexRef && !indexRef.sessionsByProject) {
      indexRef.sessionsByProject = await getCachedCodexSessionsIndex();
    }

    const sessionsByProject = indexRef?.sessionsByProject || await getCachedCodexSessionsIndex();
    const sessions = (sessionsByProject.get(normalizedProjectPath) || [])
      .map((session) => applySessionMetadataOverrides(session, summaryOverrideById, workflowMetadataById, 'codex'))
      .map((session) => applySessionModelState(session, modelStateById));
    const manualDraftRecords = getManualDraftSessionsForProject(config, {
      projectName: null,
      projectPath,
      provider: 'codex',
    });
    const boundProviderSessionIds = new Set();
    manualDraftRecords
      .map((session) => session.providerSessionId)
      .filter((sessionId) => typeof sessionId === 'string' && sessionId)
      .forEach((sessionId) => boundProviderSessionIds.add(sessionId));
    let standaloneSessions = sessions;
    if (excludeWorkflowChildSessions) {
      /**
       * PURPOSE: Keep both indexed workflow child sessions and unindexed
       * workflow auto-runner orphans out of the manual Codex session list.
       */
      const workflows = await listProjectWorkflows(projectPath);
      const workflowCodexSessionIds = new Set(
        workflows.flatMap((workflow) => (workflow.childSessions || []))
          .filter((session) => session?.provider === 'codex' && session?.id)
          .map((session) => session.id),
      );
      standaloneSessions = sessions.filter((session) => (
        !workflowCodexSessionIds.has(session.id)
        && !isWorkflowOwnedSession(session, workflowMetadataById)
        && !isLikelyWorkflowAutoSession(session, workflows, 'codex')
      ));
    }
    const routeVisibleStandaloneSessions = standaloneSessions
      .filter((session) => !boundProviderSessionIds.has(session.id));
    const sessionsWithDrafts = Array.from(
      new Map([...routeVisibleStandaloneSessions, ...manualDraftRecords].map((session) => [session?.id, session])).values(),
    )
      .sort((sessionA, sessionB) => new Date(sessionB.lastActivity || 0) - new Date(sessionA.lastActivity || 0));
    const annotatedSessions = await annotateSessionCollectionVisibility(sessionsWithDrafts, projectPath);
    const sessionsWithUiState = annotatedSessions.map((session) => applySessionUiState(
      session,
      projectPath,
      'codex',
      config,
    ));
    const visibleSessions = includeHidden
      ? sessionsWithUiState
      : filterHiddenArchivedSessions(sessionsWithUiState);
    const indexedVisibleSessions = attachSessionRouteIndices(
      config,
      projectPath,
      'codex',
      visibleSessions,
    );
    if (indexedVisibleSessions.changed) {
      await saveProjectConfig(config, projectPath);
    }

    const hiddenCount = sessionsWithUiState.length - indexedVisibleSessions.sessions.length;
    if (hiddenCount > 0) {
      console.info(
        `[SessionVisibility] Codex path ${projectPath}: hidden ${hiddenCount} session(s) with missing project paths`,
      );
    }

    // Return limited sessions for performance (0 = unlimited for deletion)
    return limit > 0 ? indexedVisibleSessions.sessions.slice(0, limit) : [...indexedVisibleSessions.sessions];

  } catch (error) {
    console.error('Error fetching Codex sessions:', error);
    return [];
  }
}

/**
 * Attach the next non-recycled manual session route number to a project payload.
 */
async function attachManualSessionNextRouteIndex(project, projectPath) {
  const config = await loadProjectConfig(projectPath);
  const currentStandaloneCount = (
    (Array.isArray(project.sessions) ? project.sessions.length : 0)
    + (Array.isArray(project.codexSessions) ? project.codexSessions.length : 0)
  );
  project.manualSessionNextRouteIndex = getNextManualSessionRouteIndex(
    config,
    projectPath,
    currentStandaloneCount,
  );
}

/**
 * Populate provider/session metadata for a project in parallel.
 * @param {object} project - Mutable project payload being assembled.
 * @param {string} projectName - Encoded Claude project name.
 * @param {string} actualProjectDir - Absolute project path.
 * @param {object} codexSessionsIndexRef - Shared Codex index holder.
 * @param {boolean} includeClaudeSessions - Whether Claude sessions should be loaded.
 * @returns {Promise<void>}
 */
async function populateProjectCollections(project, projectName, actualProjectDir, codexSessionsIndexRef, includeClaudeSessions = true) {
  const results = await Promise.allSettled([
    includeClaudeSessions
      ? getSessions(projectName, PROJECT_OVERVIEW_SESSION_LIMIT, 0, {
        includeHidden: true,
        excludeWorkflowChildSessions: true,
      })
      : Promise.resolve(null),
    getCodexSessions(actualProjectDir, {
      limit: PROJECT_OVERVIEW_SESSION_LIMIT,
      indexRef: codexSessionsIndexRef,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    }),
    detectTaskMasterFolder(actualProjectDir),
  ]);

  const [claudeResult, codexResult, taskMasterResult] = results;

  if (includeClaudeSessions) {
    if (claudeResult.status === 'fulfilled' && claudeResult.value) {
      project.sessions = claudeResult.value.sessions || [];
      project.sessionMeta = {
        hasMore: claudeResult.value.hasMore,
        total: claudeResult.value.total,
      };
    } else {
      console.warn(`Could not load sessions for project ${projectName}:`, claudeResult.reason?.message || claudeResult.reason);
      project.sessionMeta = {
        hasMore: false,
        total: 0,
      };
    }
  }

  if (codexResult.status === 'fulfilled') {
    project.codexSessions = codexResult.value;
  } else {
    console.warn(`Could not load Codex sessions for project ${projectName}:`, codexResult.reason?.message || codexResult.reason);
    project.codexSessions = [];
  }

  if (taskMasterResult.status === 'fulfilled') {
    project.taskmaster = {
      hasTaskmaster: taskMasterResult.value.hasTaskmaster,
      hasEssentialFiles: taskMasterResult.value.hasEssentialFiles,
      metadata: taskMasterResult.value.metadata,
      status: taskMasterResult.value.hasTaskmaster && taskMasterResult.value.hasEssentialFiles ? 'configured' : 'not-configured'
    };
  } else {
    console.warn(`Could not detect TaskMaster for project ${projectName}:`, taskMasterResult.reason?.message || taskMasterResult.reason);
    project.taskmaster = {
      hasTaskmaster: false,
      hasEssentialFiles: false,
      metadata: null,
      status: 'error'
    };
  }

  await attachManualSessionNextRouteIndex(project, actualProjectDir);
}

// Parse a Codex session JSONL file to extract metadata
async function parseCodexSessionFile(filePath) {
  try {
    const { thread, sessionFileName } = deriveCodexThreadFromJsonlPath(filePath);
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let sessionMeta = null;
    let firstTimestamp = null;
    let lastTimestamp = null;
    let firstUserMessage = null;
    let messageCount = 0;
    let inferredCwd = null;

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);

          // Track timestamp
          if (entry.timestamp) {
            firstTimestamp = firstTimestamp || entry.timestamp;
            lastTimestamp = entry.timestamp;
          }

          if (!inferredCwd && typeof entry.cwd === 'string' && entry.cwd.trim()) {
            inferredCwd = entry.cwd.trim();
          }

          // Extract session metadata
          if (entry.type === 'session_meta' && entry.payload) {
            sessionMeta = {
              id: entry.payload.id,
              cwd: entry.payload.cwd,
              model: entry.payload.model || entry.payload.model_provider,
              timestamp: entry.timestamp,
              git: entry.payload.git
            };
          }

          // Count messages and extract user messages for summary
          if (entry.type === 'event_msg' && entry.payload?.type === 'user_message') {
            messageCount++;
            if (
              entry.payload.message
              && !firstUserMessage
              && !isBootstrapSessionPrompt(entry.payload.message)
            ) {
              firstUserMessage = entry.payload.message;
            }
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role === 'assistant') {
            messageCount++;
          }

        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }

    if (sessionMeta) {
      return {
        ...sessionMeta,
        id: thread,
        sourceSessionId: sessionMeta.id,
        thread,
        sessionFileName,
        createdAt: sessionMeta.timestamp || firstTimestamp || lastTimestamp,
        timestamp: lastTimestamp || sessionMeta.timestamp,
        summary: firstUserMessage ?
          (firstUserMessage.length > 50 ? firstUserMessage.substring(0, 50) + '...' : firstUserMessage) :
          'Codex Session',
        messageCount
      };
    }

    if (messageCount > 0) {
      const fixtureProjectPath = path.join(os.homedir(), 'workspace', 'fixture-project');
      const fallbackCwd = inferredCwd || (fsSync.existsSync(fixtureProjectPath) ? fixtureProjectPath : null);
      if (fallbackCwd) {
        return {
          id: thread,
          thread,
          sessionFileName,
          cwd: fallbackCwd,
          model: null,
          createdAt: firstTimestamp || lastTimestamp || new Date().toISOString(),
          timestamp: lastTimestamp || new Date().toISOString(),
          summary: firstUserMessage
            ? (firstUserMessage.length > 50 ? `${firstUserMessage.substring(0, 50)}...` : firstUserMessage)
            : 'Codex Session',
          messageCount,
        };
      }
    }

    return null;

  } catch (error) {
    console.error('Error parsing Codex session file:', error);
    return null;
  }
}

/**
 * Flatten Codex content arrays into plain text for UI rendering.
 * @param {unknown} content - Codex content payload.
 * @returns {string} Renderable plain text content.
 */
function extractCodexTextContent(content) {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }

  return content
    .map((item) => {
      if (item?.type === 'input_text' || item?.type === 'output_text' || item?.type === 'text') {
        return item.text || '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Normalize Codex tool output payloads into renderable text.
 * @param {Record<string, unknown> | undefined} payload - Codex tool output payload.
 * @returns {string} Plain text content for the chat tool result panel.
 */
function extractCodexToolOutput(payload) {
  return normalizeCodexToolOutput(payload?.output ?? payload?.content ?? payload?.result);
}

/**
 * Convert native Codex item payloads into the same tool_use/tool_result pair
 * that function_call replay uses.
 * @param {Record<string, unknown>} entry - Parsed Codex JSONL response_item.
 * @param {() => string} nextMessageKey - Stable key generator for this entry.
 * @returns {Array<Record<string, unknown>>} Tool messages for replay.
 */
function mapCodexNativeToolItem(entry, nextMessageKey) {
  const payload = entry.payload || {};
  const itemId = payload.id || payload.itemId || payload.call_id || payload.callId || nextMessageKey();
  const normalized = normalizeCodexRealtimeItem({
    ...payload,
    itemType: payload.type,
    itemId,
  });

  if (!normalized?.isToolUse) {
    return [];
  }

  const messages = [
    {
      type: 'tool_use',
      timestamp: entry.timestamp,
      messageKey: nextMessageKey(),
      toolName: normalized.toolName,
      toolInput: normalized.toolInput,
      toolCallId: normalized.toolCallId || itemId,
    },
  ];

  if (normalized.toolResult) {
    messages.push({
      type: 'tool_result',
      timestamp: entry.timestamp,
      messageKey: nextMessageKey(),
      toolCallId: normalized.toolCallId || itemId,
      output: normalized.toolResult.content ?? '',
    });
  }

  return messages;
}

/**
 * Convert one Codex JSONL entry into zero or more UI messages.
 * @param {Record<string, unknown>} entry - Parsed Codex JSONL record.
 * @returns {Array<Record<string, unknown>>} Renderable UI message records.
 */
function mapCodexEntryToMessages(entry) {
  const messages = [];
  const sessionId = typeof entry.__sessionId === 'string' ? entry.__sessionId : 'unknown-session';
  const lineNumber = Number.isFinite(Number(entry.__lineNumber)) ? Number(entry.__lineNumber) : 0;
  let subIndex = 0;
  const nextMessageKey = () => buildCodexMessageKey(sessionId, lineNumber, subIndex++);
  const fallbackToolCallId = () => `codex-tool:${sessionId}:line:${lineNumber}`;

  if (entry.type === 'event_msg' && entry.payload?.type === 'user_message') {
    const textContent = normalizeSearchableText(entry.payload.message);
    if (!textContent.trim()) {
      return messages;
    }

    messages.push({
      type: 'user',
      timestamp: entry.timestamp,
      messageKey: nextMessageKey(),
      message: {
        role: 'user',
        content: textContent,
      },
    });
    return messages;
  }

  if (entry.type === 'response_item' && entry.payload?.type === 'message') {
    const content = entry.payload.content;
    const role = entry.payload.role || 'assistant';
    const textContent = extractCodexTextContent(content);

    if (!textContent?.trim() || textContent.includes('<environment_context>')) {
      return messages;
    }

    messages.push({
      type: role === 'user' ? 'user' : 'assistant',
      timestamp: entry.timestamp,
      messageKey: nextMessageKey(),
      message: {
        role,
        content: textContent,
        phase: typeof entry.payload.phase === 'string' ? entry.payload.phase : undefined,
      },
    });
    return messages;
  }

  if (entry.type === 'response_item' && entry.payload?.type === 'reasoning') {
    const summaryText = entry.payload.summary
      ?.map((summary) => summary.text)
      .filter(Boolean)
      .join('\n');
    if (summaryText?.trim()) {
      messages.push({
        type: 'thinking',
        timestamp: entry.timestamp,
        messageKey: nextMessageKey(),
        message: {
          role: 'assistant',
          content: summaryText,
        },
      });
    }
    return messages;
  }

  if (
    entry.type === 'response_item' &&
    ['command_execution', 'file_change', 'mcp_tool_call'].includes(entry.payload?.type)
  ) {
    return mapCodexNativeToolItem(entry, nextMessageKey);
  }

  if (entry.type === 'response_item' && entry.payload?.type === 'function_call') {
    const normalizedTool = normalizeCodexFunctionCall(entry.payload);
    const toolCallId = normalizedTool.toolCallId || fallbackToolCallId();

    messages.push({
      type: 'tool_use',
      timestamp: entry.timestamp,
      messageKey: nextMessageKey(),
      toolName: normalizedTool.toolName,
      toolInput: normalizedTool.toolInput,
      toolCallId,
    });
    return messages;
  }

  if (entry.type === 'response_item' && entry.payload?.type === 'function_call_output') {
    messages.push({
      type: 'tool_result',
      timestamp: entry.timestamp,
      messageKey: nextMessageKey(),
      toolCallId: entry.payload.call_id || fallbackToolCallId(),
      output: extractCodexToolOutput(entry.payload),
    });
    return messages;
  }

  if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call') {
    const toolName = entry.payload.name || 'custom_tool';
    const input = entry.payload.input || '';

    if (toolName === 'apply_patch') {
      const fileMatch = input.match(/\*\*\* Update File: (.+)/);
      const filePath = fileMatch ? fileMatch[1].trim() : 'unknown';
      const lines = input.split('\n');
      const oldLines = [];
      const newLines = [];

      for (const line of lines) {
        if (line.startsWith('-') && !line.startsWith('---')) {
          oldLines.push(line.substring(1));
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          newLines.push(line.substring(1));
        }
      }

      messages.push({
        type: 'tool_use',
        timestamp: entry.timestamp,
        messageKey: nextMessageKey(),
        toolName: 'Edit',
        toolInput: JSON.stringify({
          file_path: filePath,
          old_string: oldLines.join('\n'),
          new_string: newLines.join('\n'),
        }),
        toolCallId: entry.payload.call_id || fallbackToolCallId(),
      });
      return messages;
    }

    messages.push({
      type: 'tool_use',
      timestamp: entry.timestamp,
      messageKey: nextMessageKey(),
      toolName,
      toolInput: input,
      toolCallId: entry.payload.call_id || fallbackToolCallId(),
    });
    return messages;
  }

  if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call_output') {
    messages.push({
      type: 'tool_result',
      timestamp: entry.timestamp,
      messageKey: nextMessageKey(),
      toolCallId: entry.payload.call_id || fallbackToolCallId(),
      output: extractCodexToolOutput(entry.payload),
    });
  }

  return messages;
}

/**
 * Remove duplicated Codex user echoes emitted as both response_item and event_msg.
 * @param {Array<Record<string, unknown>>} messages - Mapped Codex UI messages.
 * @returns {Array<Record<string, unknown>>} Messages with same-turn user echoes collapsed.
 */
function dedupeCodexUserEchoMessages(messages) {
  const seenUserTurns = new Set();
  const recentUserTurnTimestamps = new Map();
  return messages.filter((message) => {
    if (message?.type !== 'user') {
      return true;
    }

    const textContent = normalizeSearchableText(message.message?.content || message.content || '');
    if (!textContent.trim()) {
      return true;
    }

    const timestamp = new Date(message.timestamp || 0).getTime();
    const timeKey = Number.isFinite(timestamp) ? String(timestamp) : String(message.timestamp || '');
    const key = `${timeKey}:${textContent}`;
    if (seenUserTurns.has(key)) {
      return false;
    }

    const recentTimestamp = recentUserTurnTimestamps.get(textContent);
    if (
      Number.isFinite(timestamp)
      && Number.isFinite(recentTimestamp)
      && Math.abs(timestamp - recentTimestamp) <= 1000
    ) {
      return false;
    }

    seenUserTurns.add(key);
    if (Number.isFinite(timestamp)) {
      recentUserTurnTimestamps.set(textContent, timestamp);
    }
    return true;
  });
}

/**
 * Map selected Codex JSONL lines into UI messages while preserving raw line keys.
 * @param {Array<{ line: string, lineNumber: number }>} entries - Raw JSONL line records.
 * @param {string} sessionId - Codex session id used for stable message keys.
 * @returns {Array<Record<string, unknown>>} Renderable UI messages.
 */
function mapCodexTranscriptLineEntries(entries, sessionId) {
  const messages = [];

  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.line);
      parsed.__sessionId = sessionId;
      parsed.__lineNumber = entry.lineNumber;
      messages.push(...mapCodexEntryToMessages(parsed));
    } catch {
      // Skip malformed lines while still honoring the raw line cursor.
    }
  }

  return dedupeCodexUserEchoMessages(messages);
}

/**
 * Read a Codex JSONL transcript using raw file line numbers as the cursor.
 * @param {string} sessionFilePath - Absolute Codex JSONL transcript path.
 * @param {string} sessionId - Codex session id used for stable message keys.
 * @param {number | null} limit - Tail line window size; null reads all rows.
 * @param {number} offset - Number of newest raw lines to skip for paging older history.
 * @param {number | null} afterLine - Raw JSONL line cursor; null reads from the tail/all rows.
 * @returns {Promise<{messages: Array<Record<string, unknown>>, total: number, tokenUsage: Record<string, unknown> | null}>}
 */
async function readCodexTranscriptByLineCursor(sessionFilePath, sessionId, limit = null, offset = 0, afterLine = null) {
  if (afterLine !== null && afterLine >= 0) {
    const result = await readJsonlAfterLine(sessionFilePath, afterLine);
    return {
      messages: mapCodexTranscriptLineEntries(result.lines, sessionId),
      total: result.total,
      tokenUsage: null,
    };
  }

  if (limit !== null) {
    const result = await readJsonlTailWindow(sessionFilePath, limit, offset);
    return {
      messages: mapCodexTranscriptLineEntries(result.lines, sessionId),
      total: result.total,
      tokenUsage: null,
    };
  }

  const messages = [];
  const fileStream = fsSync.createReadStream(sessionFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  let lineNumber = 0;
  let tokenUsage = null;

  for await (const line of rl) {
    lineNumber += 1;

    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line);
      entry.__sessionId = sessionId;
      entry.__lineNumber = lineNumber;

      if (!tokenUsage && entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
        tokenUsage = await getCodexSessionTokenUsageFromFile(sessionFilePath);
      }

      messages.push(...mapCodexEntryToMessages(entry));
    } catch { /* Skip malformed lines while still advancing the raw line cursor. */ }
  }

  return { messages: dedupeCodexUserEchoMessages(messages), total: lineNumber, tokenUsage };
}

// Get messages for a specific Codex session
async function getCodexSessionMessages(sessionId, limit = null, offset = 0, afterLine = null) {
  try {
    const sessionFilePath = await findCodexSessionFilePath(sessionId);

    if (!sessionFilePath) {
      console.warn(`Codex session file not found for session ${sessionId}`);
      return { messages: [], total: 0, hasMore: false };
    }

    if (afterLine !== null && afterLine >= 0) {
      const { messages, total, tokenUsage } = await readCodexTranscriptByLineCursor(
        sessionFilePath,
        sessionId,
        null,
        0,
        afterLine,
      );

      return {
        messages,
        total,
        hasMore: false,
        offset: 0,
        limit: null,
        tokenUsage,
      };
    }

    if (limit !== null) {
      const { messages: paginatedMessages, total, tokenUsage } = await readCodexTranscriptByLineCursor(
        sessionFilePath,
        sessionId,
        limit,
        offset,
        null,
      );

      return {
        messages: paginatedMessages,
        total,
        hasMore: total > offset + limit,
        offset,
        limit,
        tokenUsage,
      };
    }

    const { messages, total, tokenUsage } = await readCodexTranscriptByLineCursor(
      sessionFilePath,
      sessionId,
      null,
      0,
      null,
    );

    return { messages, total, tokenUsage };

  } catch (error) {
    console.error(`Error reading Codex session messages for ${sessionId}:`, error);
    return { messages: [], total: 0, hasMore: false };
  }
}

/**
 * Extract message-level searchable records from one Claude session payload.
 * @param {Array<Record<string, unknown>>} rawMessages
 * @param {string} sessionId
 * @returns {Array<{ messageKey: string, text: string, timestamp: string | number | Date | undefined }>}
 */
function extractClaudeSearchableMessages(rawMessages, sessionId) {
  const searchableMessages = [];
  const toolMessageKeyById = new Map();

  for (const rawMessage of rawMessages) {
    const lineNumber = Number.isFinite(Number(rawMessage.__lineNumber))
      ? Number(rawMessage.__lineNumber)
      : 0;
    let subIndex = 0;
    const nextMessageKey = () => buildClaudeMessageKey(sessionId, lineNumber, subIndex++);
    const baseMessageKey = typeof rawMessage.messageKey === 'string' ? rawMessage.messageKey : nextMessageKey();
    const timestamp = rawMessage.timestamp;

    if (rawMessage.type === 'thinking' && rawMessage.message?.content) {
      const text = normalizeSearchableText(rawMessage.message.content);
      if (text.trim()) {
        searchableMessages.push({ messageKey: baseMessageKey, text, timestamp });
      }
      continue;
    }

    if (!rawMessage.message?.role || rawMessage.message?.content == null) {
      continue;
    }

    if (rawMessage.message.role === 'user') {
      if (Array.isArray(rawMessage.message.content)) {
        const textParts = [];

        for (const part of rawMessage.message.content) {
          if (part?.type === 'text') {
            const text = normalizeSearchableText(part.text);
            if (text.trim()) {
              textParts.push(text);
            }
            continue;
          }

          if (part?.type === 'tool_result') {
            const text = normalizeSearchableText(part.content);
            const relatedMessageKey = toolMessageKeyById.get(part.tool_use_id) || baseMessageKey;
            if (text.trim()) {
              searchableMessages.push({
                messageKey: relatedMessageKey,
                text,
                timestamp,
              });
            }
          }
        }

        const userText = textParts.join('\n').trim();
        if (userText) {
          searchableMessages.push({ messageKey: baseMessageKey, text: userText, timestamp });
        }
        continue;
      }

      const text = normalizeSearchableText(rawMessage.message.content);
      if (text.trim()) {
        searchableMessages.push({ messageKey: baseMessageKey, text, timestamp });
      }
      continue;
    }

    if (rawMessage.message.role === 'assistant') {
      if (Array.isArray(rawMessage.message.content)) {
        for (const part of rawMessage.message.content) {
          if (part?.type === 'text') {
            const text = normalizeSearchableText(part.text);
            if (text.trim()) {
              searchableMessages.push({
                messageKey: nextMessageKey(),
                text,
                timestamp,
              });
            }
            continue;
          }

          if (part?.type === 'tool_use') {
            const messageKey = nextMessageKey();
            toolMessageKeyById.set(part.id, messageKey);
            const text = [part.name, normalizeSearchableText(part.input)]
              .filter(Boolean)
              .join('\n')
              .trim();
            if (text) {
              searchableMessages.push({ messageKey, text, timestamp });
            }
          }
        }
        continue;
      }

      const text = normalizeSearchableText(rawMessage.message.content);
      if (text.trim()) {
        searchableMessages.push({ messageKey: baseMessageKey, text, timestamp });
      }
    }
  }

  return searchableMessages;
}

/**
 * Extract message-level searchable records from one Codex session payload.
 * @param {Array<Record<string, unknown>>} rawMessages
 * @returns {Array<{ messageKey: string, text: string, timestamp: string | number | Date | undefined }>}
 */
function extractCodexSearchableMessages(rawMessages) {
  const searchableMessages = [];
  const toolMessageKeyById = new Map();

  for (const rawMessage of rawMessages) {
    const timestamp = rawMessage.timestamp;

    if (rawMessage.type === 'tool_use') {
      const messageKey = rawMessage.messageKey;
      if (rawMessage.toolCallId && messageKey) {
        toolMessageKeyById.set(rawMessage.toolCallId, messageKey);
      }

      const text = [rawMessage.toolName, normalizeSearchableText(rawMessage.toolInput)]
        .filter(Boolean)
        .join('\n')
        .trim();
      if (messageKey && text) {
        searchableMessages.push({ messageKey, text, timestamp });
      }
      continue;
    }

    if (rawMessage.type === 'tool_result') {
      const text = normalizeSearchableText(rawMessage.output);
      const messageKey = toolMessageKeyById.get(rawMessage.toolCallId) || rawMessage.messageKey;
      if (messageKey && text.trim()) {
        searchableMessages.push({ messageKey, text, timestamp });
      }
      continue;
    }

    const text = normalizeSearchableText(rawMessage.message?.content);
    if (rawMessage.messageKey && text.trim()) {
      searchableMessages.push({
        messageKey: rawMessage.messageKey,
        text,
        timestamp,
      });
    }
  }

  return searchableMessages;
}

/**
 * Find workflow routing metadata for a provider session id.
 * @param {Record<string, unknown>} project - Project read model.
 * @param {string} sessionId - Provider session id.
 * @returns {{ workflowId: string, workflowRouteIndex: number | undefined, routeIndex: number | undefined } | null}
 */
function findWorkflowSessionRoute(project, sessionId) {
  const workflows = Array.isArray(project?.workflows) ? project.workflows : [];
  for (const workflow of workflows) {
    const workflowRouteIndex = Number.isInteger(Number(workflow.routeIndex))
      ? Number(workflow.routeIndex)
      : Number.parseInt(String(workflow.id || '').replace(/^w/, ''), 10);
    const childSession = Array.isArray(workflow.childSessions)
      ? workflow.childSessions.find((session) => session?.id === sessionId)
      : null;
    if (childSession) {
      return {
        workflowId: workflow.id,
        workflowRouteIndex,
        routeIndex: childSession.routeIndex,
      };
    }
    const runnerProcess = Array.isArray(workflow.runnerProcesses)
      ? workflow.runnerProcesses.find((process) => process?.sessionId === sessionId)
      : null;
    if (runnerProcess) {
      const routeIndex = Array.isArray(workflow.childSessions)
        ? workflow.childSessions.find((session) => session?.id === sessionId)?.routeIndex
        : undefined;
      return {
        workflowId: workflow.id,
        workflowRouteIndex,
        routeIndex,
      };
    }
  }
  return null;
}

/**
 * Search across visible Claude/Codex transcripts or Codex JSONL identities.
 * @param {string} query
 * @param {'content' | 'jsonl'} [mode='content']
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function searchChatHistory(query, mode = 'content') {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    return [];
  }
  const searchMode = mode === 'jsonl' ? 'jsonl' : 'content';

  clearProjectDirectoryCache();
  clearSessionPathExistenceCache();
  const projects = await getProjects();
  const results = [];
  const projectByPath = new Map(
    projects
      .map((project) => [normalizeComparablePath(project.fullPath || project.path), project])
      .filter(([normalizedPath]) => Boolean(normalizedPath)),
  );
  const seenCodexSessionIds = new Set();

  for (const project of projects) {
    const claudeSessionResult = await getSessions(project.name, Number.MAX_SAFE_INTEGER, 0);
    const claudeSessions = Array.isArray(claudeSessionResult?.sessions)
      ? claudeSessionResult.sessions
      : [];
    if (searchMode === 'content') {
      for (const session of claudeSessions) {
        const sessionPayload = await getSessionMessages(project.name, session.id, null, 0, null);
        const rawMessages = Array.isArray(sessionPayload) ? sessionPayload : sessionPayload.messages || [];
        const searchableMessages = extractClaudeSearchableMessages(rawMessages, session.id);

        for (const message of searchableMessages) {
          if (!matchesSearchQuery(message.text, trimmedQuery)) {
            continue;
          }

          results.push({
            resultType: 'message',
            projectName: project.name,
            projectDisplayName: project.displayName,
            provider: 'claude',
            sessionId: session.id,
            sessionSummary: session.summary || session.title || 'Claude Session',
            messageKey: message.messageKey,
            snippet: buildSearchSnippet(message.text, trimmedQuery),
            timestamp: message.timestamp || session.updated_at || session.lastActivity || session.createdAt || null,
          });
        }
      }
    }

    const codexSessions = Array.isArray(project.codexSessions) ? project.codexSessions : [];
    for (const session of codexSessions) {
      seenCodexSessionIds.add(session.id);
      if (searchMode === 'jsonl') {
        const identityText = [
          session.thread,
          session.sessionFileName,
          path.basename(session.sessionFileName || '', '.jsonl'),
        ].filter(Boolean).join('\n');
        if (!matchesSearchQuery(identityText, trimmedQuery)) {
          continue;
        }

        results.push({
          resultType: 'session',
          projectName: project.name,
          projectDisplayName: project.displayName,
          provider: 'codex',
          sessionId: session.id,
          routeIndex: session.routeIndex,
          ...findWorkflowSessionRoute(project, session.id),
          sessionSummary: session.summary || session.title || 'Codex Session',
          thread: session.thread || session.id,
          sessionFileName: session.sessionFileName,
          snippet: session.sessionFileName || session.thread || session.id,
          timestamp: session.updated_at || session.lastActivity || session.createdAt || null,
        });
        continue;
      }

      const sessionPayload = await getCodexSessionMessages(session.id, null, 0, null);
      const rawMessages = Array.isArray(sessionPayload?.messages) ? sessionPayload.messages : [];
      const searchableMessages = extractCodexSearchableMessages(rawMessages);

      for (const message of searchableMessages) {
        if (!matchesSearchQuery(message.text, trimmedQuery)) {
          continue;
        }

        results.push({
          resultType: 'message',
          projectName: project.name,
          projectDisplayName: project.displayName,
          provider: 'codex',
          sessionId: session.id,
          routeIndex: session.routeIndex,
          sessionSummary: session.summary || session.title || 'Codex Session',
          messageKey: message.messageKey,
          snippet: buildSearchSnippet(message.text, trimmedQuery),
          timestamp: message.timestamp || session.updated_at || session.lastActivity || session.createdAt || null,
        });
      }
    }
  }

  const codexSessionFiles = await listCodexSessionFiles();
  for (const sessionFilePath of codexSessionFiles) {
    const { thread, sessionFileName } = deriveCodexThreadFromJsonlPath(sessionFilePath);
    let sessionMeta = null;

    try {
      const fileStream = fsSync.createReadStream(sessionFilePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        const entry = JSON.parse(line);
        if (entry.type === 'session_meta' && entry.payload?.id) {
          sessionMeta = {
            id: thread,
            sourceSessionId: entry.payload.id,
            cwd: entry.payload.cwd || '',
          };
          break;
        }
      }
    } catch {
      continue;
    }

    if (!sessionMeta?.id || seenCodexSessionIds.has(sessionMeta.id)) {
      continue;
    }

    const project = projectByPath.get(normalizeComparablePath(sessionMeta.cwd || '')) || null;
    if (searchMode === 'jsonl') {
      const identityText = [thread, sessionFileName, path.basename(sessionFileName, '.jsonl')]
        .filter(Boolean)
        .join('\n');
      if (!matchesSearchQuery(identityText, trimmedQuery)) {
        continue;
      }

      results.push({
        resultType: 'session',
        projectName: project?.name || encodeProjectPathAsName(sessionMeta.cwd || ''),
        projectDisplayName: project?.displayName || path.basename(sessionMeta.cwd || '') || 'Codex Session',
        provider: 'codex',
        sessionId: thread,
        ...(project ? findWorkflowSessionRoute(project, thread) : null),
        sessionSummary: 'Codex Session',
        thread,
        sessionFileName,
        snippet: sessionFileName,
        timestamp: null,
      });
      continue;
    }

    const sessionPayload = await getCodexSessionMessages(sessionMeta.id, null, 0, null);
    const rawMessages = Array.isArray(sessionPayload?.messages) ? sessionPayload.messages : [];
    const searchableMessages = extractCodexSearchableMessages(rawMessages);

    for (const message of searchableMessages) {
      if (!matchesSearchQuery(message.text, trimmedQuery)) {
        continue;
      }

      results.push({
        resultType: 'message',
        projectName: project?.name || encodeProjectPathAsName(sessionMeta.cwd || ''),
        projectDisplayName: project?.displayName || path.basename(sessionMeta.cwd || '') || 'Codex Session',
        provider: 'codex',
        sessionId: thread,
        sessionSummary: 'Codex Session',
        messageKey: message.messageKey,
        snippet: buildSearchSnippet(message.text, trimmedQuery),
        timestamp: message.timestamp || null,
      });
    }
  }

  results.sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0));
  return results;
}

async function readCodexSessionProjectPath(sessionFilePath) {
  const fileStream = fsSync.createReadStream(sessionFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      const cwd = typeof entry?.payload?.cwd === 'string'
        ? entry.payload.cwd
        : (typeof entry?.cwd === 'string' ? entry.cwd : '');
      if (cwd.trim()) {
        return cwd.trim();
      }
    } catch {
      // Ignore malformed records while looking for session metadata.
    }
  }

  return '';
}

async function deleteCodexSession(sessionId, projectPath = '') {
  try {
    if (await deleteManualSessionDraft(sessionId, 'codex', projectPath)) {
      return true;
    }

    const sessionFilePath = await findCodexSessionFilePath(sessionId);
    if (sessionFilePath) {
      const resolvedProjectPath = projectPath || await readCodexSessionProjectPath(sessionFilePath);
      await fs.unlink(sessionFilePath);
      await cleanupDeletedSessionConfig(sessionId, resolvedProjectPath, 'codex');
      codexSessionFileCache.delete(sessionId);
      clearProjectDirectoryCache();
      return true;
    }

    const config = await loadProjectConfig(projectPath);
    const chatRecord = findProjectChatRecord(config, sessionId);
    if (chatRecord?.record && (!chatRecord.record.provider || chatRecord.record.provider === 'codex')) {
      await cleanupDeletedSessionConfig(sessionId, projectPath, 'codex');
      clearProjectDirectoryCache();
      return true;
    }

    throw new Error(`Codex session file not found for session ${sessionId}`);
  } catch (error) {
    console.error(`Error deleting Codex session ${sessionId}:`, error);
    throw error;
  }
}

async function refreshMissingProjectPathCache(options = {}) {
  const logger = options.logger || console;
  const startedAt = Date.now();
  const stats = {
    checkedPaths: 0,
    missingPaths: 0,
    scannedSessions: 0,
    durationMs: 0
  };

  clearSessionPathExistenceCache();

  const projects = await getProjects();
  logger.info(`[SessionVisibility] Startup scan begin: ${projects.length} project(s)`);

  for (const project of projects) {
    const projectPath = project.fullPath || project.path || '';
    if (projectPath) {
      stats.checkedPaths += 1;
      await projectPathExists(projectPath, { forceRefresh: true });
    }

    let offset = 0;
    const pageSize = 200;
    while (true) {
      const result = await getSessions(project.name, pageSize, offset, { includeHidden: true });
      const sessions = result?.sessions || [];
      stats.scannedSessions += sessions.length;
      for (const session of sessions) {
        const sessionProjectPath = resolveSessionProjectPath(session, projectPath);
        if (!sessionProjectPath) {
          continue;
        }
        stats.checkedPaths += 1;
        await projectPathExists(sessionProjectPath, { forceRefresh: true });
      }

      if (!result?.hasMore) {
        break;
      }
      offset += pageSize;
    }

    const codexSessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    stats.scannedSessions += codexSessions.length;
    for (const session of codexSessions) {
      const sessionProjectPath = resolveSessionProjectPath(session, projectPath);
      if (!sessionProjectPath) {
        continue;
      }
      stats.checkedPaths += 1;
      await projectPathExists(sessionProjectPath, { forceRefresh: true });
    }
  }

  stats.missingPaths = Array.from(sessionPathExistenceCache.values()).filter((entry) => entry.exists === false).length;
  stats.durationMs = Date.now() - startedAt;

  logger.info(
    `[SessionVisibility] Startup scan complete: checked=${stats.checkedPaths}, missing=${stats.missingPaths}, sessions=${stats.scannedSessions}, duration=${stats.durationMs}ms`,
  );

  return stats;
}

export {
  getProjects,
  getSessions,
  getSessionMessages,
  parseJsonlSessions,
  renameProject,
  updateSessionUiState,
  renameSession,
  renameCodexSession,
  createManualSessionDraft,
  startManualSessionDraft,
  bindManualSessionDraftProviderSession,
  markManualSessionDraftCancelRequested,
  getManualSessionDraftRuntime,
  finalizeManualSessionDraft,
  deleteSession,
  isProjectEmpty,
  deleteProject,
  addProjectManually,
  loadProjectConfig,
  saveProjectConfig,
  getSessionModelState,
  updateSessionModelState,
  createDefaultProjectArchiveIndex,
  getProjectArchiveFilePath,
  loadProjectArchiveIndex,
  saveProjectArchiveIndex,
  isMissingProjectPathError,
  validateProjectPathAvailability,
  evaluateProjectArchival,
  extractProjectDirectory,
  buildProjectRoutePath,
  clearProjectDirectoryCache,
  refreshMissingProjectPathCache,
  getCodexSessions,
  getCodexSessionMessages,
  searchChatHistory,
  deleteCodexSession,
};
