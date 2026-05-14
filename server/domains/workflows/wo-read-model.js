/**
 * PURPOSE: Convert sealed wo runner state files into ccflow ProjectWorkflow
 * read models without reading or writing legacy workflow mirror config.
 */
import path from 'path';
import { promises as fs } from 'fs';
import {
  formatWoStatePathForDiagnostics,
  resolveWoBatchesRoot,
  resolveWoRunsRoot,
} from './wo-runtime-paths.js';

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
const FIXED_ARTIFACT_PATTERNS = [
  { regex: /^review-(\d+)\.(?:json|md|markdown)$/i, stage: (n) => `review_${n}`, type: 'review-result' },
  { regex: /^fix-(\d+)\.(?:json|md|markdown)$/i, stage: (n) => `fix_${n}`, type: 'fix-result' },
  { regex: /^repair-(\d+)\.(?:json|md|markdown)$/i, stage: (n) => `repair_${n}`, type: 'repair-result' },
  { regex: /^fix-(\d+)-summary\.(?:json|md|markdown)$/i, stage: (n) => `fix_${n}`, type: 'repair-summary' },
  { regex: /^repair-(\d+)-summary\.(?:json|md|markdown)$/i, stage: (n) => `repair_${n}`, type: 'repair-summary' },
];
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
  const normalized = String(stage || '').trim();
  if (normalized.startsWith('review')) {
    return 'reviewer';
  }
  if (normalized === 'archive') {
    return 'archiver';
  }
  return 'executor';
}

/**
 * Parse both historical repair_N keys and the current wo fix_N keys.
 */
function parseFixStage(stage) {
  const match = String(stage || '').trim().match(/^(?:repair|fix)_(\d+)$/);
  if (!match) {
    return null;
  }
  const iteration = Number(match[1]);
  return Number.isInteger(iteration) && iteration > 0 ? iteration : null;
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
  const fixIteration = parseFixStage(normalized);
  if (fixIteration) {
    return fixIteration === 1 ? '初修' : `${fixIteration}修`;
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
  const fixIteration = parseFixStage(normalized);
  if (fixIteration) {
    return `${fixIteration} fix`;
  }
  const reviewMatch = normalized.match(/^review_(\d+)$/);
  if (reviewMatch) {
    return `${Number(reviewMatch[1]) - 1} fix review`;
  }
  return normalized;
}

/**
 * Parse a provider-prefixed session key into provider and role.
 * Examples: "codex:executor" -> { provider: "codex", role: "executor" }
 *           "opencode:archiver" -> { provider: "opencode", role: "archiver" }
 *           "pi:executor" -> { provider: "pi", role: "executor" }
 */
function parseProviderSessionKey(key) {
  const normalized = String(key || '').trim();
  const match = normalized.match(/^([a-z][a-z0-9]*):(.+)$/);
  if (match) {
    return { provider: match[1], role: match[2] };
  }
  return { provider: null, role: normalized };
}

/**
 * Check if a provider is known and can be rendered by ccflow.
 */
function isKnownProvider(provider) {
  return provider === 'codex' || provider === 'opencode';
}

/**
 * Normalize wo v1 batch run_ids from the real map contract or legacy arrays.
 */
function normalizeBatchRunIds(runIds, changes) {
  if (Array.isArray(runIds)) {
    return runIds.map(String);
  }
  if (!runIds || typeof runIds !== 'object') {
    return [];
  }
  return changes
    .map((changeName) => runIds[changeName])
    .filter((runId) => runId)
    .map(String);
}

/**
 * Convert the 0-based wo current_index into the progress number users see.
 */
function displayBatchCurrentIndex(currentIndex, total) {
  if (total <= 0) {
    return 0;
  }
  return Math.min(Math.max(currentIndex + 1, 1), total);
}

/**
 * Preserve wo state.sessions as provider-aware ids for frontend filtering.
 */
function buildWorkflowOwnedSessionRefs(state) {
  const sessions = pick(state, 'sessions') || {};
  if (!sessions || typeof sessions !== 'object') {
    return [];
  }
  return Object.entries(sessions)
    .map(([key, value]) => {
      const sessionId = String(value || '').trim();
      if (!sessionId) {
        return null;
      }
      const parsed = parseProviderSessionKey(key);
      return {
        key,
        role: parsed.role,
        provider: parsed.provider || 'codex',
        sessionId,
      };
    })
    .filter(Boolean);
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
  const fixIteration = parseFixStage(normalized);
  if (fixIteration) {
    return { known: true, displayable: true, order: fixIteration * 2 };
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
    const roleSessionId = sessions[role] || sessions[`codex:${role}`] || sessions[`claude:${role}`];
    const sessionId = String(
      sessions[stageStatus.key]
      || sessions[`${stageStatus.key}_${role}`]
      || (allowRoleFallback ? sessions[role] : '')
      || roleSessionId
      || '',
    ).trim();
    const logPath = logsByKey.get(`${stageStatus.key}_${role}_log`)
      || logsByKey.get(`${stageStatus.key}_log`)
      || (allowRoleFallback ? logsByKey.get(`${role}_log`) : '')
      || logsByKey.get(`${role}_log`);
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

function sessionMatchesJsonlName(sessionId, jsonlName, logPath = '') {
  /**
   * Match wo display jsonl labels to the runner session id they are derived
   * from; a same-stage session is not enough evidence for a link.
   */
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedJsonlName = path.posix.basename(String(jsonlName || '').trim());
  const normalizedLogName = path.posix.basename(String(logPath || '').trim());
  if (!normalizedSessionId || !normalizedJsonlName) {
    return false;
  }
  return normalizedJsonlName === `${normalizedSessionId}.jsonl`
    || normalizedJsonlName.replace(/\.jsonl$/i, '') === normalizedSessionId
    || normalizedJsonlName === normalizedLogName;
}

/**
 * Return the most readable jsonl label for a runner process link.
 */
function sessionJsonlLabel(sessionId, logPath = '') {
  const logName = path.posix.basename(String(logPath || '').trim());
  if (/\.jsonl$/i.test(logName)) {
    return logName;
  }
  return `${sessionId}.jsonl`;
}

/**
 * Match wo checklist jsonl labels to runner child sessions.
 */
function findSessionRefForStage(stageKey, childSessions, runnerProcesses, warnings, jsonlName) {
  const hasJsonlName = Boolean(String(jsonlName || '').trim());
  if (!hasJsonlName && !parseRunnerStage(stageKey).known) {
    return null;
  }
  const stageProcess = runnerProcesses.find((entry) => entry.stage === stageKey && entry.sessionId);
  const stageSession = childSessions.find((session) => (
    session.stageKey === stageKey
    && (!hasJsonlName || sessionMatchesJsonlName(session.id, jsonlName, stageProcess?.logPath))
  ));
  if (stageSession) {
    return {
      label: jsonlName || sessionJsonlLabel(stageSession.id, stageProcess?.logPath),
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
    && (!hasJsonlName || sessionMatchesJsonlName(entry.sessionId, jsonlName, entry.logPath))
  ));
  if (process) {
    return {
      label: jsonlName || sessionJsonlLabel(process.sessionId, process.logPath),
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
 * Remove standalone repair rows once wo has emitted the following review row.
 */
function collapseSupersededRepairLines(lines) {
  const reviewedFixNumbers = new Set(lines
    .map((line) => String(line.text || '').trim().match(/^(\d+)\s+fix\s+review$/)?.[1])
    .filter(Boolean));
  if (reviewedFixNumbers.size === 0) {
    return lines;
  }
  return lines.filter((line) => {
    const fixNumber = String(line.text || '').trim().match(/^(\d+)\s+fix$/)?.[1];
    return !fixNumber || !reviewedFixNumbers.has(fixNumber);
  });
}

/**
 * Generate only the wo checklist lines that have happened or are currently active.
 */
function buildWorkflowDisplayLines(state, stageStatuses, childSessions, runnerProcesses, warnings) {
  const displayLines = Array.isArray(state?.workflow_display?.lines) ? state.workflow_display.lines : [];
  if (displayLines.length > 0) {
    return collapseSupersededRepairLines(displayLines.map((line, index) => {
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
    }));
  }

  return collapseSupersededRepairLines(stageStatuses
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
    }));
}

/**
 * Build wo 0.9 fixed-role summary rows from state stages and sessions.
 */
function buildWorkflowRoleSummary(state, childSessions) {
  const stages = pick(state, 'stages') || {};
  const sessions = pick(state, 'sessions') || {};
  const stageEntries = Object.entries(stages && typeof stages === 'object' ? stages : {});

  let writeCount = 0;
  let reviewCount = 0;
  let fixCount = 0;
  let archiveCount = 0;

  for (const [stageKey, status] of stageEntries) {
    const normalizedStatus = String(status || '').toLowerCase();
    const isDone = ['completed', 'done', 'success', 'succeeded', 'archived'].includes(normalizedStatus);
    const isActive = ['running', 'active', 'in_progress'].includes(normalizedStatus);
    if (!isDone && !isActive) {
      continue;
    }
    if (stageKey === 'execution') {
      writeCount += 1;
    } else if (parseFixStage(stageKey)) {
      fixCount += 1;
    } else if (/^review_\d+$/.test(stageKey)) {
      reviewCount += 1;
    } else if (stageKey === 'archive') {
      archiveCount += 1;
    }
  }

  /**
   * Resolve a session id by checking all known provider prefixes for a role.
   */
  function findSessionByRole(role) {
    for (const [key, value] of Object.entries(sessions && typeof sessions === 'object' ? sessions : {})) {
      const parsed = parseProviderSessionKey(key);
      if (parsed.role === role && value) {
        return { sessionId: String(value).trim(), provider: parsed.provider || 'codex' };
      }
    }
    return null;
  }

  function resolveSessionRef(role, label) {
    let sessionId;
    let sessionProvider = 'codex';

    const providerMatch = findSessionByRole(role);
    if (providerMatch) {
      sessionId = providerMatch.sessionId;
      sessionProvider = providerMatch.provider;
    }
    if (!sessionId) {
      const roleFallbacks = {
        executor: ['execution'],
        reviewer: ['review_1', 'review_2', 'review_3'],
        fixer: ['fix_1', 'fix_2', 'fix_3', 'repair_1', 'repair_2', 'repair_3'],
        archiver: ['archive'],
        planning: ['planning'],
      };
      const fallbacks = roleFallbacks[role] || [];
      for (const key of fallbacks) {
        if (sessions[key]) {
          sessionId = String(sessions[key]).trim();
          break;
        }
      }
    }
    if (!sessionId) {
      const childMatch = childSessions.find((s) => s.role === role || s.stageKey === role);
      if (childMatch) {
        sessionId = childMatch.id;
        sessionProvider = childMatch.provider || 'codex';
      }
    }
    if (!sessionId) {
      return null;
    }

    // Check if provider is known; if not, return unlinked reference
    if (!isKnownProvider(sessionProvider)) {
      return { label: label || sessionId, sessionId, provider: sessionProvider, unlinked: true };
    }

    const session = childSessions.find((s) => s.id === sessionId);
    if (session) {
      return {
        label: label || sessionId,
        sessionId,
        provider: session.provider || sessionProvider,
        stageKey: session.stageKey,
        address: session.address,
        routePath: session.routePath,
      };
    }
    return {
      label: label || sessionId,
      sessionId,
      provider: sessionProvider,
      routePath: `/runs/${encodeURIComponent(state?.run_id || '')}/sessions/by-id/${encodeURIComponent(sessionId)}`,
    };
  }

  const planningSessionId = sessions.planning || sessions['codex:planning'];

  return {
    rows: [
      {
        key: 'planning',
        label: '规',
        role: 'planning',
        sessionRef: planningSessionId ? resolveSessionRef('planning', 'planning') : null,
        placeholder: planningSessionId ? undefined : '未知',
        checkCount: 0,
      },
      {
        key: 'executor',
        label: '写',
        role: 'executor',
        sessionRef: resolveSessionRef('executor', ''),
        checkCount: writeCount,
      },
      {
        key: 'reviewer',
        label: '审',
        role: 'reviewer',
        sessionRef: resolveSessionRef('reviewer', ''),
        checkCount: reviewCount,
      },
      {
        key: 'fixer',
        label: '修',
        role: 'fixer',
        sessionRef: resolveSessionRef('fixer', ''),
        checkCount: fixCount,
      },
      {
        key: 'archiver',
        label: '存',
        role: 'archiver',
        sessionRef: resolveSessionRef('archiver', ''),
        checkCount: archiveCount,
      },
    ],
  };
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
 * Scan a run directory for fixed artifact files such as review-N.json, fix-N.md, and repair-N.json.
 */
async function scanRunDirFixedArtifacts(runDir, runId, warnings) {
  const artifacts = [];
  let entries = [];
  try {
    entries = await fs.readdir(runDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      warnings.push(`Cannot read run directory for fixed artifacts: ${error.message}`);
    }
    return artifacts;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    for (const pattern of FIXED_ARTIFACT_PATTERNS) {
      const match = name.match(pattern.regex);
      if (match) {
        const round = Number(match[1]);
        const stage = pattern.stage(round);
        const absolutePath = path.join(runDir, name);
        artifacts.push({
          id: `fixed:${runId}:${name}`,
          label: name,
          type: pattern.type,
          semanticType: pattern.type,
          stage,
          relativePath: absolutePath,
          path: absolutePath,
          exists: true,
          round,
          source: 'run-dir-scan',
        });
        break;
      }
    }
  }

  return artifacts;
}

/**
 * Merge run-dir-scanned artifacts with path-based artifacts, deduplicating by label.
 */
function mergeArtifacts(pathArtifacts, scannedArtifacts) {
  const merged = [...pathArtifacts];
  const pathLabels = new Set(pathArtifacts.map((a) => a.label));
  for (const scanned of scannedArtifacts) {
    if (!pathLabels.has(scanned.label)) {
      merged.push(scanned);
    }
  }
  return merged;
}

/**
 * Read and build a batch read model from a batch state.json file.
 */
export async function buildBatchReadModel({ projectPath, batchDirName, state, statePath, stateStat }) {
  const batchId = String(state?.batch_id || batchDirName || '').trim();
  const status = String(state?.status || '').trim();
  const changes = Array.isArray(state?.changes) ? state.changes : [];
  const currentIndex = Number.isInteger(state?.current_index) ? state.current_index : (changes.length > 0 ? changes.length - 1 : 0);
  const runIds = normalizeBatchRunIds(state?.run_ids, changes);
  const error = String(state?.error || '').trim();
  const total = Math.max(changes.length, runIds.length);

  return {
    id: batchId,
    status: mapRunState(status),
    currentIndex,
    displayCurrentIndex: displayBatchCurrentIndex(currentIndex, total),
    total,
    runIds,
    changes,
    error: error || undefined,
    // displayId is assigned after sorting all batches
    displayId: '',
  };
}

/**
 * Discover all batch state files for a project and return batch read models.
 */
export async function listBatchReadModels(projectPath) {
  if (!projectPath) {
    return [];
  }
  const batchesRoot = resolveWoBatchesRoot(projectPath);
  let entries = [];
  try {
    entries = await fs.readdir(batchesRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const batches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const statePath = path.join(batchesRoot, entry.name, 'state.json');
    try {
      const stateStat = await fs.stat(statePath);
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      batches.push(await buildBatchReadModel({
        projectPath,
        batchDirName: entry.name,
        state,
        statePath,
        stateStat,
      }));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error(`Failed to read batch state ${statePath}:`, error.message);
      }
    }
  }

  // Assign displayIds by sorting batches (newest first by dir name convention)
  batches.sort((left, right) => right.id.localeCompare(left.id));
  batches.forEach((batch, index) => {
    batch.displayId = `b${index + 1}`;
  });

  return batches;
}

/**
 * Build a map of runId -> batch context for quick lookup during run read model building.
 */
export function buildBatchContextMap(batches) {
  const map = {};
  for (const batch of batches) {
    batch.runIds.forEach((runId, index) => {
      map[runId] = {
        batchId: batch.id,
        batchDisplayId: batch.displayId,
        batchIndex: index + 1,
        batchTotal: batch.total,
        batchStatus: batch.status,
      };
    });
  }
  return map;
}

/**
 * Resolve the oz change document directory for a given change name.
 * Checks active path first, then archive exact match, then archive suffix-scan.
 * Returns the matching directory name and full path, or null if not found.
 */
async function resolveOzChangeDocDir(projectPath, changeName) {
  if (!projectPath || !changeName) {
    return null;
  }

  const activeDir = path.join(projectPath, 'docs', 'changes', changeName);
  try {
    await fs.access(activeDir);
    return { dirName: changeName, fullPath: activeDir };
  } catch {
    // not active — try archive
  }

  // Scan archive for matching directories: exact name or <prefix>-<changeName>
  // All candidates compete by mtime so a newer suffixed directory can override an older exact match.
  const archiveRoot = path.join(projectPath, 'docs', 'changes', 'archive');
  let candidates = [];
  try {
    const entries = await fs.readdir(archiveRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === changeName || entry.name.endsWith(`-${changeName}`)) {
        const fullPath = path.join(archiveRoot, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          candidates.push({ dirName: entry.name, fullPath, mtime: stat.mtimeMs });
        } catch {
          // skip unreadable
        }
      }
    }
  } catch {
    // no archive directory at all
  }

  if (candidates.length === 0) {
    return null;
  }

  // Select the candidate with the latest mtime
  candidates.sort((a, b) => b.mtime - a.mtime);
  return { dirName: candidates[0].dirName, fullPath: candidates[0].fullPath };
}

/**
 * Build planning artifacts from oz change documents.
 * Returns an array of WorkflowArtifact entries for proposal.md, design.md, spec.md, task.md.
 */
async function buildPlanningArtifacts(projectPath, changeName) {
  if (!projectPath || !changeName) {
    return [];
  }

  const docDir = await resolveOzChangeDocDir(projectPath, changeName);
  const docNames = ['proposal.md', 'design.md', 'spec.md', 'task.md'];

  return Promise.all(docNames.map(async (docName) => {
    // Use the relative path derived from the resolved fullPath to handle archive subdirectories
    const relativeDir = docDir
      ? path.relative(projectPath, docDir.fullPath).replace(/\\/g, '/')
      : path.posix.join('docs', 'changes', changeName);
    const relativePath = path.posix.join(relativeDir, docName);
    const exists = docDir
      ? (await pathExists(projectPath, relativePath))
      : false;
    return {
      id: `oz-planning:${changeName}:${docName}`,
      label: docName,
      type: 'oz-change-doc',
      semanticType: 'oz-change-doc',
      stage: 'planning',
      substageKey: 'planning',
      relativePath,
      path: relativePath,
      exists,
    };
  }));
}

/**
 * Convert one parsed state file into a ProjectWorkflow read model.
 */
export async function buildWoWorkflowReadModel({ projectPath, runDirName, state, statePath, stateStat, batchContext }) {
  const warnings = [];
  const runId = String(pick(state, 'run_id') || runDirName || '').trim();
  const changeName = String(pick(state, 'change_name') || '').trim();
  const rawStatus = String(pick(state, 'status') || '').trim();
  const rawStage = String(pick(state, 'stage') || '').trim();
  const updatedAt = String(pick(state, 'updated_at') || stateStat?.mtime?.toISOString?.() || runDirName || '').trim();
  const { artifacts: pathArtifacts, logsByKey } = await buildPathReadModel(projectPath, state, warnings);

  // Scan run directory for fixed artifact files
  const runDir = path.join(resolveWoRunsRoot(projectPath), runDirName);
  const scannedArtifacts = await scanRunDirFixedArtifacts(runDir, runId, warnings);

  let artifacts = mergeArtifacts(pathArtifacts, scannedArtifacts);

  // Inject planning artifacts from oz change documents
  const planningArtifacts = await buildPlanningArtifacts(projectPath, changeName);
  if (planningArtifacts.length > 0) {
    const pathLabels = new Set(artifacts.map((a) => a.label));
    for (const planningArtifact of planningArtifacts) {
      if (!pathLabels.has(planningArtifact.label)) {
        artifacts.push(planningArtifact);
      }
    }
  }

  const stageStatuses = buildStageStatuses(state, rawStage, rawStatus, warnings);
  const runnerProcesses = buildRunnerProcesses(state, stageStatuses, logsByKey, warnings);
  const childSessions = buildChildSessions(runId, runnerProcesses, warnings);
  const workflowDisplay = {
    lines: buildWorkflowDisplayLines(state, stageStatuses, childSessions, runnerProcesses, warnings),
  };
  const workflowRoleSummary = buildWorkflowRoleSummary(state, childSessions);
  const runnerError = String(pick(state, 'error') || '').trim();
  const workflowOwnedSessions = buildWorkflowOwnedSessionRefs(state);
  const diagnostics = {
    statePath: formatWoStatePathForDiagnostics(statePath),
    stateMtime: stateStat?.mtime?.toISOString?.() || null,
    rawStatus,
    rawStage,
    woContractVersion: String(pick(state, 'contract_version') || ''),
    woContractOk: true,
    runnerError,
    pathCount: Object.keys(state?.paths || {}).length,
    sessionCount: Object.keys(state?.sessions || {}).length,
    workflowOwnedSessions,
    workflowOwnedSessionIds: workflowOwnedSessions.map((session) => session.sessionId),
    processCount: Array.isArray(state?.processes) ? state.processes.length : runnerProcesses.length,
    warnings,
  };
  const stageInspections = buildStageInspections(stageStatuses, childSessions, artifacts, runnerError, diagnostics);

  const result = {
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
    workflowRoleSummary,
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

  // Attach batch context if this run belongs to a batch
  if (batchContext?.[runId]) {
    Object.assign(result, batchContext[runId]);
  }

  return result;
}

/**
 * Discover all wo state files and convert valid ones without one bad run
 * preventing other runs from rendering.
 */
export async function listWoWorkflowReadModels(projectPath) {
  if (!projectPath) {
    return [];
  }

  // Load batch context first so we can attach it to individual runs
  let batchContext;
  try {
    const batches = await listBatchReadModels(projectPath);
    batchContext = buildBatchContextMap(batches);
  } catch (error) {
    console.error(`Failed to load batch context for ${projectPath}:`, error.message);
    batchContext = {};
  }

  const runsRoot = resolveWoRunsRoot(projectPath);
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
        batchContext,
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
            statePath: formatWoStatePathForDiagnostics(statePath),
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
