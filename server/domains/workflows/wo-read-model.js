/**
 * PURPOSE: Convert sealed wo runner state files into ccflow ProjectWorkflow
 * read models without reading or writing legacy workflow mirror config.
 */
import path from 'path';
import { promises as fs } from 'fs';

const RUNS_ROOT = path.join('.wo', 'runs');
const STAGE_LABELS = {
  planning: '规划提案',
  execution: '执行',
  verification: '审核',
  ready_for_acceptance: '待验收',
  review_1: '初审',
  repair_1: '初修',
  review_2: '再审',
  repair_2: '再修',
  review_3: '三审',
  repair_3: '三修',
  archive: '归档',
};
const LEGACY_STAGE_ORDER = {
  planning: -1,
  verification: Number.MAX_SAFE_INTEGER - 4,
  ready_for_acceptance: Number.MAX_SAFE_INTEGER - 3,
};
const TERMINAL_METADATA_STAGES = new Set(['done']);
const REVIEW_TITLES = {
  review_1: '需求与范围覆盖',
  review_2: '实现风险与回归',
  review_3: '验收与交付闭环',
};
const SUBSTAGE_TITLES = {
  planning: '规划提案',
  execution: '提案落地',
  verification: '审核',
  ready_for_acceptance: '待验收',
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
 * Return a snake_case runner field value.
 */
function pick(object, snakeKey) {
  return object?.[snakeKey];
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
 * Infer a default runner role for a stage when wo only reports stage state.
 */
function inferRole(stage) {
  return String(stage || '').startsWith('review') ? 'reviewer' : 'executor';
}

/**
 * Build a human-facing stage label.
 */
function stageLabel(stage) {
  const normalized = String(stage || '').trim();
  const reviewMatch = normalized.match(/^review_(\d+)$/);
  if (reviewMatch) {
    return Number(reviewMatch[1]) === 1 ? '初审' : `${Number(reviewMatch[1])}审`;
  }
  const repairMatch = normalized.match(/^repair_(\d+)$/);
  if (repairMatch) {
    return Number(repairMatch[1]) === 1 ? '初修' : `${Number(repairMatch[1])}修`;
  }
  return STAGE_LABELS[normalized] || normalized;
}

/**
 * Convert wo internal stage keys into the exact user-visible checklist text.
 */
function stageDisplayText(stage) {
  const normalized = String(stage || '').trim();
  if (normalized === 'execution') {
    return 'start';
  }
  if (normalized === 'review_1') {
    return 'review';
  }
  if (normalized === 'archive') {
    return 'archive';
  }
  const repairMatch = normalized.match(/^repair_(\d+)$/);
  if (repairMatch) {
    return `${repairMatch[1]} fix`;
  }
  const reviewMatch = normalized.match(/^review_(\d+)$/);
  if (reviewMatch) {
    return `${Number(reviewMatch[1]) - 1} fix review`;
  }
  return normalized;
}

/**
 * Parse wo runner stage keys into sortable workflow positions.
 */
function parseRunnerStage(stage) {
  const normalized = String(stage || '').trim();
  if (!normalized || TERMINAL_METADATA_STAGES.has(normalized)) {
    return { known: true, displayable: false, order: Number.POSITIVE_INFINITY };
  }
  if (normalized === 'execution') {
    return { known: true, displayable: true, order: 0 };
  }
  if (Object.prototype.hasOwnProperty.call(LEGACY_STAGE_ORDER, normalized)) {
    return { known: true, displayable: true, order: LEGACY_STAGE_ORDER[normalized] };
  }
  if (normalized === 'archive') {
    return { known: true, displayable: true, order: Number.MAX_SAFE_INTEGER - 1 };
  }
  const reviewMatch = normalized.match(/^review_(\d+)$/);
  if (reviewMatch) {
    const iteration = Number(reviewMatch[1]);
    if (Number.isInteger(iteration) && iteration > 0) {
      return { known: true, displayable: true, order: iteration * 2 - 1 };
    }
  }
  const repairMatch = normalized.match(/^repair_(\d+)$/);
  if (repairMatch) {
    const iteration = Number(repairMatch[1]);
    if (Number.isInteger(iteration) && iteration > 0) {
      return { known: true, displayable: true, order: iteration * 2 };
    }
  }
  return { known: false, displayable: true, order: Number.MAX_SAFE_INTEGER };
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
  const paths = pick(state, 'paths') || {};
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
  const stages = pick(state, 'stages') || {};
  const stageKeys = new Set();
  if (currentStage && parseRunnerStage(currentStage).displayable) {
    stageKeys.add(currentStage);
  }
  for (const stage of Object.keys(stages && typeof stages === 'object' ? stages : {})) {
    const parsedStage = parseRunnerStage(stage);
    if (!parsedStage.displayable) {
      continue;
    }
    stageKeys.add(stage);
    if (!parsedStage.known) {
      warnings.push(`Unknown runner stage: ${stage}`);
    }
  }
  return [...stageKeys].sort((left, right) => {
    const leftStage = parseRunnerStage(left);
    const rightStage = parseRunnerStage(right);
    if (leftStage.order !== rightStage.order) {
      return leftStage.order - rightStage.order;
    }
    return left.localeCompare(right);
  }).map((key) => ({
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
  const explicit = pick(state, 'processes');
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit.map((process) => {
      const unknownFields = Object.keys(process && typeof process === 'object' ? process : {})
        .filter((key) => !KNOWN_PROCESS_FIELDS.has(key));
      unknownFields.forEach((key) => {
        warnings.push(`Unknown runner process field: ${key}`);
      });
      const stage = String(pick(process, 'stage') || '').trim();
      const role = String(pick(process, 'role') || inferRole(stage)).trim();
      const logPath = normalizeRelativePath('', pick(process, 'log_path') || process?.logPath || logsByKey.get(`${stage}_${role}_log`) || logsByKey.get(`${role}_log`) || logsByKey.get(`${stage}_log`));
      return {
        stage,
        role,
        status: String(pick(process, 'status') || '').trim() || undefined,
        sessionId: String(pick(process, 'session_id') || process?.sessionId || '').trim() || undefined,
        pid: Number.isInteger(process?.pid) ? process.pid : undefined,
        exitCode: Number.isInteger(pick(process, 'exit_code') ?? process?.exitCode) ? (pick(process, 'exit_code') ?? process?.exitCode) : undefined,
        failed: process?.failed === true,
        logPath: logPath || undefined,
      };
    }).map((process) => Object.fromEntries(Object.entries(process).filter(([, value]) => value !== undefined && value !== '')));
  }

  const sessions = pick(state, 'sessions') || {};
  return stageStatuses.map((stageStatus) => {
    const role = inferRole(stageStatus.key);
    const allowRoleFallback = stageStatus.status === 'active' || String(pick(state, 'stage') || '') === stageStatus.key;
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

function sessionMatchesJsonlName(sessionId, jsonlName) {
  /**
   * Match wo display jsonl labels to the runner session id they are derived
   * from; a same-stage session is not enough evidence for a link.
   */
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedJsonlName = path.posix.basename(String(jsonlName || '').trim());
  if (!normalizedSessionId || !normalizedJsonlName) {
    return false;
  }
  return normalizedJsonlName === `${normalizedSessionId}.jsonl`
    || normalizedJsonlName.replace(/\.jsonl$/i, '') === normalizedSessionId;
}

/**
 * Match wo checklist jsonl labels to runner child sessions.
 */
function findSessionRefForStage(stageKey, childSessions, runnerProcesses, warnings, jsonlName) {
  const hasJsonlName = Boolean(String(jsonlName || '').trim());
  const stageSession = childSessions.find((session) => (
    session.stageKey === stageKey
    && (!hasJsonlName || sessionMatchesJsonlName(session.id, jsonlName))
  ));
  if (stageSession) {
    return {
      label: jsonlName || `${stageSession.id}.jsonl`,
      sessionId: stageSession.id,
      provider: stageSession.provider || 'codex',
      stageKey,
      address: stageSession.address,
      routePath: stageSession.routePath,
    };
  }
  const process = runnerProcesses.find((entry) => (
    entry.stage === stageKey
    && entry.sessionId
    && (!hasJsonlName || sessionMatchesJsonlName(entry.sessionId, jsonlName))
  ));
  if (process) {
    return {
      label: jsonlName || `${process.sessionId}.jsonl`,
      sessionId: process.sessionId,
      provider: 'codex',
      stageKey,
      routePath: `/runs/${encodeURIComponent(childSessions[0]?.workflowId || '')}/sessions/by-id/${encodeURIComponent(process.sessionId)}`,
    };
  }
  if (hasJsonlName) {
    warnings.push(`Unable to match workflow display session: ${jsonlName}`);
    return {
      label: jsonlName,
      stageKey,
    };
  }
  return null;
}

/**
 * Generate only the wo checklist lines that have happened or are currently active.
 */
function buildWorkflowDisplayLines(state, stageStatuses, childSessions, runnerProcesses, warnings) {
  const displayLines = Array.isArray(state?.workflow_display?.lines) ? state.workflow_display.lines : [];
  if (displayLines.length > 0) {
    return displayLines.map((line, index) => {
      const rawLine = String(line?.raw_line || line?.rawLine || '').trim();
      const marker = String(line?.marker || rawLine.match(/^[✓→ ]/)?.[0] || '').trim() || ' ';
      const text = String(line?.text || rawLine.replace(/^[✓→ ]\s*/, '').replace(/\s+\S+\.jsonl$/, '') || '').trim();
      const jsonlName = rawLine.match(/(\S+\.jsonl)\s*$/)?.[1] || String(line?.session_ref?.label || '').trim();
      const stageKey = String(line?.stage_key || stageStatuses[index]?.key || '').trim();
      return {
        id: String(line?.id || `${index}:${text}`),
        marker,
        text,
        status: String(line?.status || (marker === '✓' ? 'completed' : marker === '→' ? 'active' : 'pending')),
        rawLine: rawLine || [marker, text, jsonlName].filter(Boolean).join(' '),
        ...(jsonlName ? { sessionRef: findSessionRefForStage(stageKey, childSessions, runnerProcesses, warnings, jsonlName) } : {}),
      };
    });
  }

  return stageStatuses
    .filter((stage) => stage.status !== 'pending')
    .map((stage) => {
      const marker = stage.status === 'completed' ? '✓' : stage.status === 'active' ? '→' : ' ';
      const text = stageDisplayText(stage.key);
      const sessionRef = findSessionRefForStage(stage.key, childSessions, runnerProcesses, warnings, '');
      const rawLine = [marker, text, sessionRef?.label].filter(Boolean).join(' ');
      return {
        id: stage.key,
        marker,
        text,
        status: stage.status,
        rawLine,
        ...(sessionRef ? { sessionRef } : {}),
      };
    });
}

/**
 * Build the legacy auxiliary inspection model from wo-derived fields.
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
export async function buildWoWorkflowReadModel({ projectPath, runDirName, state, statePath, stateStat }) {
  const warnings = [];
  const runId = String(pick(state, 'run_id') || runDirName || '').trim();
  const changeName = String(pick(state, 'change_name') || '').trim();
  const rawStatus = String(pick(state, 'status') || '').trim();
  const rawStage = String(pick(state, 'stage') || '').trim();
  const updatedAt = String(pick(state, 'updated_at') || stateStat?.mtime?.toISOString?.() || runDirName || '').trim();
  const { artifacts, logsByKey } = await buildPathReadModel(projectPath, state, warnings);
  const stageStatuses = buildStageStatuses(state, rawStage, rawStatus, warnings);
  const runnerProcesses = buildRunnerProcesses(state, stageStatuses, logsByKey, warnings);
  const childSessions = buildChildSessions(runId, runnerProcesses, warnings);
  const workflowDisplay = {
    lines: buildWorkflowDisplayLines(state, stageStatuses, childSessions, runnerProcesses, warnings),
  };
  const runnerError = String(pick(state, 'error') || '').trim();
  const diagnostics = {
    statePath: normalizeRelativePath(projectPath, statePath),
    stateMtime: stateStat?.mtime?.toISOString?.() || null,
    rawStatus,
    rawStage,
    woContractVersion: String(pick(state, 'contract_version') || ''),
    woContractOk: true,
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
    workflowDisplay,
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
 * Discover all wo state files and convert valid ones without one bad run
 * preventing other runs from rendering.
 */
export async function listWoWorkflowReadModels(projectPath) {
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
      workflows.push(await buildWoWorkflowReadModel({
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
            woContractVersion: '',
            woContractOk: false,
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
