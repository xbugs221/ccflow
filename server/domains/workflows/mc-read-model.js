/**
 * PURPOSE: Convert sealed mc runner state files into ccflow ProjectWorkflow
 * read models without reading or writing legacy workflow mirror config.
 */
import path from 'path';
import { promises as fs } from 'fs';

const RUNS_ROOT = path.join('.ccflow', 'runs');
const KNOWN_STAGES = ['planning', 'execution', 'review_1', 'repair_1', 'review_2', 'repair_2', 'review_3', 'repair_3', 'archive'];
const STAGE_LABELS = {
  planning: '规划提案',
  execution: '执行',
  review_1: '初审',
  repair_1: '初修',
  review_2: '再审',
  repair_2: '再修',
  review_3: '三审',
  repair_3: '三修',
  archive: '归档',
};
const REVIEW_TITLES = {
  review_1: '需求与范围覆盖',
  review_2: '实现风险与回归',
  review_3: '验收与交付闭环',
};
const SUBSTAGE_TITLES = {
  planning: '规划提案',
  execution: '提案落地',
  review_1: '需求与范围覆盖',
  repair_1: '初修产物',
  review_2: '实现风险与回归',
  repair_2: '再修产物',
  review_3: '验收与交付闭环',
  repair_3: '三修产物',
  archive: '归档',
};
const KNOWN_PROCESS_FIELDS = new Set([
  'stage',
  'stageKey',
  'stage_key',
  'role',
  'status',
  'sessionId',
  'session_id',
  'pid',
  'exitCode',
  'exit_code',
  'failed',
  'logPath',
  'log_path',
]);

/**
 * Return the first non-empty value from camelCase or snake_case runner fields.
 */
function pick(object, camelKey, snakeKey) {
  return object?.[camelKey] ?? object?.[snakeKey];
}

/**
 * Convert arbitrary runner paths to project-relative slash paths.
 */
function normalizeRelativePath(projectPath, value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const normalized = raw.replace(/\\/g, '/');
  if (!path.isAbsolute(raw)) {
    return normalized;
  }
  return path.relative(projectPath, raw).replace(/\\/g, '/');
}

/**
 * Map runner status words to the Web workflow state vocabulary.
 */
function mapRunState(status) {
  const normalized = String(status || '').toLowerCase();
  if (['completed', 'done', 'archived', 'success', 'succeeded'].includes(normalized)) {
    return 'completed';
  }
  if (['failed', 'error', 'aborted', 'blocked'].includes(normalized)) {
    return 'blocked';
  }
  return 'running';
}

/**
 * Map runner stage status words to UI stage status words.
 */
function mapStageStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (['completed', 'done', 'success', 'succeeded', 'archived'].includes(normalized)) {
    return 'completed';
  }
  if (['running', 'active', 'in_progress'].includes(normalized)) {
    return 'active';
  }
  if (['failed', 'error', 'aborted', 'blocked'].includes(normalized)) {
    return 'blocked';
  }
  return 'pending';
}

/**
 * Infer a default runner role for a stage when mc only reports stage state.
 */
function inferRole(stage) {
  return String(stage || '').startsWith('review') ? 'reviewer' : 'executor';
}

/**
 * Build a human-facing stage label.
 */
function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage;
}

/**
 * Decide whether a runner path is a log, artifact, or internal path.
 */
function classifyPath(key, value) {
  const normalizedKey = String(key || '');
  const normalizedValue = String(value || '');
  const basename = path.posix.basename(normalizedValue.replace(/\\/g, '/'));
  if (!normalizedValue || normalizedKey === 'state' || normalizedKey === 'state_json' || /\.lock$/i.test(basename)) {
    return { kind: 'hidden' };
  }
  if (/_log$/i.test(normalizedKey) || /Log$/.test(normalizedKey)) {
    return { kind: 'log', type: 'log', label: normalizedKey.replace(/_/g, ' ') };
  }
  if (/^review_\d+$/.test(normalizedKey)) {
    return { kind: 'artifact', type: 'review-result', stage: normalizedKey, label: `Review result ${normalizedKey.split('_')[1]}` };
  }
  if (/^repair_\d+_summary$/.test(normalizedKey)) {
    const stage = normalizedKey.replace('_summary', '');
    return { kind: 'artifact', type: 'repair-summary', stage, label: `Repair summary ${stage.split('_')[1]}` };
  }
  if (normalizedKey === 'delivery_summary') {
    return { kind: 'artifact', type: 'delivery-summary', stage: 'archive', label: path.posix.basename(normalizedValue) || 'delivery-summary.md' };
  }
  if (normalizedKey === 'summary') {
    return { kind: 'artifact', type: 'summary', stage: 'execution', label: path.posix.basename(normalizedValue) || 'SUMMARY.md' };
  }
  if (normalizedKey === 'workflow_output') {
    return { kind: 'artifact', type: 'directory', semanticType: 'workflow-output', stage: 'execution', label: 'workflow-output' };
  }
  return {
    kind: 'artifact',
    type: 'artifact',
    label: normalizedKey.replace(/_/g, ' ') || basename,
    warning: `Unknown runner path key: ${normalizedKey || basename || '<empty>'}`,
  };
}

/**
 * Return whether a project-relative path currently exists.
 */
async function pathExists(projectPath, relativePath) {
  try {
    await fs.access(path.join(projectPath, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize runner paths into artifacts and log lookup diagnostics.
 */
async function buildPathReadModel(projectPath, state, warnings) {
  const artifacts = [];
  const logsByKey = new Map();
  const paths = pick(state, 'paths', 'paths') || {};
  for (const [key, value] of Object.entries(paths && typeof paths === 'object' ? paths : {})) {
    const relativePath = normalizeRelativePath(projectPath, value);
    const classification = classifyPath(key, relativePath);
    if (classification.kind === 'hidden') {
      continue;
    }
    const exists = await pathExists(projectPath, relativePath);
    if (!exists) {
      warnings.push(`Referenced path does not exist: ${relativePath}`);
    }
    if (classification.kind === 'log') {
      logsByKey.set(key, relativePath);
      continue;
    }
    if (classification.warning) {
      warnings.push(classification.warning);
    }
    artifacts.push({
      id: `${key}:${relativePath}`,
      label: classification.label,
      type: classification.type,
      semanticType: classification.semanticType,
      stage: classification.stage,
      relativePath,
      path: relativePath,
      exists,
    });
  }
  return { artifacts, logsByKey };
}

/**
 * Normalize stage statuses from runner state and current stage fallback.
 */
function buildStageStatuses(state, currentStage, rawStatus, warnings) {
  const stages = pick(state, 'stages', 'stages') || {};
  const stageKeys = new Set(KNOWN_STAGES);
  if (currentStage) {
    stageKeys.add(currentStage);
  }
  for (const stage of Object.keys(stages && typeof stages === 'object' ? stages : {})) {
    stageKeys.add(stage);
    if (!KNOWN_STAGES.includes(stage)) {
      warnings.push(`Unknown runner stage: ${stage}`);
    }
  }
  return [...stageKeys].map((key) => ({
    key,
    label: stageLabel(key),
    status: mapStageStatus(key === currentStage ? rawStatus : (stages[key] || 'pending')),
    provider: 'codex',
  }));
}

/**
 * Normalize runner process rows from explicit processes or stage fallbacks.
 */
function buildRunnerProcesses(state, stageStatuses, logsByKey, warnings) {
  const explicit = pick(state, 'processes', 'processes');
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit.map((process) => {
      const unknownFields = Object.keys(process && typeof process === 'object' ? process : {})
        .filter((key) => !KNOWN_PROCESS_FIELDS.has(key));
      unknownFields.forEach((key) => {
        warnings.push(`Unknown runner process field: ${key}`);
      });
      const stage = String(pick(process, 'stage', 'stage') || '').trim();
      const role = String(pick(process, 'role', 'role') || inferRole(stage)).trim();
      const logPath = normalizeRelativePath('', pick(process, 'logPath', 'log_path') || logsByKey.get(`${stage}_${role}_log`) || logsByKey.get(`${role}_log`) || logsByKey.get(`${stage}_log`));
      return {
        stage,
        role,
        status: String(pick(process, 'status', 'status') || '').trim() || undefined,
        sessionId: String(pick(process, 'sessionId', 'session_id') || '').trim() || undefined,
        pid: Number.isInteger(process?.pid) ? process.pid : undefined,
        exitCode: Number.isInteger(pick(process, 'exitCode', 'exit_code')) ? pick(process, 'exitCode', 'exit_code') : undefined,
        failed: process?.failed === true,
        logPath: logPath || undefined,
      };
    }).map((process) => Object.fromEntries(Object.entries(process).filter(([, value]) => value !== undefined && value !== '')));
  }

  const sessions = pick(state, 'sessions', 'sessions') || {};
  return stageStatuses.map((stageStatus) => {
    const role = inferRole(stageStatus.key);
    const allowRoleFallback = stageStatus.status === 'active' || String(pick(state, 'stage', 'stage') || '') === stageStatus.key;
    const sessionId = String(
      sessions[stageStatus.key]
      || sessions[`${stageStatus.key}_${role}`]
      || (allowRoleFallback ? sessions[role] : '')
      || '',
    ).trim();
    const logPath = logsByKey.get(`${stageStatus.key}_${role}_log`)
      || logsByKey.get(`${stageStatus.key}_log`)
      || (allowRoleFallback ? logsByKey.get(`${role}_log`) : '');
    return {
      stage: stageStatus.key,
      role,
      status: stageStatus.status === 'active' ? 'running' : stageStatus.status,
      ...(sessionId ? { sessionId } : {}),
      ...(logPath ? { logPath } : {}),
    };
  });
}

/**
 * Build non-conflicting child session addresses for runner-owned sessions.
 */
function buildChildSessions(runId, processes, warnings) {
  const withSession = processes.filter((process) => process.sessionId);
  const baseCounts = new Map();
  for (const process of withSession) {
    const key = `${process.stage}/${process.role || ''}`;
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  }
  return withSession.map((process) => {
    const role = process.role || inferRole(process.stage);
    const baseKey = `${process.stage}/${role}`;
    let address = process.stage;
    if (withSession.filter((entry) => entry.stage === process.stage).length > 1) {
      address = `${process.stage}/${role}`;
    }
    if ((baseCounts.get(baseKey) || 0) > 1) {
      address = `by-id/${process.sessionId}`;
      warnings.push(`Duplicate child session address for ${baseKey}; using by-id fallback.`);
    }
    const title = REVIEW_TITLES[process.stage] || stageLabel(process.stage) || '工作流子会话';
    return {
      id: process.sessionId,
      title,
      summary: title,
      provider: 'codex',
      role,
      workflowId: runId,
      stageKey: process.stage,
      address,
      routePath: `/runs/${encodeURIComponent(runId)}/sessions/${address.split('/').map(encodeURIComponent).join('/')}`,
    };
  });
}

/**
 * Build the frontend stage tree read model from mc-derived fields.
 */
function buildStageInspections(stageStatuses, childSessions, artifacts, runnerError, diagnostics) {
  return stageStatuses.map((stage) => {
    const stageSessions = childSessions.filter((session) => session.stageKey === stage.key);
    const stageArtifacts = artifacts.filter((artifact) => artifact.stage === stage.key);
    if (stage.key === 'archive' && !stageArtifacts.some((artifact) => artifact.type === 'delivery-summary')) {
      stageArtifacts.push({
        id: 'delivery-summary:delivery-summary.md',
        label: 'delivery-summary.md',
        type: 'delivery-summary',
        stage: 'archive',
        relativePath: 'delivery-summary.md',
        path: 'delivery-summary.md',
        exists: false,
      });
    }
    return {
      stageKey: stage.key,
      title: stage.label || stage.key,
      status: stage.status,
      provider: 'codex',
      note: stage.status === 'blocked' ? runnerError || undefined : undefined,
      warnings: (diagnostics.warnings || []).map((message) => ({
        type: 'runner_diagnostic',
        stageKey: stage.key,
        provider: 'codex',
        message,
      })),
      recoveryEvents: [],
      substages: [{
        stageKey: stage.key,
        substageKey: stage.key,
        title: SUBSTAGE_TITLES[stage.key] || stage.label || stage.key,
        status: stage.status,
        summary: stage.status === 'blocked' ? runnerError || undefined : undefined,
        files: stageArtifacts,
        agentSessions: stageSessions,
      }],
    };
  });
}

/**
 * Convert one parsed state file into a ProjectWorkflow read model.
 */
export async function buildMcWorkflowReadModel({ projectPath, runDirName, state, statePath, stateStat }) {
  const warnings = [];
  const runId = String(pick(state, 'runId', 'run_id') || runDirName || '').trim();
  const changeName = String(pick(state, 'changeName', 'change_name') || '').trim();
  const rawStatus = String(pick(state, 'status', 'status') || '').trim();
  const rawStage = String(pick(state, 'stage', 'stage') || '').trim();
  const updatedAt = String(pick(state, 'updatedAt', 'updated_at') || stateStat?.mtime?.toISOString?.() || runDirName || '').trim();
  const { artifacts, logsByKey } = await buildPathReadModel(projectPath, state, warnings);
  const stageStatuses = buildStageStatuses(state, rawStage, rawStatus, warnings);
  const runnerProcesses = buildRunnerProcesses(state, stageStatuses, logsByKey, warnings);
  const childSessions = buildChildSessions(runId, runnerProcesses, warnings);
  const runnerError = String(pick(state, 'error', 'error') || '').trim();
  const diagnostics = {
    statePath: normalizeRelativePath(projectPath, statePath),
    stateMtime: stateStat?.mtime?.toISOString?.() || null,
    rawStatus,
    rawStage,
    mcContractVersion: String(pick(state, 'contractVersion', 'contract_version') || ''),
    mcContractOk: true,
    runnerError,
    pathCount: Object.keys(state?.paths || {}).length,
    sessionCount: Object.keys(state?.sessions || {}).length,
    processCount: Array.isArray(state?.processes) ? state.processes.length : runnerProcesses.length,
    warnings,
  };
  const stageInspections = buildStageInspections(stageStatuses, childSessions, artifacts, runnerError, diagnostics);

  return {
    id: runId,
    title: changeName || runId,
    objective: changeName || runId,
    openspecChangeName: changeName,
    openspecChangeDetected: Boolean(changeName),
    adoptsExistingOpenSpec: Boolean(changeName),
    runner: 'go',
    runnerProvider: 'codex',
    runId,
    runnerError,
    failureReason: runnerError || undefined,
    stage: rawStage || 'execution',
    runState: mapRunState(rawStatus),
    updatedAt,
    stageStatuses,
    artifacts,
    childSessions,
    runnerProcesses,
    stageInspections,
    controlPlaneReadModel: { stages: stageInspections },
    controllerEvents: diagnostics.warnings.map((message) => ({
      type: 'runner_diagnostic',
      provider: 'codex',
      message,
    })),
    hasUnreadActivity: mapRunState(rawStatus) === 'running',
    runnerDiagnostics: diagnostics,
    diagnostics,
  };
}

/**
 * Discover all mc state files and convert valid ones without one bad run
 * preventing other runs from rendering.
 */
export async function listMcWorkflowReadModels(projectPath) {
  if (!projectPath) {
    return [];
  }
  const runsRoot = path.join(projectPath, RUNS_ROOT);
  let entries = [];
  try {
    entries = await fs.readdir(runsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const workflows = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const statePath = path.join(runsRoot, entry.name, 'state.json');
    try {
      const stateStat = await fs.stat(statePath);
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      workflows.push(await buildMcWorkflowReadModel({
        projectPath,
        runDirName: entry.name,
        state,
        statePath,
        stateStat,
      }));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        workflows.push({
          id: entry.name,
          title: entry.name,
          objective: entry.name,
          runner: 'go',
          runnerProvider: 'codex',
          runId: entry.name,
          runnerError: `Unreadable runner state: ${error?.message || String(error)}`,
          stage: 'unknown',
          runState: 'blocked',
          updatedAt: entry.name,
          stageStatuses: [],
          artifacts: [],
          childSessions: [],
          runnerProcesses: [],
          runnerDiagnostics: {
            statePath: normalizeRelativePath(projectPath, statePath),
            stateMtime: null,
            rawStatus: '',
            rawStage: '',
            mcContractVersion: '',
            mcContractOk: false,
            runnerError: `Unreadable runner state: ${error?.message || String(error)}`,
            pathCount: 0,
            sessionCount: 0,
            processCount: 0,
            warnings: [`Unreadable runner state: ${error?.message || String(error)}`],
          },
        });
      }
    }
  }

  return workflows.sort((left, right) => {
    const timeDelta = Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || '');
    if (Number.isFinite(timeDelta) && timeDelta !== 0) {
      return timeDelta;
    }
    return String(left.title || left.runId || left.id).localeCompare(String(right.title || right.runId || right.id));
  });
}
