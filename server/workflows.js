/**
 * PURPOSE: Persist lightweight project-scoped workflow control-plane state for CCUI.
 * The store keeps workflow read models, unread markers, artifacts, and child-session links
 * independent from raw chat sessions so the sidebar and detail view can treat workflows
 * as first-class resources.
 */
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  buildReviewPassStageKey,
  buildReviewPassSubstageKey,
  getReviewPassIndexForSubstage,
  getReviewPassSessions,
} from './domains/workflows/review-stages.js';

const execFileAsync = promisify(execFile);
const PROMPT_TEMPLATE_PATHS = {
  planning: path.join(os.homedir(), '.config', 'ccflow-alias', 'explore.md'),
  execution: path.join(os.homedir(), '.config', 'ccflow-alias', 'apply.md'),
  archive: path.join(os.homedir(), '.config', 'ccflow-alias', 'archive.md'),
};
const FALLBACK_PROMPT_TEMPLATES = {
  planning: [
    '只读探索需求和上下文，先不要修改仓库内容。',
  ].join('\n'),
  execution: [
    '根据既有规划产物完成实现、验证与必要的代码修改',
  ].join('\n'),
  archive: [
    '先执行 archive.md 中定义的交付/归档指令',
    '然后生成信息密度高、便于人类快速审核的交付摘要',
  ].join('\n'),
  reviewResultSchema: JSON.stringify({
    type: 'object',
    required: ['summary', 'decision', 'findings'],
    properties: {
      summary: { type: 'string' },
      decision: { type: 'string', enum: ['clean', 'needs_repair'] },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title', 'severity', 'evidence', 'recommendation'],
        },
      },
    },
  }, null, 2),
};
const REVIEW_PROFILES = ['requirement-fit', 'implementation-risk', 'acceptance-readiness'];
const VERIFICATION_REVIEW_PASSES = [1, 2, 3];
const STAGE_LABELS = {
  planning: '规划提案',
  execution: '执行',
  verification: '审核',
  review_1: '初审',
  repair_1: '初修',
  review_2: '再审',
  repair_2: '再修',
  review_3: '三审',
  repair_3: '三修',
  archive: '归档',
};
const STAGE_TEMPLATES = [
  {
    key: 'planning',
    label: STAGE_LABELS.planning,
    substages: [
      { key: 'planner_output', title: '规划提案' },
    ],
  },
  {
    key: 'execution',
    label: STAGE_LABELS.execution,
    substages: [
      { key: 'node_execution', title: '提案落地' },
    ],
  },
  {
    key: 'review_1',
    label: STAGE_LABELS.review_1,
    substages: [
      { key: 'review_1', title: '初审' },
    ],
  },
  {
    key: 'repair_1',
    label: STAGE_LABELS.repair_1,
    substages: [
      { key: 'repair_1', title: '初修产物' },
    ],
  },
  {
    key: 'review_2',
    label: STAGE_LABELS.review_2,
    substages: [
      { key: 'review_2', title: '再审' },
    ],
  },
  {
    key: 'repair_2',
    label: STAGE_LABELS.repair_2,
    substages: [
      { key: 'repair_2', title: '再修产物' },
    ],
  },
  {
    key: 'review_3',
    label: STAGE_LABELS.review_3,
    substages: [
      { key: 'review_3', title: '三审' },
    ],
  },
  {
    key: 'repair_3',
    label: STAGE_LABELS.repair_3,
    substages: [
      { key: 'repair_3', title: '三修产物' },
    ],
  },
  {
    key: 'archive',
    label: STAGE_LABELS.archive,
    substages: [
      { key: 'delivery_package', title: '归档报告' },
    ],
  },
];

const PROJECT_CONFIG_SCHEMA_VERSION = 2;
const WORKFLOW_ARTIFACT_ROOT = '.ccflow';
const MANUAL_SESSION_DRAFTS_KEY = 'manualSessionDrafts';
const SESSION_SUMMARY_BY_ID_KEY = 'sessionSummaryById';
const LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY = 'sessionSummaryOverrideById';
const LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY = 'codexSessionSummaryById';
const SESSION_WORKFLOW_METADATA_BY_ID_KEY = 'sessionWorkflowMetadataById';
const SESSION_UI_STATE_BY_PATH_KEY = 'sessionUiStateByPath';
const SESSION_MODEL_STATE_BY_ID_KEY = 'sessionModelStateById';
const SESSION_ROUTE_INDEX_KEY = 'sessionRouteIndex';
const LEGACY_SESSION_ROUTE_INDEX_BY_PATH_KEY = 'sessionRouteIndexByPath';
const REVIEW_PASS_DECISIONS = new Set(['clean', 'pass', 'passed', 'approved', 'accept', 'accepted', 'ok', 'success']);
const REVIEW_REPAIR_DECISIONS = new Set(['needs_repair', 'blocked', 'reject', 'rejected', 'fail', 'failed', 'changes_requested']);
const SUBSTAGE_FILE_DEFINITIONS = {
  planner_output: [
    { id: 'openspec-proposal', label: 'proposal.md', type: 'file' },
    { id: 'openspec-design', label: 'design.md', type: 'file' },
    { id: 'openspec-tasks', label: 'tasks.md', type: 'file' },
    { id: 'openspec-specs', label: 'specs', type: 'directory' },
  ],
  verification_evidence: [{ id: 'verification-evidence', label: 'verification-evidence.json', filename: 'verification-evidence.json', type: 'file' }],
  repair_1: [{ id: 'repair-1-summary', label: 'repair-1-summary.md', filename: 'repair-1-summary.md', type: 'file' }],
  repair_2: [{ id: 'repair-2-summary', label: 'repair-2-summary.md', filename: 'repair-2-summary.md', type: 'file' }],
  repair_3: [{ id: 'repair-3-summary', label: 'repair-3-summary.md', filename: 'repair-3-summary.md', type: 'file' }],
  delivery_package: [{ id: 'delivery-summary', label: 'delivery-summary.md', filename: 'delivery-summary.md', type: 'file' }],
};

/**
 * Build a stable kebab-case slug for one workflow title.
 */
/**
 * Compute the next available OpenSpec change numeric prefix for a workflow.
 */
async function buildWorkflowOpenSpecChangePrefix(projectPath, workflows = []) {
  const changesRoot = path.join(projectPath, 'openspec', 'changes');
  let maxSequence = 0;

  const collectSequence = (entryName) => {
    const matched = String(entryName || '').match(/^(\d+)(?:-|$)/);
    if (matched) {
      maxSequence = Math.max(maxSequence, Number.parseInt(matched[1], 10));
    }
  };

  try {
    const activeEntries = await fs.readdir(changesRoot, { withFileTypes: true });
    for (const entry of activeEntries) {
      if (!entry.isDirectory() || entry.name === 'archive') {
        continue;
      }
      collectSequence(entry.name);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  try {
    const archiveEntries = await fs.readdir(path.join(changesRoot, 'archive'), { withFileTypes: true });
    for (const entry of archiveEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      collectSequence(entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, ''));
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  for (const workflow of Array.isArray(workflows) ? workflows : []) {
    collectSequence(workflow?.openspecChangeName || workflow?.openspecChangePrefix);
  }

  return String(maxSequence + 1);
}

async function findOpenSpecChangeByPrefix(projectPath, changePrefix) {
  /**
   * PURPOSE: Bind a pending workflow to the agent-created OpenSpec directory
   * once planning creates a real change whose name starts with the reserved
   * numeric prefix.
   */
  const normalizedPrefix = String(changePrefix || '').trim();
  if (!projectPath || !/^\d+$/.test(normalizedPrefix)) {
    return '';
  }

  const changesRoot = path.join(projectPath, 'openspec', 'changes');
  try {
    const entries = await fs.readdir(changesRoot, { withFileTypes: true });
    const matchedNames = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${normalizedPrefix}-`))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    return matchedNames[0] || '';
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function findArchivedOpenSpecChange(projectPath, changeName) {
  /**
   * PURPOSE: Resolve accepted OpenSpec changes after `openspec archive` moves
   * their files under changes/archive/YYYY-MM-DD-<change-name>.
   */
  const normalizedChangeName = String(changeName || '').trim();
  if (!projectPath || !normalizedChangeName) {
    return '';
  }

  const archiveRoot = path.join(projectPath, 'openspec', 'changes', 'archive');
  try {
    const entries = await fs.readdir(archiveRoot, { withFileTypes: true });
    const matchedEntry = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((entryName) => entryName === normalizedChangeName || entryName.endsWith(`-${normalizedChangeName}`))
      .sort((left, right) => right.localeCompare(left))[0];
    return matchedEntry ? path.join('archive', matchedEntry) : '';
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function resolveOpenSpecArtifactChangeName(projectPath, changeName) {
  /**
   * PURPOSE: Pick the OpenSpec directory used for read-only planning artifact
   * links, accepting both active and archived change locations.
   */
  const normalizedChangeName = String(changeName || '').trim();
  if (!projectPath || !normalizedChangeName) {
    return '';
  }

  try {
    await fs.access(path.join(projectPath, 'openspec', 'changes', normalizedChangeName));
    return normalizedChangeName;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  return findArchivedOpenSpecChange(projectPath, normalizedChangeName);
}

/**
 * Resolve the project-relative path for one OpenSpec planning artifact.
 */
function buildOpenSpecArtifactRelativePath(changeName, hint = {}) {
  return path.join('openspec', 'changes', changeName || 'unknown-change', hint.label || '');
}

/**
 * Build the canonical relative artifact path for one workflow-scoped output file.
 */
function buildWorkflowArtifactRelativePath(workflowId, filename) {
  return path.join(WORKFLOW_ARTIFACT_ROOT, buildWorkflowArtifactDirectoryName(workflowId), filename);
}

/**
 * Build the compact workflow id used as the persisted route address.
 */
function buildWorkflowId(routeIndex) {
  return Number.isInteger(routeIndex) && routeIndex > 0 ? `w${routeIndex}` : null;
}

/**
 * Return the filesystem directory name for a workflow-scoped artifact bucket.
 */
function buildWorkflowArtifactDirectoryName(workflowId) {
  const routeIndex = parseWorkflowRouteIndex(workflowId);
  return Number.isInteger(routeIndex) && routeIndex > 0 ? String(routeIndex) : 'unknown-workflow';
}

/**
 * Parse the route number encoded in a compact workflow id.
 */
function parseWorkflowRouteIndex(workflowId) {
  const match = String(workflowId || '').match(/^w([1-9]\d*)$/);
  if (!match) {
    return null;
  }
  const routeIndex = Number(match[1]);
  return Number.isInteger(routeIndex) && routeIndex > 0 ? routeIndex : null;
}

/**
 * Materialize substage file hints so every workflow gets a private artifact namespace.
 */
function buildSubstageFileHints(workflowId) {
  return Object.fromEntries(
    Object.entries(SUBSTAGE_FILE_DEFINITIONS).map(([substageKey, definitions]) => ([
      substageKey,
      definitions.map((definition) => ({
        id: definition.id,
        label: definition.label,
        path: definition.filename ? buildWorkflowArtifactRelativePath(workflowId, definition.filename) : definition.path,
        type: definition.type,
      })),
    ])),
  );
}

/**
 * Legacy workflows used project-root filenames. Keep these around only for migration.
 */
function buildLegacySubstageFileHints() {
  return Object.fromEntries(
    Object.entries(SUBSTAGE_FILE_DEFINITIONS).map(([substageKey, definitions]) => ([
      substageKey,
      definitions
        .filter((definition) => definition.filename)
        .map((definition) => ({
          id: definition.id,
          label: definition.label,
          path: definition.filename,
          type: definition.type,
        })),
    ])),
  );
}

/**
 * Override planning hints with the workflow-bound OpenSpec change directory.
 */
function buildWorkflowPlanningHints(workflow) {
  const changeName = workflow?.openspecArtifactChangeName
    || workflow?.openspecChangeName
    || (workflow?.openspecChangePrefix ? `${workflow.openspecChangePrefix}-<agent-chosen-name>` : 'unknown-change');
  return {
    ...buildSubstageFileHints(workflow?.id),
    planner_output: SUBSTAGE_FILE_DEFINITIONS.planner_output.map((definition) => ({
      id: definition.id,
      label: definition.label,
      path: buildOpenSpecArtifactRelativePath(changeName, definition),
      type: definition.type,
    })),
  };
}

async function readWorkflowOpenSpecTaskProgress(projectPath, changeName) {
  if (!projectPath || !changeName) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('openspec', ['list', '--json'], { cwd: projectPath });
    const payload = JSON.parse(stdout || '{}');
    const matchedChange = Array.isArray(payload?.changes)
      ? payload.changes.find((change) => change?.name === changeName)
      : null;
    if (!matchedChange) {
      return null;
    }
    return {
      name: matchedChange.name,
      status: matchedChange.status || 'pending',
      completedTasks: Number(matchedChange.completedTasks || 0),
      totalTasks: Number(matchedChange.totalTasks || 0),
      lastModified: matchedChange.lastModified || null,
    };
  } catch (error) {
    return null;
  }
}

function createEmptyStore() {
  return {
    version: 1,
    workflows: [],
  };
}

function getProjectConfigPath(projectPath) {
  return path.join(path.resolve(String(projectPath || '')), '.ccflow', 'conf.json');
}

/**
 * Read the project-local conf.json without importing project services.
 */
async function readProjectConfig(projectPath) {
  try {
    const raw = await fs.readFile(getProjectConfigPath(projectPath), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

/**
 * Persist project-local config after workflow state has been merged.
 */
async function writeProjectConfig(projectPath, config) {
  const configPath = getProjectConfigPath(projectPath);
  const nextConfigData = `${JSON.stringify(config, null, 2)}\n`;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  try {
    const currentConfigData = await fs.readFile(configPath, 'utf8');
    if (currentConfigData === nextConfigData) {
      return;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  await fs.writeFile(configPath, nextConfigData, 'utf8');
}

/**
 * Remove one key from an object map and delete the map when it becomes empty.
 */
function deleteConfigMapEntry(config, key, entryKey) {
  const map = config?.[key];
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.prototype.hasOwnProperty.call(map, entryKey)) {
    return false;
  }

  delete map[entryKey];
  if (Object.keys(map).length === 0) {
    delete config[key];
  }
  return true;
}

/**
 * Remove UI state rows stored either by session id or by scoped route/session key.
 */
function deleteSessionUiStateEntries(config, sessionIds) {
  const map = config?.[SESSION_UI_STATE_BY_PATH_KEY];
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return false;
  }

  let changed = false;
  Object.keys(map).forEach((key) => {
    const sessionId = String(key).split(':').pop();
    if (sessionIds.has(sessionId) || sessionIds.has(key)) {
      delete map[key];
      changed = true;
    }
  });
  if (Object.keys(map).length === 0) {
    delete config[SESSION_UI_STATE_BY_PATH_KEY];
  }
  return changed;
}

/**
 * Remove deleted workflow sessions from route buckets so config normalization
 * cannot rebuild the workflow from stale route ownership records.
 */
function deleteSessionRouteEntries(config, sessionIds) {
  let changed = false;
  [SESSION_ROUTE_INDEX_KEY, LEGACY_SESSION_ROUTE_INDEX_BY_PATH_KEY].forEach((key) => {
    const routeIndex = config?.[key];
    if (!routeIndex || typeof routeIndex !== 'object' || Array.isArray(routeIndex)) {
      return;
    }

    if (Object.values(routeIndex).some((value) => typeof value !== 'object')) {
      Object.entries(routeIndex).forEach(([routeIndexKey, sessionId]) => {
        if (sessionIds.has(sessionId)) {
          delete routeIndex[routeIndexKey];
          changed = true;
        }
      });
      if (Object.keys(routeIndex).length === 0) {
        delete config[key];
      }
      return;
    }

    Object.entries(routeIndex).forEach(([bucketKey, bucket]) => {
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
        return;
      }
      Object.entries(bucket).forEach(([routeIndexKey, sessionId]) => {
        if (sessionIds.has(sessionId)) {
          delete bucket[routeIndexKey];
          changed = true;
        }
      });
      if (Object.keys(bucket).length === 0) {
        delete routeIndex[bucketKey];
      }
    });
    if (Object.keys(routeIndex).length === 0) {
      delete config[key];
    }
  });
  return changed;
}

/**
 * Remove all reverse indexes that can otherwise recreate a deleted workflow.
 */
function cleanupDeletedWorkflowConfig(config, workflowId, childSessions = []) {
  const sessionIds = new Set(
    childSessions
      .map((session) => session?.sessionId || session?.id)
      .filter((sessionId) => typeof sessionId === 'string' && sessionId.trim()),
  );

  const workflowMetadataById = config?.[SESSION_WORKFLOW_METADATA_BY_ID_KEY];
  if (workflowMetadataById && typeof workflowMetadataById === 'object' && !Array.isArray(workflowMetadataById)) {
    Object.entries(workflowMetadataById).forEach(([sessionId, metadata]) => {
      if (metadata?.workflowId === workflowId) {
        sessionIds.add(sessionId);
      }
    });
  }

  const manualDrafts = config?.[MANUAL_SESSION_DRAFTS_KEY];
  if (manualDrafts && typeof manualDrafts === 'object' && !Array.isArray(manualDrafts)) {
    Object.entries(manualDrafts).forEach(([draftId, draft]) => {
      if (draft?.workflowId === workflowId) {
        sessionIds.add(draftId);
      }
    });
  }

  sessionIds.forEach((sessionId) => {
    deleteConfigMapEntry(config, SESSION_SUMMARY_BY_ID_KEY, sessionId);
    deleteConfigMapEntry(config, LEGACY_SESSION_SUMMARY_OVERRIDE_BY_ID_KEY, sessionId);
    deleteConfigMapEntry(config, LEGACY_CODEX_SESSION_SUMMARY_BY_ID_KEY, sessionId);
    deleteConfigMapEntry(config, SESSION_WORKFLOW_METADATA_BY_ID_KEY, sessionId);
    deleteConfigMapEntry(config, SESSION_MODEL_STATE_BY_ID_KEY, sessionId);
    deleteConfigMapEntry(config, MANUAL_SESSION_DRAFTS_KEY, sessionId);
  });
  deleteSessionUiStateEntries(config, sessionIds);
  deleteSessionRouteEntries(config, sessionIds);
}

/**
 * Convert an absolute project path into Claude's on-disk project directory name.
 */
function encodeClaudeProjectPath(projectPath) {
  return String(projectPath || '').replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Locate a Claude JSONL session file for a workflow child session.
 */
async function findClaudeSessionFile(projectPath, sessionId) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', encodeClaudeProjectPath(projectPath));
  const directFile = path.join(projectDir, `${sessionId}.jsonl`);
  try {
    await fs.access(directFile);
    return directFile;
  } catch {
    // Continue with a content scan for legacy filenames.
  }

  let files = [];
  try {
    files = await fs.readdir(projectDir);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  for (const file of files.filter((entry) => entry.endsWith('.jsonl') && !entry.startsWith('agent-'))) {
    const jsonlFile = path.join(projectDir, file);
    const content = await fs.readFile(jsonlFile, 'utf8');
    const hasSession = content.split('\n').some((line) => {
      if (!line.trim()) return false;
      try {
        const data = JSON.parse(line);
        return data.sessionId === sessionId;
      } catch {
        return false;
      }
    });
    if (hasSession) return jsonlFile;
  }

  return null;
}

/**
 * Locate a Codex JSONL session file under the nested Codex session tree.
 */
async function findCodexSessionFile(sessionId) {
  const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');

  /**
   * Walk nested date directories until the matching JSONL is found.
   */
  const walk = async (dir) => {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await walk(fullPath);
        if (found) return found;
      } else if (entry.name.endsWith('.jsonl') && entry.name.includes(sessionId)) {
        return fullPath;
      }
    }

    return null;
  };

  return walk(sessionsRoot);
}

/**
 * Delete the raw provider JSONL file for one workflow-owned child session.
 */
async function deleteWorkflowChildSessionFile(projectPath, session) {
  const sessionId = session?.id || session?.sessionId;
  if (!sessionId) return false;

  const provider = String(session?.provider || '').toLowerCase();
  const sessionFile = provider === 'codex'
    ? await findCodexSessionFile(sessionId)
    : await findClaudeSessionFile(projectPath, sessionId);
  if (!sessionFile) return false;

  await fs.rm(sessionFile, { force: true });
  return true;
}

function findSubstageTemplate(substageKey) {
  for (const template of STAGE_TEMPLATES) {
    const substage = template.substages.find((item) => item.key === substageKey);
    if (substage) {
      return {
        stageKey: template.key,
        stageLabel: template.label,
        substageKey: substage.key,
        substageTitle: substage.title,
      };
    }
  }

  return null;
}

function findArtifactHint(workflow, artifact = {}) {
  const canonicalHints = buildWorkflowPlanningHints(workflow);
  const legacyHints = buildLegacySubstageFileHints();

  for (const [substageKey, hints] of Object.entries(canonicalHints)) {
    for (const canonicalHint of hints) {
      const legacyHint = (legacyHints[substageKey] || []).find((hint) => hint.id === canonicalHint.id) || null;
      const hintMatched = (
        (artifact.id && canonicalHint.id === artifact.id)
        || (artifact.path && canonicalHint.path && canonicalHint.path === artifact.path)
        || (artifact.path && legacyHint?.path && legacyHint.path === artifact.path)
      );
      if (!hintMatched) {
        continue;
      }

      const substageTemplate = findSubstageTemplate(substageKey);
      if (!substageTemplate) {
        continue;
      }

      return {
        ...substageTemplate,
        hint: canonicalHint,
        legacyHint,
      };
    }
  }

  return null;
}

/**
 * Detect whether one persisted artifact path still points at the old project-root file.
 */
function isLegacyArtifactPath(artifactPath, legacyHint = {}) {
  if (!artifactPath || !legacyHint?.path) {
    return false;
  }

  if (artifactPath === legacyHint.path) {
    return true;
  }

  return path.basename(artifactPath) === legacyHint.path && !artifactPath.includes(`${WORKFLOW_ARTIFACT_ROOT}${path.sep}`);
}

/**
 * Check whether OpenSpec can already resolve the workflow-bound change.
 */
async function detectWorkflowOpenSpecChange(projectPath, changeName) {
  if (!projectPath || !changeName) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      'openspec',
      ['status', '--change', changeName, '--json'],
      {
        cwd: projectPath,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      },
    );
    return JSON.parse(stdout);
  } catch (error) {
    return null;
  }
}

async function readPromptTemplate(mode) {
  const templatePath = PROMPT_TEMPLATE_PATHS[mode];
  if (!templatePath) {
    if (FALLBACK_PROMPT_TEMPLATES[mode]) {
      return FALLBACK_PROMPT_TEMPLATES[mode];
    }
    throw new Error(`Unknown workflow prompt mode: ${mode}`);
  }
  try {
    return await fs.readFile(templatePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' && FALLBACK_PROMPT_TEMPLATES[mode]) {
      return FALLBACK_PROMPT_TEMPLATES[mode];
    }
    throw error;
  }
}

async function buildPlanningKickoffPrompt(workflow) {
  /**
   * PURPOSE: Give the planning child session the human summary, full demand,
   * and reserved OpenSpec change prefix so the agent chooses the semantic suffix.
   */
  const template = await readPromptTemplate('planning');
  const title = String(workflow?.title || '').trim() || '未命名工作流';
  const objective = String(workflow?.objective || title).trim();
  const changePrefix = String(workflow?.openspecChangePrefix || '').trim();
  const changeNameInstruction = changePrefix
    ? [`拟新建 OpenSpec change 编号前缀：${changePrefix}`]
    : [`OpenSpec change：${workflow?.openspecChangeName || '待创建'}`];
  return [
    template.trim(),
    ...changeNameInstruction,
    `工作流标题：${title}`,
    `需求正文：${objective}`,
  ].join('\n');
}

function buildReviewFindingsPath(workflowId, passIndex) {
  return buildWorkflowArtifactRelativePath(workflowId, `review-${passIndex}.json`);
}

function buildRepairSummaryPath(workflowId, passIndex) {
  /**
   * PURPOSE: Give every repair stage a durable completion artifact so the
   * workflow state machine does not infer success from chat existence.
   */
  return buildWorkflowArtifactRelativePath(workflowId, `repair-${passIndex}-summary.md`);
}

async function readWorkflowReviewResult(projectPath, workflowId, passIndex) {
  /**
   * PURPOSE: Load one persisted review result so workflow continuation can
   * decide between reopening execution for fixes or advancing to the next pass.
   */
  const findingsPath = path.join(projectPath, buildReviewFindingsPath(workflowId, passIndex));
  try {
    const raw = await fs.readFile(findingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      path: findingsPath,
      summary: String(parsed?.summary || '').trim(),
      decision: String(parsed?.decision || '').trim().toLowerCase(),
      findings: Array.isArray(parsed?.findings) ? parsed.findings : [],
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readWorkflowReviewResultForWorkflow(projectPath, workflow, passIndex) {
  /**
   * PURPOSE: Prefer compact workflow artifact paths while still reading legacy
   * workflow-* paths during route-id normalization.
   */
  const primary = await readWorkflowReviewResult(projectPath, workflow.id, passIndex);
  if (primary || !workflow.legacyId) {
    return primary;
  }
  return readWorkflowReviewResult(projectPath, workflow.legacyId, passIndex);
}

function buildReviewFocusNote(passIndex) {
  const focuses = [
    '需求契合：检查最近变更是否偏离需求、范围、OpenSpec 产物或用户目标。',
    '实现风险：检查最近变更中的逻辑缺陷、边界条件、回归风险和缺失验证。',
    '验收准备：检查最近变更是否仍有阻断交付、不可验收或前轮问题未关闭之处。',
  ];
  return focuses[Math.max(0, Math.min(focuses.length - 1, passIndex - 1))];
}

function buildLauncherSummary(mode, workflowTitle, passIndex) {
  const normalizedTitle = String(workflowTitle || '').trim() || '未命名工作流';
  if (mode === 'planning') {
    return `规划提案：${normalizedTitle}`;
  }
  if (mode === 'execution') {
    return `提案落地：${normalizedTitle}`;
  }
  if (mode === 'repair') {
    return `修复${passIndex || 1}：${normalizedTitle}`;
  }
  if (mode === 'archive') {
    return `归档：${normalizedTitle}`;
  }
  return `评审${passIndex || 1}：${normalizedTitle}`;
}

async function buildReviewLauncherPayload(workflow, passIndex) {
  /**
   * PURPOSE: Keep review launcher generation reusable for direct launches and
   * review continuation after one repair session finishes.
   */
  const reviewerResultSchema = await readPromptTemplate('reviewResultSchema');
  const findingsPath = buildReviewFindingsPath(workflow.id, passIndex);
  const reviewProfile = REVIEW_PROFILES[Math.max(0, Math.min(REVIEW_PROFILES.length - 1, passIndex - 1))];
  return {
    workflowId: workflow.id,
    workflowTitle: workflow.title,
    workflowChangeName: workflow.openspecChangeName,
    workflowAutoStart: 'review',
    workflowStageKey: buildReviewPassStageKey(passIndex),
    workflowSubstageKey: buildReviewPassSubstageKey(passIndex),
    workflowReviewPass: passIndex,
    workflowReviewProfile: reviewProfile,
    sessionSummary: buildLauncherSummary('review', workflow.title, passIndex),
    autoPrompt: [
      '聚焦当前角度，尽可能严格地找出最近变更中需要改进的地方。',
      buildReviewFocusNote(passIndex),
      '',
      `把审核结果写入 ${findingsPath}。`,
      '输出格式：',
      '```json',
      reviewerResultSchema.trim(),
      '```',
    ].join('\n'),
  };
}

async function buildRepairLauncherPayload(workflow, passIndex, reviewResult) {
  /**
   * PURPOSE: Convert blocked reviewer findings into a dedicated execution
   * follow-up session so the control-plane graph shows the repair handoff.
   */
  const executionTemplate = await readPromptTemplate('execution');
  const findingTitles = (reviewResult?.findings || [])
    .map((finding) => String(finding?.title || '').trim())
    .filter(Boolean);
  const findingsPath = buildReviewFindingsPath(workflow.id, passIndex);
  const repairSummaryPath = buildRepairSummaryPath(workflow.id, passIndex);
  return {
    workflowId: workflow.id,
    workflowTitle: workflow.title,
    workflowChangeName: workflow.openspecChangeName,
    workflowAutoStart: 'repair',
    workflowStageKey: `repair_${passIndex}`,
    workflowSubstageKey: `repair_${passIndex}`,
    workflowReviewPass: passIndex,
    workflowRepairPass: passIndex,
    sessionSummary: buildLauncherSummary('repair', workflow.title, passIndex),
    autoPrompt: [
      executionTemplate.trim(),
      '',
      '## Repair Target',
      `本轮不是首次落地，而是修复第 ${passIndex} 轮审核发现的问题。`,
      `必须先阅读 ${findingsPath}，把其中仍然有效的 findings 逐项关闭后再结束本轮。`,
      reviewResult?.summary ? `审核摘要：${reviewResult.summary}` : '',
      findingTitles.length > 0
        ? `重点修复：${findingTitles.map((title, index) => `${index + 1}. ${title}`).join('；')}`
        : '若审核文件里存在 findings，请以文件内容为准逐项处理。',
      '',
      '## Completion Rule',
      `完成修复后必须生成或更新 ${repairSummaryPath}，作为 repair_${passIndex} 的完成产物。`,
      `写完修复产物后停在实现侧，等待系统重新发起第 ${passIndex} 轮审核，不要自行越过该轮。`,
      '',
      '## repair summary 要求',
      '- 用 Markdown 列出本轮关闭的 findings。',
      '- 写明实际改动、验证命令、残留风险和证据路径。',
    ].filter(Boolean).join('\n'),
  };
}

async function buildArchiveLauncherPayload(workflow) {
  /**
   * PURPOSE: Start the final delivery session after all review passes are clean.
   * The archive agent runs the user's archive.md instructions and writes the
   * human-facing delivery summary artifact for acceptance.
   */
  const archiveTemplate = await readPromptTemplate('archive');
  const deliverySummaryPath = buildWorkflowArtifactRelativePath(workflow.id, 'delivery-summary.md');
  return {
    workflowId: workflow.id,
    workflowTitle: workflow.title,
    workflowChangeName: workflow.openspecChangeName,
    workflowAutoStart: 'archive',
    workflowStageKey: 'archive',
    workflowSubstageKey: 'delivery_package',
    sessionSummary: buildLauncherSummary('archive', workflow.title),
    autoPrompt: [
      archiveTemplate.trim(),
      '',
      '## Delivery Target',
      '三轮内部审核已经完成，当前会话负责最终交付整理。',
      `必须生成或更新 ${deliverySummaryPath}。`,
      '',
      '## delivery-summary.md 要求',
      '- 用高信息密度 Markdown 写给人类审核者，不写空泛过程描述。',
      '- 覆盖需求目标、实际改动、验证结果、残留风险、人工验收建议。',
      '- 明确列出关键文件/命令/证据路径，便于快速复核。',
      '',
      '## 当前工作流上下文',
      `- 工作流标题：${workflow.title}`,
      `- 工作流 ID：${workflow.id}`,
      `- OpenSpec change：${workflow.openspecChangeName}`,
    ].join('\n'),
  };
}

/**
 * Enumerate active OpenSpec changes that can still be adopted by a workflow.
 */
async function listAdoptableOpenSpecChanges(projectPath) {
  if (!projectPath) {
    return [];
  }

  const changesRoot = path.join(projectPath, 'openspec', 'changes');
  let entries = [];
  try {
    entries = await fs.readdir(changesRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const workflows = await listProjectWorkflows(projectPath);
  const claimedChangeNames = new Set(
    workflows
      .map((workflow) => String(workflow.openspecChangeName || '').trim())
      .filter(Boolean),
  );

  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => entry.name)
    .filter((changeName) => !claimedChangeNames.has(changeName))
    .sort((left, right) => right.localeCompare(left));
}

/**
 * Ensure a workflow only adopts a real, currently-unclaimed OpenSpec change.
 */
async function validateWorkflowOpenSpecChange(projectPath, changeName) {
  const normalizedChangeName = String(changeName || '').trim();
  if (!normalizedChangeName) {
    return '';
  }

  const adoptableChanges = await listAdoptableOpenSpecChanges(projectPath);
  if (!adoptableChanges.includes(normalizedChangeName)) {
    throw new Error(`OpenSpec change is unavailable: ${normalizedChangeName}`);
  }

  return normalizedChangeName;
}

async function readWorkflowStore(projectPath) {
  const config = await readProjectConfig(projectPath);
  const rawWorkflowEntries = Array.isArray(config.workflows)
    ? config.workflows.map((workflow, index) => [String(Number(workflow?.routeIndex) || index + 1), workflow])
    : Object.entries(config.workflows && typeof config.workflows === 'object' ? config.workflows : {});
  const workflows = rawWorkflowEntries.length > 0
    ? rawWorkflowEntries.map(([routeIndex, workflow]) => expandWorkflowFromStore({
      ...(workflow && typeof workflow === 'object' && !Array.isArray(workflow) ? workflow : {}),
      id: buildWorkflowId(Number(routeIndex)),
      routeIndex: Number(routeIndex),
    }))
    : [];
  return {
    version: 1,
    workflows,
  };
}

async function writeWorkflowStore(projectPath, store, options = {}) {
  const config = await readProjectConfig(projectPath);
  const nextConfig = {
    ...config,
    schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
  };
  const previousWorkflows = config.workflows && typeof config.workflows === 'object' && !Array.isArray(config.workflows)
    ? config.workflows
    : {};
  const nextWorkflows = {};

  for (const workflow of Array.isArray(store?.workflows) ? store.workflows : []) {
    const routeIndex = parseWorkflowRouteIndex(workflow?.id) || Number(workflow?.routeIndex);
    if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
      continue;
    }
    const key = String(routeIndex);
    nextWorkflows[key] = {
      ...compactWorkflowForStore({
        ...workflow,
        id: buildWorkflowId(routeIndex),
        routeIndex,
      }),
    };
    delete nextWorkflows[key].id;
    delete nextWorkflows[key].routeIndex;
  }

  if (Object.keys(nextWorkflows).length > 0) {
    nextConfig.workflows = nextWorkflows;
  } else {
    delete nextConfig.workflows;
  }

  if (options.deletedWorkflowId) {
    cleanupDeletedWorkflowConfig(nextConfig, options.deletedWorkflowId, options.deletedWorkflowChildSessions);
  }

  await writeProjectConfig(projectPath, nextConfig);
}

/**
 * Expand compact persisted workflow records into the runtime shape.
 */
function expandWorkflowFromStore(workflow = {}) {
  const stage = workflow.stage || 'planning';
  const routeIndex = parseWorkflowRouteIndex(workflow.id) || Number(workflow.routeIndex);
  const workflowId = buildWorkflowId(routeIndex) || workflow.id;
  const legacyId = workflow.id && workflow.id !== workflowId ? workflow.id : undefined;
  const childSessions = expandWorkflowChatSessions(workflow, workflowId);
  return {
    ...workflow,
    id: workflowId,
    legacyId,
    routeIndex: Number.isInteger(routeIndex) && routeIndex > 0 ? routeIndex : undefined,
    objective: workflow.objective || workflow.title || '新需求',
    openspecChangePrefix: String(workflow.openspecChangePrefix || '').trim(),
    runState: workflow.runState || 'running',
    hasUnreadActivity: workflow.hasUnreadActivity === true,
    gateDecision: workflow.gateDecision || 'pending',
    stageStatuses: Array.isArray(workflow.stageStatuses)
      ? workflow.stageStatuses
      : getWorkflowStages().map((item) => ({
        ...item,
        status: item.key === stage ? 'active' : 'pending',
      })),
    artifacts: Array.isArray(workflow.artifacts) ? workflow.artifacts : [],
    chat: workflow.chat && typeof workflow.chat === 'object' && !Array.isArray(workflow.chat)
      ? workflow.chat
      : compactChildSessionsToWorkflowChat(childSessions),
    childSessions,
  };
}

/**
 * Persist only the workflow fields that cannot be derived from defaults.
 */
function compactWorkflowForStore(workflow = {}) {
  const stage = workflow.stage || 'planning';
  const routeIndex = parseWorkflowRouteIndex(workflow.id) || Number(workflow.routeIndex);
  const compact = {
    id: buildWorkflowId(routeIndex) || workflow.id,
    title: workflow.title,
  };

  if (workflow.objective && workflow.objective !== workflow.title) compact.objective = workflow.objective;
  if (workflow.adoptsExistingOpenSpec === true) compact.adoptsExistingOpenSpec = true;
  if (workflow.openspecChangePrefix) compact.openspecChangePrefix = workflow.openspecChangePrefix;
  if (workflow.openspecChangeName) compact.openspecChangeName = workflow.openspecChangeName;
  if (workflow.openspecChangeDetected === true) compact.openspecChangeDetected = true;
  if (workflow.openspecTaskProgress && typeof workflow.openspecTaskProgress === 'object') {
    compact.openspecTaskProgress = workflow.openspecTaskProgress;
  }
  if (stage !== 'planning') compact.stage = stage;
  if (workflow.runState && workflow.runState !== 'running') compact.runState = workflow.runState;
  if (workflow.hasUnreadActivity === true) compact.hasUnreadActivity = true;
  if (workflow.updatedAt) compact.updatedAt = workflow.updatedAt;
  if (workflow.gateDecision && workflow.gateDecision !== 'pending') compact.gateDecision = workflow.gateDecision;
  if (workflow.finalReadiness === true) compact.finalReadiness = true;
  if (workflow.favorite === true) compact.favorite = true;
  if (workflow.pending === true) compact.pending = true;
  if (workflow.hidden === true) compact.hidden = true;

  if (!isDefaultStageStatuses(workflow.stageStatuses, stage)) {
    compact.stageStatuses = workflow.stageStatuses;
  }
  if (Array.isArray(workflow.artifacts) && workflow.artifacts.length > 0) {
    compact.artifacts = workflow.artifacts.map(compactArtifactForStore);
  }
  const workflowChat = compactChildSessionsToWorkflowChat(workflow.childSessions);
  if (Object.keys(workflowChat).length > 0) {
    compact.chat = workflowChat;
  }

  return compact;
}

/**
 * Check whether stage statuses can be derived from the workflow stage alone.
 */
function isDefaultStageStatuses(stageStatuses, stage = 'planning') {
  if (!Array.isArray(stageStatuses)) {
    return true;
  }
  const expected = getWorkflowStages();
  return stageStatuses.length === expected.length && expected.every((item) => {
    const matched = stageStatuses.find((candidate) => candidate?.key === item.key);
    return matched && matched.status === (item.key === stage ? 'active' : 'pending');
  });
}

/**
 * Persist one artifact without UI-derived inspection fields.
 */
function compactArtifactForStore(artifact = {}) {
  const compact = {};
  ['id', 'label', 'path', 'type', 'stage', 'substageKey', 'status'].forEach((key) => {
    if (artifact[key] !== undefined && artifact[key] !== '') compact[key] = artifact[key];
  });
  return compact;
}

/**
 * Persist one workflow child session without values derivable from its parent.
 */
function compactChildSessionForStore(session = {}) {
  const compact = {};
  ['id', 'title', 'summary', 'provider', 'stageKey', 'substageKey', 'reviewPassIndex', 'url'].forEach((key) => {
    if (session[key] !== undefined && session[key] !== '') compact[key] = session[key];
  });
  return compact;
}

/**
 * PURPOSE: Convert workflow.chat records into the runtime child session shape.
 *
 * @param {object} workflow - Persisted workflow record.
 * @param {string} workflowId - Canonical workflow id for derived sessions.
 * @returns {Array<object>} Runtime child sessions.
 */
function expandWorkflowChatSessions(workflow = {}, workflowId = '') {
  const chatSessions = workflow.chat && typeof workflow.chat === 'object' && !Array.isArray(workflow.chat)
    ? Object.entries(workflow.chat).map(([routeIndex, session]) => ({
      ...session,
      id: session?.sessionId || session?.id,
      routeIndex: Number.parseInt(routeIndex, 10),
      workflowId: session?.workflowId || workflowId,
      stageKey: session?.stageKey,
    }))
    : [];
  const legacySessions = Array.isArray(workflow.childSessions) ? workflow.childSessions : [];
  const seenIds = new Set(chatSessions.map((session) => session.id).filter(Boolean));
  return [
    ...chatSessions,
    ...legacySessions.filter((session) => !seenIds.has(session?.id)),
  ];
}

/**
 * PURPOSE: Store workflow child sessions in the compact workflow.chat index.
 *
 * @param {Array<object>} childSessions - Runtime child sessions.
 * @returns {Record<string, object>} Persisted workflow chat records.
 */
function compactChildSessionsToWorkflowChat(childSessions = []) {
  return (Array.isArray(childSessions) ? childSessions : []).reduce((chat, session) => {
    const routeIndex = Number(session?.routeIndex);
    if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
      return chat;
    }
    const compact = compactChildSessionForStore(session);
    if (compact.id) {
      compact.sessionId = compact.id;
      delete compact.id;
    }
    chat[String(routeIndex)] = compact;
    return chat;
  }, {});
}

function getWorkflowStages() {
  return STAGE_TEMPLATES.map((stage) => ({ key: stage.key, label: stage.label }));
}

function normalizeWorkflowStageKey(stageKey) {
  /**
   * Accept legacy review_pass_N and acceptance keys while keeping the current
   * serial control-plane addresses as the only runtime representation.
   */
  if (stageKey === 'ready_for_acceptance') {
    return 'archive';
  }
  if (stageKey === 'verification') {
    return 'review_1';
  }
  if (/^repair_\d+$/.test(String(stageKey || ''))) {
    return stageKey;
  }
  const reviewPassIndex = getReviewPassIndexForSubstage(stageKey);
  if (Number.isInteger(reviewPassIndex)) {
    return buildReviewPassStageKey(reviewPassIndex);
  }
  return stageKey;
}

function createWorkflowRecord(payload = {}) {
  const timestamp = new Date().toISOString();
  const title = String(payload.title || payload.objective || '新需求').trim();
  const workflowId = payload.workflowId || `workflow-${Date.now().toString(36)}`;
  const adoptsExistingOpenSpec = payload.adoptsExistingOpenSpec === true;
  const initialStage = 'planning';

  return {
    id: workflowId,
    routeIndex: Number.isInteger(payload.routeIndex) ? payload.routeIndex : undefined,
    title,
    objective: String(payload.objective || title).trim(),
    adoptsExistingOpenSpec,
    openspecChangePrefix: String(payload.openspecChangePrefix || '').trim(),
    openspecChangeName: payload.openspecChangeName || '',
    stage: initialStage,
    runState: 'running',
    hasUnreadActivity: true,
    updatedAt: timestamp,
    stageStatuses: getWorkflowStages().map((stage) => ({
      ...stage,
      status: stage.key === initialStage ? 'active' : 'pending',
    })),
    artifacts: [],
    childSessions: [],
    gateDecision: 'pending',
  };
}

function assignMissingWorkflowRouteIndices(workflows = []) {
  let maxWorkflowRouteIndex = workflows.reduce((maxValue, workflow) => {
    const parsed = parseWorkflowRouteIndex(workflow?.id) || Number(workflow?.routeIndex);
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, 0);
  let changed = false;

  const indexedWorkflows = workflows.map((workflow) => {
    const nextWorkflow = { ...workflow };
    let workflowRouteIndex = parseWorkflowRouteIndex(nextWorkflow.id) || Number(nextWorkflow.routeIndex);
    if (!Number.isInteger(workflowRouteIndex) || workflowRouteIndex <= 0) {
      maxWorkflowRouteIndex += 1;
      workflowRouteIndex = maxWorkflowRouteIndex;
      changed = true;
    }
    const workflowId = buildWorkflowId(workflowRouteIndex);
    if (workflowId && nextWorkflow.id !== workflowId) {
      nextWorkflow.legacyId = nextWorkflow.id;
      nextWorkflow.id = workflowId;
      changed = true;
    }
    nextWorkflow.routeIndex = workflowRouteIndex;

    const childSessions = expandWorkflowChatSessions(nextWorkflow, nextWorkflow.id);
    let maxChildRouteIndex = childSessions.reduce((maxValue, session) => {
      const parsed = Number(session?.routeIndex);
      return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
    }, 0);
    nextWorkflow.childSessions = childSessions.map((session) => {
      const nextSession = {
        ...session,
        workflowId: session?.workflowId || nextWorkflow.id,
        projectPath: session?.projectPath || nextWorkflow.projectPath,
      };
      if (!Number.isInteger(nextSession.routeIndex) || nextSession.routeIndex <= 0) {
        maxChildRouteIndex += 1;
        nextSession.routeIndex = maxChildRouteIndex;
        changed = true;
      }
      return nextSession;
    });
    nextWorkflow.chat = compactChildSessionsToWorkflowChat(nextWorkflow.childSessions);

    return nextWorkflow;
  });

  return {
    workflows: indexedWorkflows,
    changed,
  };
}

/**
 * Some legacy records leave `stage` stale while `stageStatuses` already advanced.
 * Prefer the active/blocked stage from the read model.
 */
function resolveWorkflowStageKey(workflow, stageStatuses) {
  const activeStage = stageStatuses.find((stage) => ['active', 'blocked', 'failed', 'running'].includes(stage.status));
  if (activeStage?.key) {
    return normalizeWorkflowStageKey(activeStage.key);
  }
  return normalizeWorkflowStageKey(workflow.stage) || 'planning';
}

/**
 * Build persisted stage statuses when a newly registered child session starts a
 * later workflow stage.
 */
function buildActiveStageStatuses(stageStatuses, targetStageKey) {
  /**
   * Keep the workflow control plane monotonic: earlier stages become complete,
   * the child-session stage becomes active, and later stages wait pending.
   */
  const normalizedTargetStageKey = normalizeWorkflowStageKey(targetStageKey);
  const targetStageIndex = STAGE_TEMPLATES.findIndex((stage) => stage.key === normalizedTargetStageKey);
  if (targetStageIndex < 0) {
    return stageStatuses;
  }

  return stageStatuses.map((stage) => {
    const normalizedStageKey = normalizeWorkflowStageKey(stage.key);
    const stageIndex = STAGE_TEMPLATES.findIndex((template) => template.key === normalizedStageKey);
    if (stageIndex < 0) {
      return stage;
    }
    if (stageIndex < targetStageIndex) {
      return { ...stage, status: 'completed' };
    }
    if (stageIndex === targetStageIndex) {
      return { ...stage, status: 'active' };
    }
    return { ...stage, status: 'pending' };
  });
}

/**
 * Normalize one artifact into an absolute path + existence-aware inspection record.
 */
async function normalizeArtifact(projectPath, artifact = {}) {
  const artifactPath = typeof artifact.path === 'string' ? artifact.path.trim() : '';
  const absolutePath = artifactPath
    ? path.isAbsolute(artifactPath)
      ? artifactPath
      : path.join(projectPath || '', artifactPath)
    : '';
  let exists = false;
  let inferredType = artifact.type || 'file';

  if (absolutePath) {
    try {
      const stats = await fs.stat(absolutePath);
      exists = true;
      if (!artifact.type) {
        inferredType = stats.isDirectory() ? 'directory' : 'file';
      }
      artifact.modifiedAt = stats.mtime.toISOString();
      artifact.mtimeMs = stats.mtimeMs;
      if (/^review-\d+$/.test(String(artifact.id || '')) && stats.isFile()) {
        try {
          const raw = await fs.readFile(absolutePath, 'utf8');
          const parsed = JSON.parse(raw);
          artifact.reviewDecision = String(parsed?.decision || '').trim().toLowerCase();
          artifact.reviewFindingCount = Array.isArray(parsed?.findings) ? parsed.findings.length : 0;
        } catch (error) {
          artifact.status = 'invalid';
          artifact.parseError = error?.message || 'Invalid review result JSON';
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return {
    ...artifact,
    path: absolutePath || artifact.path,
    relativePath: artifactPath || undefined,
    type: inferredType,
    exists,
  };
}

/**
 * Copy one legacy project-root artifact into the workflow-private directory once.
 */
async function migrateLegacyArtifactIfNeeded(projectPath, canonicalHint, legacyHint) {
  const canonicalArtifact = await normalizeArtifact(projectPath, canonicalHint);
  if (canonicalArtifact.exists || !legacyHint?.path) {
    return canonicalArtifact;
  }

  const legacyArtifact = await normalizeArtifact(projectPath, legacyHint);
  if (!legacyArtifact.exists || !canonicalArtifact.path) {
    return canonicalArtifact;
  }

  await fs.mkdir(path.dirname(canonicalArtifact.path), { recursive: true });
  await fs.copyFile(legacyArtifact.path, canonicalArtifact.path);
  return normalizeArtifact(projectPath, canonicalHint);
}

/**
 * Normalize display-only planning and review-result hints.
 *
 * Review result files are workflow-owned control artifacts. Detect them from
 * disk so a review pass is completed only after its structured result exists.
 */
async function buildNormalizedSubstageFileHints(projectPath, workflow) {
  const workflowHints = buildWorkflowPlanningHints(workflow);
  const reviewHints = Object.fromEntries(VERIFICATION_REVIEW_PASSES.map((passIndex) => {
    const substageKey = buildReviewPassSubstageKey(passIndex);
    return [
      substageKey,
      [{
        id: `review-${passIndex}`,
        label: `review-${passIndex}.json`,
        path: buildReviewFindingsPath(workflow.id, passIndex),
        type: 'file',
      }],
    ];
  }));
  const repairHints = Object.fromEntries(VERIFICATION_REVIEW_PASSES.map((passIndex) => {
    const substageKey = `repair_${passIndex}`;
    return [
      substageKey,
      [{
        id: `repair-${passIndex}-summary`,
        label: `repair-${passIndex}-summary.md`,
        path: buildRepairSummaryPath(workflow.id, passIndex),
        type: 'file',
      }],
    ];
  }));
  const discoverableHints = {
    planner_output: workflowHints.planner_output || [],
    ...reviewHints,
    ...repairHints,
    delivery_package: [{
      id: 'delivery-summary',
      label: 'delivery-summary.md',
      path: buildWorkflowArtifactRelativePath(workflow.id, 'delivery-summary.md'),
      type: 'file',
    }],
  };
  const discoverableSubstages = Object.keys(discoverableHints);
  const legacyHints = buildLegacySubstageFileHints();

  const entries = await Promise.all(
    discoverableSubstages.flatMap((substageKey) => (
      (discoverableHints[substageKey] || []).map(async (hint) => {
        const normalizedHint = substageKey === 'planner_output'
          ? await migrateLegacyArtifactIfNeeded(
            projectPath,
            hint,
            (legacyHints.planner_output || []).find((legacyHint) => legacyHint.id === hint.id) || null,
          )
          : await normalizeArtifact(projectPath, hint);
        return [
          substageKey,
          {
            ...normalizedHint,
            substageKey,
            status: normalizedHint.exists ? 'ready' : 'missing',
          },
        ];
      })
    )),
  );

  return entries.reduce((result, [substageKey, hint]) => {
    if (!result[substageKey]) {
      result[substageKey] = [];
    }
    result[substageKey].push(hint);
    return result;
  }, {});
}

const FILE_SUBSTAGE_PREDECESSORS = {
  repair_1: 'review_1',
  review_2: 'repair_1',
  repair_2: 'review_2',
  review_3: 'repair_2',
  repair_3: 'review_3',
};

function isReadyArtifact(artifact = {}) {
  if (artifact.status === 'invalid' || artifact.parseError) {
    return false;
  }
  return artifact.exists === true || artifact.status === 'ready';
}

function getArtifactMtimeMs(artifact = {}) {
  if (!artifact) {
    return null;
  }
  return Number.isFinite(artifact.mtimeMs) ? artifact.mtimeMs : null;
}

function matchesSubstageArtifact(artifact = {}, substageKey = '') {
  if (!artifact || !substageKey) {
    return false;
  }
  const passIndex = getReviewPassIndexForSubstage(substageKey);
  return artifact.substageKey === substageKey
    || (Number.isInteger(passIndex) && artifact.id === `review-${passIndex}`)
    || (/^repair_\d+$/.test(substageKey) && artifact.id === `repair-${substageKey.split('_')[1]}-summary`)
    || (substageKey === 'delivery_package' && artifact.id === 'delivery-summary');
}

function findReadySubstageArtifact(substageKey, artifacts = []) {
  return artifacts.find((artifact) => isReadyArtifact(artifact) && matchesSubstageArtifact(artifact, substageKey)) || null;
}

function reviewPassRequiresRepair(passIndex, artifacts = []) {
  const artifact = findReadySubstageArtifact(buildReviewPassSubstageKey(passIndex), artifacts);
  if (!artifact) {
    return false;
  }
  const decision = String(artifact.reviewDecision || '').trim().toLowerCase();
  return REVIEW_REPAIR_DECISIONS.has(decision)
    || Number(artifact.reviewFindingCount || 0) > 0
    || !REVIEW_PASS_DECISIONS.has(decision);
}

function isSubstageArtifactFresh(substageKey, artifacts = [], visited = new Set()) {
  if (visited.has(substageKey)) {
    return false;
  }
  visited.add(substageKey);
  const artifact = findReadySubstageArtifact(substageKey, artifacts);
  if (!artifact) {
    return false;
  }

  const artifactMtime = getArtifactMtimeMs(artifact);
  if (substageKey === 'delivery_package') {
    let terminalPredecessorKey = null;
    if (reviewPassRequiresRepair(VERIFICATION_REVIEW_PASSES.length, artifacts)) {
      terminalPredecessorKey = isSubstageArtifactFresh('repair_3', artifacts, new Set(visited)) ? 'repair_3' : null;
    } else if (isSubstageArtifactFresh('repair_3', artifacts, new Set(visited))) {
      terminalPredecessorKey = 'repair_3';
    } else if (isSubstageArtifactFresh('review_3', artifacts, new Set(visited))) {
      terminalPredecessorKey = 'review_3';
    }
    if (!terminalPredecessorKey) {
      return false;
    }
    const predecessorMtime = getArtifactMtimeMs(findReadySubstageArtifact(terminalPredecessorKey, artifacts));
    return !Number.isFinite(artifactMtime) || !Number.isFinite(predecessorMtime) || artifactMtime >= predecessorMtime;
  }

  const predecessorKey = FILE_SUBSTAGE_PREDECESSORS[substageKey];
  if (!predecessorKey) {
    return true;
  }
  if (!isSubstageArtifactFresh(predecessorKey, artifacts, new Set(visited))) {
    return false;
  }
  const predecessorArtifact = findReadySubstageArtifact(predecessorKey, artifacts);
  const predecessorMtime = getArtifactMtimeMs(predecessorArtifact);
  return !Number.isFinite(artifactMtime) || !Number.isFinite(predecessorMtime) || artifactMtime >= predecessorMtime;
}

function hasReviewPassResultEvidence(passIndex, artifacts = []) {
  /**
   * PURPOSE: Treat a review pass as complete only when its structured
   * review-N.json artifact exists, not merely when a reviewer session was
  * launched. This keeps the three review rounds serial.
  */
  const substageKey = buildReviewPassSubstageKey(passIndex);
  return isSubstageArtifactFresh(substageKey, artifacts);
}

/**
 * Repair legacy child sessions so old discussion/review keys still map onto the
 * consolidated planning and review substages used by the current control plane.
 */
function normalizeWorkflowChildSession(session = {}, fallbackStageKey) {
  const title = String(session.title || session.summary || '子会话').trim() || '子会话';
  const summary = String(session.summary || session.title || title).trim() || title;
  const joinedText = `${title}\n${summary}`;
  const looksLikePlanningPrompt = /openspec|proposal\.md|design\.md|tasks\.md|变更提案|创建\s+openspec/i.test(joinedText);
  const looksLikeExecutionSession = /执行\s*openspec|执行\s+open\s*spec|执行提案|apply\b|实施变更|落地实现/i.test(joinedText);
  const repairPassMatch = joinedText.match(/(?:修复|修正|初修|再修|三修)\s*(\d+)?/);
  const reviewPassMatch = (
    String(session.id || '').match(/review-(\d+)/i)
    || joinedText.match(/(?:内部审核第|审核第|审核)\s*(\d+)\s*轮/)
    || joinedText.match(/[审核评审]\s*(\d+)(?=[：:\s]|$)/)
    || joinedText.match(/\breview\s*pass\s*(\d+)\b/i)
  );
  const normalizedSessionStageKey = normalizeWorkflowStageKey(session.stageKey);
  const normalizedSessionSubstageKey = normalizeWorkflowStageKey(session.substageKey);
  const stageReviewPassIndex = getReviewPassIndexForSubstage(normalizedSessionStageKey);
  const substageReviewPassIndex = getReviewPassIndexForSubstage(normalizedSessionSubstageKey);
  const explicitReviewPassIndex = Number.parseInt(String(session.reviewPassIndex || ''), 10);
  const textReviewPassIndex = reviewPassMatch ? Number.parseInt(reviewPassMatch[1], 10) : null;
  const reviewPassIndex = Number.isInteger(explicitReviewPassIndex) && explicitReviewPassIndex > 0
    ? explicitReviewPassIndex
    : textReviewPassIndex;
  const repairPassIndex = repairPassMatch
    ? Number.parseInt(repairPassMatch[1] || String(reviewPassIndex || ''), 10)
    : null;
  const looksLikeRepairSession = Number.isInteger(repairPassIndex);
  const looksLikeReviewSession = Number.isInteger(reviewPassIndex)
    || (!looksLikeRepairSession && /内部审核|审核第|审核\s*\d+|reviewer|review pass/i.test(joinedText));
  const shouldTreatAsReviewRepairSession = Number.isInteger(stageReviewPassIndex)
    && !looksLikeReviewSession
    && !Number.isInteger(substageReviewPassIndex);
  const shouldRepairExecutionSession = looksLikeExecutionSession
    && !looksLikeReviewSession
    && (
      !session.stageKey
      || session.stageKey === 'planning'
      || session.substageKey === 'planner_output'
      || session.substageKey === 'status_sync'
    );
  const shouldRepairPlanningPrompt = looksLikePlanningPrompt
    && !shouldRepairExecutionSession
    && (!session.stageKey || session.stageKey === 'planning' || session.stageKey === 'discussion');
  const shouldRepairReviewSession = looksLikeReviewSession
    && (
      !session.stageKey
      || session.stageKey === 'execution'
      || session.stageKey === 'verification'
      || Number.isInteger(stageReviewPassIndex)
      || session.substageKey === 'status_sync'
      || session.substageKey === 'internal_review'
      || session.substageKey === 'planner_output'
      || session.substageKey === 'node_execution'
    );
  const stageKey = shouldRepairPlanningPrompt
    ? 'planning'
    : shouldRepairExecutionSession
      ? 'execution'
      : looksLikeRepairSession
        ? `repair_${repairPassIndex}`
        : shouldRepairReviewSession
          ? (Number.isInteger(reviewPassIndex) ? buildReviewPassStageKey(reviewPassIndex) : 'verification')
          : (normalizedSessionStageKey || fallbackStageKey);
  const existingReviewPassSubstageKey = Number.isInteger(getReviewPassIndexForSubstage(normalizedSessionSubstageKey))
    ? normalizedSessionSubstageKey
    : null;
  const substageKey = shouldRepairPlanningPrompt
    ? 'planner_output'
    : shouldRepairExecutionSession
      ? 'node_execution'
      : looksLikeRepairSession
        ? `repair_${repairPassIndex}`
        : shouldRepairReviewSession
          ? (Number.isInteger(reviewPassIndex) ? buildReviewPassSubstageKey(reviewPassIndex) : existingReviewPassSubstageKey || 'internal_review')
          : shouldTreatAsReviewRepairSession
            ? 'internal_review'
            : normalizedSessionSubstageKey;

  return {
    ...session,
    routeIndex: Number.isInteger(Number(session.routeIndex)) ? Number(session.routeIndex) : undefined,
    title,
    summary,
    provider: session.provider || 'claude',
    workflowId: session.workflowId,
    projectPath: session.projectPath,
    stageKey,
    substageKey,
    reviewPassIndex: Number.isInteger(reviewPassIndex) ? reviewPassIndex : session.reviewPassIndex,
    url: session.url,
  };
}

/**
 * Repair one legacy corruption mode where sequential reviewer sessions were all
 * persisted under the latest review substage without an explicit pass index.
 */
function repairLegacyReviewPassAssignments(childSessions = []) {
  const verificationSessions = childSessions.filter((session) => (
    session.stageKey === 'verification'
    || Number.isInteger(getReviewPassIndexForSubstage(session.stageKey))
    || Number.isInteger(getReviewPassIndexForSubstage(session.substageKey))
  ));
  const indexedPasses = new Set(
    verificationSessions
      .map((session) => (Number.isInteger(session.reviewPassIndex)
        ? Number(session.reviewPassIndex)
        : getReviewPassIndexForSubstage(session.substageKey || session.stageKey)))
      .filter((passIndex) => Number.isInteger(passIndex)),
  );

  if (indexedPasses.size > 1 || verificationSessions.length < 2 || verificationSessions.length > VERIFICATION_REVIEW_PASSES.length) {
    return childSessions;
  }

  const legacyPassSessions = verificationSessions.filter((session) => (
    !Number.isInteger(session.reviewPassIndex)
    && getReviewPassIndexForSubstage(session.substageKey) === VERIFICATION_REVIEW_PASSES.length
    && /^# Workflow Reviewer\b/.test(String(session.title || session.summary || '').trim())
  ));
  if (legacyPassSessions.length !== verificationSessions.length) {
    return childSessions;
  }

  const repairedIds = new Map(
    legacyPassSessions.map((session, index) => ([
      session.id,
      {
        reviewPassIndex: index + 1,
        stageKey: buildReviewPassStageKey(index + 1),
        substageKey: buildReviewPassSubstageKey(index + 1),
      },
    ])),
  );

  return childSessions.map((session) => {
    const repaired = repairedIds.get(session.id);
    return repaired ? { ...session, ...repaired } : session;
  });
}

function getStageOrder(stageKey = '') {
  return STAGE_TEMPLATES.findIndex((stage) => stage.key === stageKey);
}

function getSubstageOrder(stageKey = '', substageKey = '') {
  const stageTemplate = STAGE_TEMPLATES.find((stage) => stage.key === stageKey);
  if (!stageTemplate) {
    return Number.MAX_SAFE_INTEGER;
  }
  const index = stageTemplate.substages.findIndex((substage) => substage.key === substageKey);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function compareWorkflowChildSessions(left = {}, right = {}) {
  /**
   * PURPOSE: Group sessions by workflow stage/substage while preserving the
   * original insertion order within the same bucket so the newest session stays
   * the primary navigation target in the UI.
   */
  const stageOrderDiff = getStageOrder(left.stageKey) - getStageOrder(right.stageKey);
  if (stageOrderDiff !== 0) {
    return stageOrderDiff;
  }

  const substageOrderDiff = getSubstageOrder(left.stageKey, left.substageKey) - getSubstageOrder(right.stageKey, right.substageKey);
  if (substageOrderDiff !== 0) {
    return substageOrderDiff;
  }

  if (left.substageKey === 'internal_review' && right.substageKey === 'internal_review') {
    const leftPass = Number.isInteger(left.reviewPassIndex) ? left.reviewPassIndex : Number.MAX_SAFE_INTEGER;
    const rightPass = Number.isInteger(right.reviewPassIndex) ? right.reviewPassIndex : Number.MAX_SAFE_INTEGER;
    if (leftPass !== rightPass) {
      return leftPass - rightPass;
    }
  }

  return 0;
}

function prepareWorkflowRecord(workflow = {}) {
  const validStageKeys = new Set(getWorkflowStages().map((stage) => stage.key));
  const normalizedStageStatuses = Array.isArray(workflow.stageStatuses)
    ? getWorkflowStages().map((stage) => {
      const matched = workflow.stageStatuses.find((item) => normalizeWorkflowStageKey(item.key) === stage.key);
      const inheritedStatus = !matched && stage.key === 'planning' && workflow.stage === 'discussion'
        ? 'active'
        : 'pending';
      return {
        key: stage.key,
        label: STAGE_LABELS[stage.key],
        status: matched?.status || inheritedStatus,
      };
    })
    : getWorkflowStages().map((stage) => ({ ...stage, status: 'pending' }));
  const initialStageKey = resolveWorkflowStageKey(workflow, normalizedStageStatuses);
  const artifacts = (Array.isArray(workflow.artifacts) ? workflow.artifacts : [])
    .map((artifact) => {
      const hintMatch = findArtifactHint(workflow, artifact);
      return {
        ...artifact,
        id: artifact.id || hintMatch?.hint.id,
        label: artifact.label || hintMatch?.hint.label || '未命名产物',
        stage: normalizeWorkflowStageKey(artifact.stage || hintMatch?.stageKey),
        substageKey: artifact.substageKey || hintMatch?.substageKey,
        path: (!artifact.path || isLegacyArtifactPath(artifact.path, hintMatch?.legacyHint))
          ? hintMatch?.hint.path || artifact.path
          : artifact.path,
        type: artifact.type || hintMatch?.hint.type,
        status: artifact.status || 'ready',
      };
    })
    .filter((artifact) => validStageKeys.has(artifact.stage));
  const storedChildSessions = Array.isArray(workflow.childSessions)
    ? workflow.childSessions
    : expandWorkflowChatSessions(workflow, workflow.id);
  const childSessions = repairLegacyReviewPassAssignments(
    storedChildSessions.map((session) => normalizeWorkflowChildSession(
      session,
      initialStageKey === 'planning' || workflow.stage === 'discussion' ? 'planning' : undefined,
    )),
  ).sort(compareWorkflowChildSessions);
  const hasPlanningChildSession = childSessions.some(
    (session) => session.stageKey === 'planning' || session.substageKey === 'planner_output',
  );
  const hasVerificationChildSession = childSessions.some(
    (session) => session.stageKey === 'verification'
      || session.substageKey === 'internal_review'
      || /^review_\d+$/.test(String(session.substageKey || '')),
  );
  const hasVerificationArtifact = artifacts.some((artifact) => artifact.stage === 'verification');
  const hasDeliveryArtifact = artifacts.some((artifact) => artifact.stage === 'archive' || artifact.stage === 'ready_for_acceptance');
  const executionStageStatus = normalizedStageStatuses.find((stage) => stage.key === 'execution')?.status || 'pending';
  const verificationStageStatus = normalizedStageStatuses.find((stage) => stage.key === 'verification')?.status || 'pending';
  const repairedStageStatuses = normalizedStageStatuses.map((stage) => {
    if (
      stage.key === 'planning'
      && hasPlanningChildSession
      && ['pending', 'blocked'].includes(stage.status)
    ) {
      return {
        ...stage,
        status: 'active',
      };
    }
    if (
      stage.key === 'verification'
      && executionStageStatus === 'completed'
      && (hasVerificationChildSession || hasVerificationArtifact)
      && ['pending', 'blocked'].includes(stage.status)
    ) {
      return {
        ...stage,
        status: 'active',
      };
    }
    if (
      stage.key === 'archive'
      && verificationStageStatus === 'completed'
      && hasDeliveryArtifact
      && ['pending', 'blocked'].includes(stage.status)
    ) {
      return {
        ...stage,
        status: workflow.finalReadiness === true ? 'completed' : 'active',
      };
    }
    const hasStageChildSession = childSessions.some((session) => (
      session.stageKey === stage.key || session.substageKey === stage.key
    ));
    if (hasStageChildSession && ['pending', 'blocked'].includes(stage.status)) {
      return {
        ...stage,
        status: 'active',
      };
    }
    return stage;
  });
  const currentStageKey = resolveWorkflowStageKey(workflow, repairedStageStatuses);
  const persistedStageKey = workflow.stage === 'discussion'
    ? 'planning'
    : (workflow.stage || currentStageKey);
  const persistedStageStatus = repairedStageStatuses.find((stage) => stage.key === persistedStageKey)?.status;
  const effectiveStageKey = ['completed', 'skipped'].includes(persistedStageStatus)
    ? currentStageKey
    : persistedStageKey;

  return {
    ...workflow,
    title: String(workflow.title || workflow.objective || '新需求').trim(),
    objective: String(workflow.objective || workflow.title || '新需求').trim(),
    adoptsExistingOpenSpec: workflow.adoptsExistingOpenSpec === true,
    openspecChangePrefix: String(workflow.openspecChangePrefix || '').trim(),
    openspecChangeName: String(workflow.openspecChangeName || '').trim(),
    stage: effectiveStageKey,
    runState: workflow.runState || 'pending',
    updatedAt: workflow.updatedAt || new Date().toISOString(),
    hasUnreadActivity: workflow.hasUnreadActivity === true,
    gateDecision: workflow.gateDecision || 'pending',
    stageStatuses: repairedStageStatuses,
    artifacts,
    childSessions,
  };
}

/**
 * Pick the current substage from the coarse workflow state when the store does not
 * yet contain explicit substage snapshots.
 */
function inferCurrentSubstageKey(workflow, currentStageKey, stageKey, artifacts, childSessions) {
  if (stageKey !== currentStageKey) {
    return null;
  }

  return resolveSubstageProgressKey(workflow, stageKey, artifacts, childSessions, currentStageKey);
}

/**
 * Infer the furthest substage supported by persisted evidence for one stage.
 */
function resolveSubstageProgressKey(workflow, stageKey, artifacts, childSessions, activeStageKey = null) {
  if (stageKey === 'planning') {
    const hasPlanningProposal = Boolean(workflow.openspecChangeDetected) || childSessions.some(
      (session) => session.stageKey === 'planning' || session.substageKey === 'planner_output',
    ) || artifacts.some((artifact) => artifact.stage === 'planning' && artifact.substageKey === 'planner_output');
    return hasPlanningProposal || activeStageKey === 'planning' ? 'planner_output' : 'planner_output';
  }

  if (stageKey === 'execution') {
    return 'node_execution';
  }

  if (getReviewPassIndexForSubstage(stageKey)) {
    if (childSessions.some((session) => session.stageKey === stageKey && session.substageKey === 'internal_review')) {
      return 'internal_review';
    }
    return stageKey;
  }

  if (stageKey === 'archive') {
    return 'delivery_package';
  }

  return null;
}

function hasSubstageEvidence(stageKey, substageKey, workflow, artifacts, childSessions) {
  if (stageKey === 'planning' && substageKey === 'planner_output') {
    return Boolean(workflow.openspecChangeDetected)
      || artifacts.some((artifact) => artifact.stage === 'planning' && artifact.substageKey === 'planner_output');
  }

  if (stageKey === 'execution' && substageKey === 'node_execution') {
    const taskProgress = workflow.openspecTaskProgress || null;
    return Boolean(taskProgress && taskProgress.totalTasks > 0 && taskProgress.completedTasks >= taskProgress.totalTasks);
  }

  if (getReviewPassIndexForSubstage(stageKey) && getReviewPassIndexForSubstage(substageKey)) {
    return hasReviewPassResultEvidence(getReviewPassIndexForSubstage(substageKey), artifacts);
  }

  if (FILE_SUBSTAGE_PREDECESSORS[substageKey]) {
    return isSubstageArtifactFresh(substageKey, artifacts);
  }

  if (getReviewPassIndexForSubstage(stageKey) && substageKey === 'internal_review') {
    return artifacts.some((artifact) => artifact.stage === stageKey && artifact.substageKey === substageKey);
  }

  if (stageKey === 'archive' && substageKey === 'delivery_package') {
    return isSubstageArtifactFresh(substageKey, artifacts);
  }

  return artifacts.some((artifact) => artifact.stage === stageKey && artifact.substageKey === substageKey);
}

/**
 * Build fallback substage notes so the UI can explain where a workflow is stuck
 * even when the backend has only stage-level state.
 */
function buildSubstageNote(workflow, substageKey, childSessions, artifacts, status) {
  const reviewPassIndex = getReviewPassIndexForSubstage(substageKey);
  const reviewSessions = Number.isInteger(reviewPassIndex)
    ? getReviewPassSessions(childSessions, substageKey)
    : [];
  const taskProgress = workflow.openspecTaskProgress || null;

  if (status === 'completed') {
    if (substageKey === 'planner_output') {
      return {
        summary: 'OpenSpec 变更提案已生成。',
        statusSource: workflow.openspecChangeDetected || childSessions.length > 0 || artifacts.some((artifact) => artifact.stage === 'planning')
          ? 'OpenSpec / 子会话'
          : '阶段状态',
      };
    }

    if (substageKey === 'node_execution') {
      return {
        summary: taskProgress && taskProgress.totalTasks > 0
          ? `OpenSpec 任务已全部完成（${taskProgress.completedTasks}/${taskProgress.totalTasks}）。`
          : '提案执行已完成。',
        statusSource: taskProgress ? 'OpenSpec 任务状态' : '执行会话',
      };
    }

    if (Number.isInteger(reviewPassIndex)) {
      return {
        summary: `第 ${reviewPassIndex} 轮内部审核已完成。`,
        statusSource: 'Reviewer 子会话',
      };
    }

    if (substageKey === 'delivery_package') {
      return {
        summary: workflow.finalReadiness === true ? '交付说明与产物已整理。' : '交付说明已整理，等待用户最终确认。',
        statusSource: '阶段状态',
      };
    }

    return {};
  }

  if (status === 'skipped') {
    return {};
  }

  if (substageKey === 'planner_output') {
    if (workflow.openspecChangeDetected) {
      return {
        summary: '已经检测到 OpenSpec 变更提案，等待人工审核后继续推进。',
        statusSource: 'OpenSpec',
      };
    }

    if (childSessions.length > 0 || artifacts.some((artifact) => artifact.stage === 'planning')) {
      return {
        summary: '规划会话已创建，等待人工确认后由用户手动触发提案生成。',
        statusSource: '子会话 / 规划产物',
      };
    }

    return {
      summary: '先在规划会话中自由讨论需求，再由用户手动触发提案生成。',
      whyBlocked: '卡在规划提案，尚未看到新的 OpenSpec change proposal。',
      statusSource: '阶段状态',
    };
  }

  if (substageKey === 'node_execution') {
    const executionSessionCount = childSessions.filter((session) => session.substageKey === 'node_execution').length;
    if (taskProgress && taskProgress.totalTasks > 0) {
      return {
        summary: `OpenSpec 任务完成 ${taskProgress.completedTasks}/${taskProgress.totalTasks}。`,
        whyBlocked: executionSessionCount > 0 && taskProgress.completedTasks < taskProgress.totalTasks
          ? 'apply 会话已运行，但 OpenSpec 任务尚未全部完成。'
          : undefined,
        statusSource: 'OpenSpec 任务状态',
      };
    }
    return {
      summary: executionSessionCount > 0 ? 'apply 会话已启动，等待 OpenSpec 任务状态更新。' : '等待 apply 会话真正执行提案内容。',
      whyBlocked: executionSessionCount > 0 ? '尚未检测到已完成的 OpenSpec 任务列表。' : undefined,
      statusSource: executionSessionCount > 0 ? 'OpenSpec 任务状态' : '执行会话',
    };
  }

  if (Number.isInteger(reviewPassIndex)) {
    if (reviewSessions.length > 0) {
      return {
        summary: `第 ${reviewPassIndex} 轮内部审核已生成，可直接查看会话内容。`,
        statusSource: 'Reviewer 子会话',
      };
    }

    return {
      summary: reviewPassIndex === 1
        ? '等待 apply 会话结束后自动派生第 1 轮 reviewer 会话。'
        : `等待第 ${reviewPassIndex - 1} 轮审核完成后继续派生。`,
      statusSource: '验证链路',
    };
  }

  if (substageKey === 'delivery_package') {
    return {
      summary: workflow.gateDecision === 'pending' ? '等待完成验收判断后整理交付说明。' : '等待整理最终交付说明与产物。',
      statusSource: '阶段状态',
    };
  }

  return {};
}

function isInspectableArtifact(artifact = {}) {
  return typeof artifact.path === 'string' && artifact.path.trim().length > 0;
}

/**
 * Convert normalized stage inspections back into the stage status list used by
 * the rest of the workflow read model.
 */
function buildEffectiveStageStatuses(stageInspections) {
  return stageInspections.map((stage) => ({
    key: stage.stageKey,
    label: stage.title,
    status: stage.status,
  }));
}

/**
 * Use OpenSpec task completion as the source of truth before promoting execution into verification.
 */
function applyOpenSpecTaskAwareStageStatuses(workflow, stageStatuses, childSessions, reviewArtifacts = []) {
  const taskProgress = workflow.openspecTaskProgress || null;
  const hasExecutionSession = childSessions.some((session) => (
    session.stageKey === 'execution' || session.substageKey === 'node_execution'
  ));
  const hasArchiveSession = childSessions.some((session) => (
    session.stageKey === 'archive' || session.substageKey === 'delivery_package'
  ));
  const shouldDriveAdoptedOpenSpecExecution = workflow.adoptsExistingOpenSpec === true;
  const executionTasksCompleted = Boolean(
    taskProgress
    && taskProgress.totalTasks > 0
    && taskProgress.completedTasks >= taskProgress.totalTasks,
  );
  const completedReviewPasses = new Set(
    VERIFICATION_REVIEW_PASSES.filter((passIndex) => (
      hasReviewPassResultEvidence(passIndex, reviewArtifacts)
    )),
  );
  const hasArchiveArtifact = isSubstageArtifactFresh('delivery_package', reviewArtifacts);

  return stageStatuses.map((stage) => {
    if (stage.key === 'execution' && (hasExecutionSession || shouldDriveAdoptedOpenSpecExecution)) {
      if (executionTasksCompleted && ['pending', 'active', 'running', 'blocked'].includes(stage.status)) {
        return { ...stage, status: 'completed' };
      }
      if (!executionTasksCompleted && stage.status === 'completed') {
        return { ...stage, status: 'active' };
      }
      if (!executionTasksCompleted && shouldDriveAdoptedOpenSpecExecution && ['pending', 'blocked'].includes(stage.status)) {
        return { ...stage, status: 'active' };
      }
    }

    const reviewPassIndex = getReviewPassIndexForSubstage(stage.key);
    if (Number.isInteger(reviewPassIndex)) {
      if (!executionTasksCompleted) {
        return { ...stage, status: 'pending' };
      }
      if (completedReviewPasses.has(reviewPassIndex)) {
        return { ...stage, status: 'completed' };
      }
      const previousPassCompleted = reviewPassIndex === 1 || completedReviewPasses.has(reviewPassIndex - 1);
      if (previousPassCompleted && ['pending', 'blocked', 'skipped'].includes(stage.status)) {
        return { ...stage, status: 'active' };
      }
      if (!previousPassCompleted && ['active', 'completed', 'blocked', 'skipped'].includes(stage.status)) {
        return { ...stage, status: 'pending' };
      }
    }

    if (stage.key === 'archive' && completedReviewPasses.has(VERIFICATION_REVIEW_PASSES.length)) {
      if (workflow.finalReadiness === true) {
        return { ...stage, status: 'completed' };
      }
      if (hasArchiveSession || hasArchiveArtifact) {
        return { ...stage, status: 'active' };
      }
      return { ...stage, status: 'pending' };
    }

    const hasStageSession = childSessions.some((session) => (
      session.stageKey === stage.key || session.substageKey === stage.key
    ));
    if (hasStageSession && ['pending', 'blocked'].includes(stage.status)) {
      return { ...stage, status: 'active' };
    }

    return stage;
  });
}

/**
 * Derive a workflow-level run state from the corrected stage tree so the
 * summary header cannot contradict substage evidence.
 */
function deriveWorkflowRunState(workflow, stageInspections) {
  if (stageInspections.some((stage) => stage.status === 'failed')) {
    return 'failed';
  }
  if (stageInspections.some((stage) => stage.status === 'blocked')) {
    return 'blocked';
  }
  if (stageInspections.some((stage) => stage.status === 'active' || stage.status === 'running')) {
    return 'running';
  }
  if (stageInspections.length > 0 && stageInspections.every((stage) => ['completed', 'skipped'].includes(stage.status))) {
    return 'completed';
  }
  return workflow.runState || 'pending';
}

/**
 * Keep future-stage residual files from leaking into the UI before the
 * workflow has actually reached that part of the pipeline.
 */
function shouldExposeSubstageFiles(stageStatus, substageStatus) {
  if (stageStatus === 'pending') {
    return false;
  }

  return substageStatus !== 'pending';
}

/**
 * Build a stage tree compatible with the old hybrid control plane dashboard.
 */
function buildStageInspections(workflow, currentStageKey, stageStatuses, artifacts, childSessions, substageFileHints = {}) {
  const stageStatusMap = new Map(stageStatuses.map((stage) => [stage.key, stage.status]));
  let hasIncompletePrerequisiteStage = false;

  return STAGE_TEMPLATES.map((template) => {
    const rawStageStatus = stageStatusMap.get(template.key) || 'pending';
    const currentSubstageKey = inferCurrentSubstageKey(workflow, currentStageKey, template.key, artifacts, childSessions);
    const stageArtifacts = artifacts.filter((artifact) => (artifact.stage || '').toLowerCase() === template.key);
    const stageSessions = childSessions.filter((session) => (
      session.stageKey === template.key
      || (!session.stageKey && template.key === currentStageKey)
      || (getReviewPassIndexForSubstage(template.key) && getReviewPassSessions([session], template.key).length > 0)
    ));
    const hasInternalReviewRepairSession = Number.isInteger(getReviewPassIndexForSubstage(template.key))
      && stageSessions.some((session) => session.substageKey === 'internal_review');
    const templateSubstages = hasInternalReviewRepairSession
      ? [
        ...template.substages,
        { key: 'internal_review', title: '内部修复' },
      ]
      : template.substages;
    const lastSubstageKey = templateSubstages[templateSubstages.length - 1]?.key;
    const progressSubstageKey = resolveSubstageProgressKey(workflow, template.key, stageArtifacts, stageSessions, currentStageKey);
    const progressIndex = templateSubstages.findIndex((item) => item.key === progressSubstageKey);
    const progressSatisfied = progressSubstageKey
      ? hasSubstageEvidence(template.key, progressSubstageKey, workflow, stageArtifacts, stageSessions)
      : false;
    const firstIncompleteCompletedSubstageIndex = rawStageStatus === 'completed' && progressIndex >= 0
      ? template.substages.findIndex((substage, index) => (
        index <= progressIndex
        && !hasSubstageEvidence(template.key, substage.key, workflow, stageArtifacts, stageSessions)
      ))
      : -1;
    let stageStatus = rawStageStatus;
    if (hasIncompletePrerequisiteStage) {
      stageStatus = 'pending';
    } else if (['completed', 'skipped'].includes(rawStageStatus) && stageSessions.length === 0 && !progressSatisfied) {
      stageStatus = 'pending';
    } else if (stageSessions.length > 0 && ['pending', 'blocked'].includes(rawStageStatus)) {
      stageStatus = 'active';
    } else if (
      rawStageStatus === 'completed'
      && (!progressSatisfied || progressIndex < templateSubstages.length - 1 || firstIncompleteCompletedSubstageIndex >= 0)
    ) {
      stageStatus = 'blocked';
      hasIncompletePrerequisiteStage = true;
    }

    const substages = templateSubstages.map((substage, index) => {
      const reviewPassIndexForSubstage = getReviewPassIndexForSubstage(substage.key);
      const evidenceArtifacts = Number.isInteger(reviewPassIndexForSubstage) ? artifacts : stageArtifacts;
      const hasReadyHint = !Number.isInteger(reviewPassIndexForSubstage)
        && (substageFileHints[substage.key] || []).length > 0
        && isSubstageArtifactFresh(substage.key, artifacts);
      const hasEvidence = hasSubstageEvidence(template.key, substage.key, workflow, evidenceArtifacts, stageSessions)
        || hasReadyHint;
      let status = 'pending';
      if (stageStatus === 'completed') {
        status = 'completed';
      } else if (stageStatus === 'skipped') {
        status = 'skipped';
      } else if (stageStatus === 'failed' || stageStatus === 'blocked') {
        const blockedIndex = firstIncompleteCompletedSubstageIndex >= 0 ? firstIncompleteCompletedSubstageIndex : progressIndex;
        status = index === blockedIndex ? stageStatus : index < blockedIndex && hasEvidence ? 'completed' : 'pending';
      } else if (stageStatus === 'active') {
        status = currentSubstageKey === substage.key ? 'active' : index < templateSubstages.findIndex((item) => item.key === currentSubstageKey) ? 'completed' : 'pending';
      }
      if (stageStatus !== 'pending' && status !== 'skipped' && hasEvidence && ['pending', 'active', 'blocked'].includes(status)) {
        status = 'completed';
      }

      const rawFiles = [
        ...stageArtifacts.filter(
          (artifact) =>
            isInspectableArtifact(artifact)
            && (
              artifact.substageKey === substage.key
              || (!artifact.substageKey
                && (substageFileHints[substage.key]?.some((hint) => hint.id === artifact.id) || substage.key === lastSubstageKey))
            ),
        ),
        ...(substageFileHints[substage.key] || [])
          .filter((hint) => isInspectableArtifact(hint) && !stageArtifacts.some((artifact) => artifact.id === hint.id))
          .map((hint) => ({
            ...hint,
            stage: template.key,
            status: hint.exists ? 'ready' : 'missing',
          })),
      ];
      const agentSessions = template.key === 'verification' && getReviewPassIndexForSubstage(substage.key)
        ? getReviewPassSessions(stageSessions, substage.key)
        : stageSessions.filter(
          (session) => session.substageKey === substage.key || (!session.substageKey && currentSubstageKey === substage.key),
        );
      const files = shouldExposeSubstageFiles(stageStatus, status) || agentSessions.length > 0 ? rawFiles : [];
      const hasReadyFiles = files.some((file) => file.exists === true || file.status === 'ready');
      if (status !== 'skipped' && hasReadyFiles && hasEvidence && ['active', 'blocked'].includes(status)) {
        status = 'completed';
      }
      if (hasEvidence && status === 'pending') {
        status = 'completed';
      }
      const note = buildSubstageNote(workflow, substage.key, stageSessions, stageArtifacts, status);

      return {
        stageKey: template.key,
        substageKey: substage.key,
        title: substage.title,
        status,
        files,
        agentSessions,
        ...note,
      };
    });

    const allSubstagesSettled = substages.length > 0 && substages.every((substage) => ['completed', 'skipped'].includes(substage.status));
    const allSubstagesSkipped = substages.length > 0 && substages.every((substage) => substage.status === 'skipped');
    if (allSubstagesSkipped) {
      stageStatus = 'skipped';
    } else if (allSubstagesSettled) {
      stageStatus = 'completed';
    }

    const visibleStageStatus = stageSessions.length > 0 && ['pending', 'blocked'].includes(stageStatus)
      ? 'active'
      : stageStatus;
    const activeSubstage = substages.find((substage) => substage.status === 'active' || substage.status === 'blocked' || substage.status === 'failed');
    const stageNote = activeSubstage?.whyBlocked || activeSubstage?.summary
      || (template.key === 'archive' && visibleStageStatus !== 'pending'
        ? '归档报告已生成，等待用户按报告实际验收并标记工作流结果。'
        : undefined);
    return {
      stageKey: template.key,
      title: template.label,
      status: visibleStageStatus,
      note: stageNote,
      substages,
    };
  });
}

/**
 * Derive concise next actions for the control plane summary.
 */
function buildRecommendedActions(workflow, stageInspections) {
  if (Array.isArray(workflow.recommendedActions) && workflow.recommendedActions.length > 0) {
    return workflow.recommendedActions;
  }

  const activeStage = stageInspections.find((stage) => stage.status === 'active' || stage.status === 'blocked' || stage.status === 'failed');
  const activeSubstage = activeStage?.substages?.find(
    (substage) => substage.status === 'active' || substage.status === 'blocked' || substage.status === 'failed',
  );
  if (!activeSubstage) {
    return [];
  }

  if (activeSubstage.substageKey === 'planner_output') {
    return ['先在规划会话里讨论目标、边界和约束', '确认后由用户手动触发提案生成，再审核 proposal/design/tasks'];
  }

  if (activeSubstage.substageKey === 'node_execution') {
    return ['运行 apply 会话完成提案落地', '确认 OpenSpec tasks 全部完成后再进入三轮评审'];
  }

  if (getReviewPassIndexForSubstage(activeSubstage.substageKey)) {
    return ['查看对应审核会话并处理 findings', '等待后续 reviewer 会话继续推进'];
  }

  if (activeStage.stageKey === 'archive') {
    return ['等待用户按归档报告实际验收，并将工作流标记为成功或待改进'];
  }

  return [activeSubstage.summary || '继续推进当前子阶段'];
}

/**
 * Normalize one workflow into the read model consumed by the UI.
 */
async function normalizeWorkflow(projectPath, workflow) {
  const preparedWorkflow = prepareWorkflowRecord(workflow);
  const resolvedOpenSpecChangeName = preparedWorkflow.openspecChangeName
    || await findOpenSpecChangeByPrefix(projectPath, preparedWorkflow.openspecChangePrefix);
  const openspecChangeName = resolvedOpenSpecChangeName || '';
  const openspecArtifactChangeName = await resolveOpenSpecArtifactChangeName(projectPath, openspecChangeName);
  const openspecChangeStatus = await detectWorkflowOpenSpecChange(projectPath, openspecChangeName);
  const openspecTaskProgress = await readWorkflowOpenSpecTaskProgress(projectPath, openspecChangeName);
  const normalizedWorkflow = {
    ...preparedWorkflow,
    openspecChangeName,
    openspecArtifactChangeName,
    openspecChangeDetected: Boolean(openspecChangeStatus || openspecArtifactChangeName),
    openspecTaskProgress,
  };
  const stageStatuses = Array.isArray(preparedWorkflow.stageStatuses)
    ? preparedWorkflow.stageStatuses.map((stage) => ({
      key: normalizeWorkflowStageKey(stage.key),
      label: STAGE_LABELS[normalizeWorkflowStageKey(stage.key)] || stage.label || stage.key,
      status: stage.status || 'pending',
    }))
    : getWorkflowStages().map((stage) => ({ ...stage, status: 'pending' }));
  const artifacts = await Promise.all(
    (Array.isArray(normalizedWorkflow.artifacts) ? normalizedWorkflow.artifacts : []).map((artifact) => normalizeArtifact(projectPath, artifact)),
  );
  const substageFileHints = await buildNormalizedSubstageFileHints(projectPath, normalizedWorkflow);
  const currentStageKey = resolveWorkflowStageKey(normalizedWorkflow, stageStatuses);
  const childSessions = (Array.isArray(normalizedWorkflow.childSessions) ? normalizedWorkflow.childSessions : []).map((session) => ({
    ...session,
    stageKey: session.stageKey || (currentStageKey === 'planning' ? 'planning' : undefined),
  }));
  const reviewArtifacts = [
    ...artifacts,
    ...Object.values(substageFileHints).flat(),
  ];
  const taskAwareStageStatuses = applyOpenSpecTaskAwareStageStatuses(
    normalizedWorkflow,
    stageStatuses,
    childSessions,
    reviewArtifacts,
  );
  const taskAwareCurrentStageKey = resolveWorkflowStageKey(normalizedWorkflow, taskAwareStageStatuses);
  const stageInspections = buildStageInspections(
    normalizedWorkflow,
    taskAwareCurrentStageKey,
    taskAwareStageStatuses,
    reviewArtifacts,
    childSessions,
    substageFileHints,
  );
  const effectiveStageStatuses = buildEffectiveStageStatuses(stageInspections);
  const effectiveStageKey = resolveWorkflowStageKey(normalizedWorkflow, effectiveStageStatuses);

  return {
    ...normalizedWorkflow,
    stage: effectiveStageKey,
    runState: deriveWorkflowRunState(normalizedWorkflow, stageInspections),
    stageStatuses: effectiveStageStatuses,
    artifacts,
    childSessions,
    stageInspections,
    recommendedActions: buildRecommendedActions(workflow, stageInspections),
  };
}

export async function listProjectWorkflows(projectPath) {
  if (!projectPath) {
    return [];
  }

  const store = await readWorkflowStore(projectPath);
  const entry = store;
  const indexedWorkflows = assignMissingWorkflowRouteIndices(Array.isArray(entry?.workflows) ? entry.workflows : []);
  const workflows = indexedWorkflows.workflows;
  let storeChanged = false;
  if (indexedWorkflows.changed) {
    storeChanged = true;
  }
  const normalizedWorkflows = [];
  const repairedWorkflows = [];

  for (const workflow of workflows) {
    const normalizedWorkflow = await normalizeWorkflow(projectPath, workflow);
    const repairedWorkflow = {
      ...prepareWorkflowRecord(workflow),
      openspecChangeName: normalizedWorkflow.openspecChangeName,
      stage: normalizedWorkflow.stage,
      runState: normalizedWorkflow.runState,
      stageStatuses: normalizedWorkflow.stageStatuses,
    };
    if (JSON.stringify(repairedWorkflow) !== JSON.stringify(workflow)) {
      storeChanged = true;
    }
    normalizedWorkflows.push(normalizedWorkflow);
    repairedWorkflows.push(repairedWorkflow);
  }

  if (storeChanged) {
    store.workflows = repairedWorkflows;
    await writeWorkflowStore(projectPath, store);
  }

  return normalizedWorkflows;
}

export async function attachWorkflowMetadata(projects) {
  return Promise.all(
    projects.map(async (project) => {
      const workflows = await listProjectWorkflows(project.fullPath || project.path || '');
      return {
        ...project,
        workflows,
        hasUnreadActivity: workflows.some((workflow) => workflow.hasUnreadActivity === true),
      };
    }),
  );
}

export function findProjectByName(projects, projectName) {
  return projects.find((project) => project.name === projectName) || null;
}

function getLatestWorkflowStageChildSession(workflow = {}, stageKey = '') {
  const normalizedStageKey = normalizeWorkflowStageKey(stageKey);
  const stageReviewPassIndex = getReviewPassIndexForSubstage(normalizedStageKey);
  const childSessions = Array.isArray(workflow.childSessions) ? workflow.childSessions : [];
  const matchingSessions = childSessions.filter((session) => {
    if (Number.isInteger(stageReviewPassIndex)) {
      return session.stageKey === normalizedStageKey || session.substageKey === normalizedStageKey;
    }
    return normalizeWorkflowStageKey(session.stageKey || session.substageKey) === normalizedStageKey;
  });
  return matchingSessions.sort((left, right) => Number(right.routeIndex || 0) - Number(left.routeIndex || 0))[0] || null;
}

function attachExistingWorkflowStageSession(workflow, stageKey, launcherPayload) {
  const existingSession = getLatestWorkflowStageChildSession(workflow, stageKey);
  if (!existingSession) {
    return launcherPayload;
  }
  return {
    ...launcherPayload,
    sessionId: existingSession.id,
    routeIndex: existingSession.routeIndex,
  };
}

export async function createProjectWorkflow(project, payload = {}) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    throw new Error('Project path is required to create a workflow');
  }

  const store = await readWorkflowStore(projectPath);
  const entry = store;
  const existingWorkflows = assignMissingWorkflowRouteIndices(Array.isArray(entry.workflows) ? entry.workflows : []).workflows;
  const nextRouteIndex = existingWorkflows.reduce((maxValue, candidate) => {
    const parsed = parseWorkflowRouteIndex(candidate?.id) || Number(candidate?.routeIndex);
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, 0) + 1;
  const workflowId = buildWorkflowId(nextRouteIndex);
  const providedChangeName = await validateWorkflowOpenSpecChange(projectPath, payload.openspecChangeName);
  const openspecChangePrefix = providedChangeName
    ? String(providedChangeName).split('-')[0]
    : await buildWorkflowOpenSpecChangePrefix(projectPath, existingWorkflows);
  const workflow = createWorkflowRecord({
    ...payload,
    routeIndex: nextRouteIndex,
    adoptsExistingOpenSpec: Boolean(providedChangeName),
    workflowId,
    openspecChangePrefix,
    openspecChangeName: providedChangeName,
  });

  entry.workflows = [workflow, ...existingWorkflows];
  store.workflows = entry.workflows;
  await writeWorkflowStore(projectPath, store);
  return normalizeWorkflow(projectPath, workflow);
}

export async function listProjectAdoptableOpenSpecChanges(project) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return [];
  }

  return listAdoptableOpenSpecChanges(projectPath);
}

export async function getProjectWorkflow(project, workflowId) {
  const workflows = await listProjectWorkflows(project?.fullPath || project?.path || '');
  return workflows.find((workflow) => workflow.id === workflowId || workflow.legacyId === workflowId) || null;
}

export async function getWorkflowReviewResult(project, workflowId, passIndex) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return null;
  }

  const workflow = await getProjectWorkflow(project, workflowId);
  if (!workflow) {
    return null;
  }

  return readWorkflowReviewResultForWorkflow(projectPath, workflow, passIndex);
}

export async function buildWorkflowLauncherConfig(project, workflowId, stage) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    throw new Error('Project path is required to build workflow launcher config');
  }

  const workflow = await getProjectWorkflow(project, workflowId);
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  const normalizedStage = String(stage || '').trim();
  const reviewMatch = normalizedStage.match(/^review_(\d+)$/);
  if (reviewMatch) {
    const passIndex = Number.parseInt(reviewMatch[1], 10);
    return attachExistingWorkflowStageSession(
      workflow,
      normalizedStage,
      await buildReviewLauncherPayload(workflow, passIndex),
    );
  }

  const repairMatch = normalizedStage.match(/^repair_(\d+)$/);
  if (repairMatch) {
    const passIndex = Number.parseInt(repairMatch[1], 10);
    const reviewResult = await readWorkflowReviewResultForWorkflow(projectPath, workflow, passIndex);
    return attachExistingWorkflowStageSession(
      workflow,
      normalizedStage,
      await buildRepairLauncherPayload(workflow, passIndex, reviewResult),
    );
  }

  const modeToStage = {
    planning: { workflowAutoStart: 'planning', workflowStageKey: 'planning', workflowSubstageKey: 'planner_output' },
    execution: { workflowAutoStart: 'execution', workflowStageKey: 'execution', workflowSubstageKey: 'node_execution' },
    archive: { workflowAutoStart: 'archive', workflowStageKey: 'archive', workflowSubstageKey: 'delivery_package' },
  }[normalizedStage];

  if (!modeToStage) {
    throw new Error(`Unsupported workflow launcher stage: ${normalizedStage}`);
  }

  const template = normalizedStage === 'planning'
    ? await buildPlanningKickoffPrompt(workflow)
    : await readPromptTemplate(normalizedStage);
  return attachExistingWorkflowStageSession(workflow, normalizedStage, {
    workflowId: workflow.id,
    workflowTitle: workflow.title,
    workflowChangeName: workflow.openspecChangeName,
    ...modeToStage,
    sessionSummary: buildLauncherSummary(normalizedStage, workflow.title),
    autoPrompt: normalizedStage === 'planning'
      ? template.trim()
      : [
        template.trim(),
        '',
        '## 当前工作流上下文',
        `- 工作流标题：${workflow.title}`,
        `- 工作流 ID：${workflow.id}`,
        `- OpenSpec change：${workflow.openspecChangeName}`,
      ].join('\n'),
  });
}

export async function markWorkflowRead(project, workflowId) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return null;
  }

  const store = await readWorkflowStore(projectPath);
  const entry = store;
  if (!entry?.workflows) {
    return null;
  }

  let updatedWorkflow = null;
  entry.workflows = entry.workflows.map((workflow) => {
    if (workflow.id !== workflowId) {
      return workflow;
    }

    updatedWorkflow = {
      ...workflow,
      hasUnreadActivity: false,
      updatedAt: new Date().toISOString(),
    };
    return updatedWorkflow;
  });

  store.workflows = entry.workflows;
  await writeWorkflowStore(projectPath, store);
  return updatedWorkflow ? normalizeWorkflow(projectPath, updatedWorkflow) : null;
}

/**
 * PURPOSE: Persist a user-defined workflow title without changing workflow ids
 * or any underlying session/jsonl filenames.
 */
export async function renameWorkflow(project, workflowId, title) {
  const projectPath = project?.fullPath || project?.path || '';
  const trimmedTitle = String(title || '').trim();
  if (!projectPath) {
    return null;
  }
  if (!trimmedTitle) {
    throw new Error('Workflow title is required');
  }

  const store = await readWorkflowStore(projectPath);
  const entry = store;
  if (!entry?.workflows) {
    return null;
  }

  let updatedWorkflow = null;
  entry.workflows = entry.workflows.map((workflow) => {
    if (workflow.id !== workflowId) {
      return workflow;
    }

    updatedWorkflow = {
      ...workflow,
      title: trimmedTitle,
      updatedAt: new Date().toISOString(),
    };
    return updatedWorkflow;
  });

  store.workflows = entry.workflows;
  await writeWorkflowStore(projectPath, store);
  return updatedWorkflow ? normalizeWorkflow(projectPath, updatedWorkflow) : null;
}

export async function deleteWorkflow(project, workflowId) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return false;
  }

  const store = await readWorkflowStore(projectPath);
  const entry = store;
  if (!entry?.workflows) {
    return false;
  }

  const workflowToDelete = entry.workflows.find((workflow) => workflow.id === workflowId);
  if (!workflowToDelete) {
    return false;
  }

  const childSessions = Array.isArray(workflowToDelete.childSessions)
    ? workflowToDelete.childSessions
    : expandWorkflowChatSessions(workflowToDelete, workflowToDelete.id);
  for (const session of childSessions) {
    await deleteWorkflowChildSessionFile(projectPath, session);
  }

  entry.workflows = entry.workflows.filter((workflow) => workflow.id !== workflowId);
  store.workflows = entry.workflows;
  await writeWorkflowStore(projectPath, store, {
    deletedWorkflowId: workflowId,
    deletedWorkflowChildSessions: childSessions,
  });
  return true;
}

/**
 * PURPOSE: Persist cross-device UI flags for one workflow card.
 */
export async function updateWorkflowUiState(project, workflowId, uiState = {}) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return null;
  }

  const store = await readWorkflowStore(projectPath);
  const entry = store;
  if (!entry?.workflows) {
    return null;
  }

  let updatedWorkflow = null;
  entry.workflows = entry.workflows.map((workflow) => {
    if (workflow.id !== workflowId) {
      return workflow;
    }

    updatedWorkflow = {
      ...workflow,
      updatedAt: new Date().toISOString(),
    };

    if (uiState.favorite === true) {
      updatedWorkflow.favorite = true;
    } else {
      delete updatedWorkflow.favorite;
    }

    if (uiState.pending === true) {
      updatedWorkflow.pending = true;
    } else {
      delete updatedWorkflow.pending;
    }

    if (uiState.hidden === true) {
      updatedWorkflow.hidden = true;
    } else {
      delete updatedWorkflow.hidden;
    }

    return updatedWorkflow;
  });

  store.workflows = entry.workflows;
  await writeWorkflowStore(projectPath, store);
  return updatedWorkflow ? normalizeWorkflow(projectPath, updatedWorkflow) : null;
}

export async function updateWorkflowGateDecision(project, workflowId, gateDecision) {
  /**
   * Persist the user's final acceptance gate so the workflow read model can
   * distinguish accepted delivery from delivery that still needs polishing.
   */
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return null;
  }

  const normalizedDecision = String(gateDecision || '').trim();
  if (!['pass', 'needs_repair'].includes(normalizedDecision)) {
    throw new Error('Workflow gate decision must be pass or needs_repair');
  }

  const store = await readWorkflowStore(projectPath);
  const entry = store;
  if (!entry?.workflows) {
    return null;
  }

  let updatedWorkflow = null;
  entry.workflows = entry.workflows.map((workflow) => {
    if (workflow.id !== workflowId) {
      return workflow;
    }

    const stageStatuses = Array.isArray(workflow.stageStatuses)
      ? workflow.stageStatuses.map((stage) => ({
        key: stage.key,
        label: STAGE_LABELS[stage.key] || stage.label || stage.key,
        status: stage.status || 'pending',
      }))
      : getWorkflowStages().map((stage) => ({ ...stage, status: 'pending' }));
    const finalReadiness = normalizedDecision === 'pass';
    const nextArchiveStatus = finalReadiness ? 'completed' : 'blocked';

    updatedWorkflow = {
      ...workflow,
      stage: 'archive',
      runState: finalReadiness ? 'completed' : 'blocked',
      gateDecision: normalizedDecision,
      finalReadiness,
      hasUnreadActivity: true,
      updatedAt: new Date().toISOString(),
      stageStatuses: stageStatuses.map((stage) => {
        if (['planning', 'execution', 'verification'].includes(stage.key)) {
          return { ...stage, status: 'completed' };
        }
        if (normalizeWorkflowStageKey(stage.key) === 'archive') {
          return { ...stage, status: nextArchiveStatus };
        }
        return stage;
      }),
    };
    return updatedWorkflow;
  });

  store.workflows = entry.workflows;
  await writeWorkflowStore(projectPath, store);
  return updatedWorkflow ? normalizeWorkflow(projectPath, updatedWorkflow) : null;
}

export async function registerWorkflowChildSession(project, workflowId, sessionPayload = {}) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath || !sessionPayload?.sessionId) {
    return null;
  }

  const store = await readWorkflowStore(projectPath);
  const entry = store;
  if (!entry?.workflows) {
    return null;
  }
  entry.workflows = assignMissingWorkflowRouteIndices(entry.workflows).workflows;
  const targetWorkflowExists = entry.workflows.some((workflow) => workflow.id === workflowId);
  if (!targetWorkflowExists) {
    return null;
  }

  const requestedReviewPassForGate = (() => {
    const explicit = Number.parseInt(String(sessionPayload.reviewPassIndex || ''), 10);
    if (Number.isInteger(explicit) && explicit > 0) {
      return explicit;
    }
    return getReviewPassIndexForSubstage(sessionPayload.substageKey || sessionPayload.stageKey);
  })();
  const usesCurrentReviewStageAddress = Boolean(
    getReviewPassIndexForSubstage(sessionPayload.substageKey)
    || getReviewPassIndexForSubstage(sessionPayload.stageKey),
  );
  const targetWorkflow = entry.workflows.find((workflow) => workflow.id === workflowId) || null;
  if (
    usesCurrentReviewStageAddress
    && Number.isInteger(requestedReviewPassForGate)
    && requestedReviewPassForGate > 1
    && targetWorkflow
  ) {
    const previousReviewResult = await readWorkflowReviewResultForWorkflow(
      projectPath,
      targetWorkflow,
      requestedReviewPassForGate - 1,
    );
    if (!previousReviewResult) {
      return normalizeWorkflow(projectPath, targetWorkflow);
    }
  }

  let updatedWorkflow = null;
  const sessionId = String(sessionPayload.sessionId || '');
  const isTemporarySessionId = (candidate) => (
    String(candidate || '').startsWith('new-session-') || /^c\d+$/.test(String(candidate || ''))
  );
  const isConcreteProviderSession = sessionId && !isTemporarySessionId(sessionId);
  entry.workflows = entry.workflows.map((workflow) => {
    if (workflow.id !== workflowId) {
      const existingChildSessions = expandWorkflowChatSessions(workflow, workflow.id);
      if (!isConcreteProviderSession || existingChildSessions.length === 0) {
        return workflow;
      }

      const childSessions = existingChildSessions.filter((session) => session.id !== sessionId);
      if (childSessions.length === existingChildSessions.length) {
        return workflow;
      }

      return {
        ...workflow,
        childSessions,
        chat: compactChildSessionsToWorkflowChat(childSessions),
        updatedAt: new Date().toISOString(),
      };
    }

    const stageStatuses = Array.isArray(workflow.stageStatuses)
      ? workflow.stageStatuses.map((stage) => ({
        key: stage.key,
        label: STAGE_LABELS[stage.key] || stage.label || stage.key,
        status: stage.status || 'pending',
      }))
      : getWorkflowStages().map((stage) => ({ ...stage, status: 'pending' }));
    const currentStageKey = resolveWorkflowStageKey(workflow, stageStatuses);
    const childSessions = expandWorkflowChatSessions(workflow, workflow.id);
    const requestedReviewPassIndex = Number.parseInt(String(sessionPayload.reviewPassIndex || ''), 10);
    const reviewPassIndex = Number.isInteger(requestedReviewPassIndex) && requestedReviewPassIndex > 0
      ? requestedReviewPassIndex
      : undefined;
    const stageKey = sessionPayload.stageKey || (reviewPassIndex
      ? buildReviewPassStageKey(reviewPassIndex)
      : currentStageKey);
    const inferredSubstageKey = inferCurrentSubstageKey(workflow, currentStageKey, stageKey, workflow.artifacts || [], childSessions)
      || undefined;
    const substageKey = sessionPayload.substageKey || (reviewPassIndex
      ? buildReviewPassSubstageKey(reviewPassIndex)
      : inferredSubstageKey);
    const nextRouteIndex = childSessions.reduce((maxValue, session) => {
      const parsed = Number(session?.routeIndex);
      return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
    }, 0) + 1;
    const existingIndex = childSessions.findIndex((session) => session.id === sessionPayload.sessionId);
    const normalizedReviewPassIndex = Number.isInteger(Number(reviewPassIndex)) && Number(reviewPassIndex) > 0
      ? Number(reviewPassIndex)
      : getReviewPassIndexForSubstage(substageKey || stageKey);
    const matchesReviewPass = (session) => {
      const existingReviewPassIndex = Number.isInteger(Number(session.reviewPassIndex)) && Number(session.reviewPassIndex) > 0
        ? Number(session.reviewPassIndex)
        : getReviewPassIndexForSubstage(session.substageKey || session.stageKey);
      if (normalizedReviewPassIndex || existingReviewPassIndex) {
        return existingReviewPassIndex === normalizedReviewPassIndex;
      }
      return true;
    };
    const matchesSubstageSlot = (session) => (
      (session.substageKey || '') === (substageKey || '')
      || !session.substageKey
      || !substageKey
    );
    const matchingStageSessionIndex = existingIndex >= 0
      ? -1
      : childSessions.findIndex((session) => (
        (session.stageKey || '') === (stageKey || '')
        && matchesSubstageSlot(session)
        && matchesReviewPass(session)
      ));
    const draftReplacementIndex = existingIndex >= 0
      ? -1
      : childSessions.findIndex((session) => (
        isTemporarySessionId(session.id)
        && !isTemporarySessionId(sessionPayload.sessionId)
        && (session.provider || 'claude') === (sessionPayload.provider || 'claude')
        && (session.stageKey || '') === (stageKey || '')
        && matchesSubstageSlot(session)
        && matchesReviewPass(session)
      ));
    const replacementIndex = existingIndex >= 0
      ? existingIndex
      : (draftReplacementIndex >= 0 ? draftReplacementIndex : matchingStageSessionIndex);
    const existingSession = replacementIndex >= 0 ? childSessions[replacementIndex] : null;

    const nextSession = {
      id: sessionPayload.sessionId,
      routeIndex: Number.isInteger(Number(sessionPayload.routeIndex))
        ? Number(sessionPayload.routeIndex)
        : (Number.isInteger(Number(existingSession?.routeIndex)) ? Number(existingSession.routeIndex) : nextRouteIndex),
      title: sessionPayload.title || sessionPayload.summary || '子会话',
      summary: sessionPayload.summary || sessionPayload.title || '子会话',
      provider: sessionPayload.provider || 'claude',
      workflowId: workflow.id,
      projectPath,
      stageKey,
      substageKey,
      reviewPassIndex,
      url: sessionPayload.url,
    };
    const nextChildSessions = replacementIndex >= 0
      ? childSessions.map((session, index) => (index === replacementIndex ? { ...session, ...nextSession } : session))
      : [nextSession, ...childSessions];
    const normalizedStageKey = normalizeWorkflowStageKey(stageKey) || currentStageKey;
    const registeredStageStatus = stageStatuses.find((stage) => normalizeWorkflowStageKey(stage.key) === normalizedStageKey)?.status;
    const shouldAdvanceToRegisteredStage = normalizedStageKey && (
      normalizedStageKey !== currentStageKey || registeredStageStatus === 'pending'
    );
    const nextStageStatuses = shouldAdvanceToRegisteredStage
      ? buildActiveStageStatuses(stageStatuses, normalizedStageKey)
      : stageStatuses;

    updatedWorkflow = {
      ...workflow,
      stage: shouldAdvanceToRegisteredStage ? normalizedStageKey : workflow.stage,
      runState: shouldAdvanceToRegisteredStage ? 'running' : workflow.runState,
      stageStatuses: nextStageStatuses,
      childSessions: nextChildSessions,
      chat: compactChildSessionsToWorkflowChat(nextChildSessions),
      hasUnreadActivity: true,
      updatedAt: new Date().toISOString(),
    };
    return updatedWorkflow;
  });

  store.workflows = entry.workflows;
  await writeWorkflowStore(projectPath, store);
  return updatedWorkflow ? normalizeWorkflow(projectPath, updatedWorkflow) : null;
}

export async function advanceWorkflow(project, workflowId) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return null;
  }

  const store = await readWorkflowStore(projectPath);
  const entry = store;
  if (!entry?.workflows) {
    return null;
  }

  let updatedWorkflow = null;
  entry.workflows = entry.workflows.map((workflow) => {
    if (workflow.id !== workflowId) {
      return workflow;
    }

    const stageStatuses = Array.isArray(workflow.stageStatuses)
      ? workflow.stageStatuses.map((stage) => ({
        key: stage.key,
        label: STAGE_LABELS[stage.key] || stage.label || stage.key,
        status: stage.status || 'pending',
      }))
      : getWorkflowStages().map((stage) => ({ ...stage, status: 'pending' }));
    const currentStageKey = resolveWorkflowStageKey(workflow, stageStatuses);
    if (currentStageKey === 'planning') {
      updatedWorkflow = {
        ...workflow,
        stage: 'execution',
        runState: 'running',
        hasUnreadActivity: true,
        updatedAt: new Date().toISOString(),
        stageStatuses: stageStatuses.map((stage) => {
          if (stage.key === 'planning') {
            return { ...stage, status: 'completed' };
          }
          if (stage.key === 'execution') {
            return { ...stage, status: 'active' };
          }
          return { ...stage, status: 'pending' };
        }),
      };
      return updatedWorkflow;
    }

    updatedWorkflow = {
      ...workflow,
      hasUnreadActivity: true,
      updatedAt: new Date().toISOString(),
    };
    return updatedWorkflow;
  });

  store.workflows = entry.workflows;
  await writeWorkflowStore(projectPath, store);
  return updatedWorkflow ? normalizeWorkflow(projectPath, updatedWorkflow) : null;
}
