/**
 * Backend workflow auto runner.
 * Drives automatic workflow stages from the server with explicit decisions,
 * per-action idempotency, and event-triggered wakeups.
 */
import { getProjects, renameCodexSession } from './projects.js';
import { isClaudeSDKSessionActive, queryClaudeSDK } from './claude-sdk.js';
import { isCodexSessionActive, queryCodex } from './openai-codex.js';
import {
  attachWorkflowMetadata,
  buildWorkflowLauncherConfig,
  getWorkflowReviewResult,
  registerWorkflowChildSession,
} from './workflows.js';

const DEFAULT_WAKE_DELAY_MS = 500;
const DEFAULT_RECONCILE_INTERVAL_MS = 60000;
const REVIEW_PASSES = [1, 2, 3];
const REVIEW_PASS_DECISIONS = new Set(['clean', 'pass', 'passed', 'approved', 'accept', 'accepted', 'ok', 'success']);
const REVIEW_REPAIR_DECISIONS = new Set(['needs_repair', 'blocked', 'reject', 'rejected', 'fail', 'failed', 'changes_requested']);

const runnerState = {
  wakeTimer: null,
  reconcileTimer: null,
  running: false,
  stopped: true,
  inFlightKeys: new Set(),
  completedKeys: new Set(),
};

/**
 * PURPOSE: Pick the Codex permission mode for backend-owned workflow sessions.
 * Workflow automation is expected to run unattended, so the default must match
 * the app's yolo mode while still allowing operators to override it by env.
 */
export function resolveWorkflowAutoRunPermissionMode(env = process.env) {
  return env.CCFLOW_WORKFLOW_AUTORUN_PERMISSION || 'bypassPermissions';
}

/**
 * PURPOSE: Detect route-only draft ids that make workflow child sessions
 * addressable before a provider has returned its real session id.
 */
export function isWorkflowTemporarySessionId(sessionId) {
  return String(sessionId || '').startsWith('new-session-') || /^c\d+$/.test(String(sessionId || ''));
}

/**
 * PURPOSE: Only resume provider sessions with concrete provider ids. Workflow
 * route ids such as c2 must launch a new provider session and then be replaced
 * by registerWorkflowChildSession while preserving the routeIndex.
 */
export function resolveProviderResumeSessionId(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId || isWorkflowTemporarySessionId(normalizedSessionId)) {
    return undefined;
  }
  return normalizedSessionId;
}

/**
 * PURPOSE: Read one workflow stage status from the normalized workflow model.
 */
function getWorkflowStageStatus(workflow, stageKey) {
  return (workflow.stageStatuses || []).find((stage) => stage.key === stageKey)?.status || 'pending';
}

/**
 * PURPOSE: Treat completed/skipped/ready stages as available prerequisites for
 * downstream automation.
 */
function isWorkflowPassedStatus(status) {
  return status === 'completed' || status === 'skipped' || status === 'ready';
}

/**
 * PURPOSE: Resolve the newest child session matching one stage key.
 */
function getLatestWorkflowStageSession(workflow, stageKey) {
  const sessions = (workflow.childSessions || []).filter((session) => (
    session.stageKey === stageKey
  ));
  return sessions.reduce((selected, session) => {
    if (!selected) {
      return session;
    }
    const selectedRouteIndex = Number(selected.routeIndex || 0);
    const sessionRouteIndex = Number(session.routeIndex || 0);
    return sessionRouteIndex >= selectedRouteIndex ? session : selected;
  }, null);
}

/**
 * PURPOSE: Resolve the newest child session for one review pass.
 */
function getLatestWorkflowReviewSession(workflow, passIndex) {
  const stageKey = `review_${passIndex}`;
  const sessions = (workflow.childSessions || []).filter((session) => (
    session.stageKey === stageKey
  ));
  return sessions.reduce((selected, session) => {
    if (!selected) {
      return session;
    }
    const selectedRouteIndex = Number(selected.routeIndex || 0);
    const sessionRouteIndex = Number(session.routeIndex || 0);
    return sessionRouteIndex >= selectedRouteIndex ? session : selected;
  }, null);
}

/**
 * PURPOSE: Resolve the newest child session in one review/repair cycle.
 */
function getLatestWorkflowCycleSession(workflow, passIndex) {
  const sessions = (workflow.childSessions || []).filter((session) => (
    session.stageKey === `review_${passIndex}`
    || session.stageKey === `repair_${passIndex}`
  ));
  return sessions.reduce((selected, session) => {
    if (!selected) {
      return session;
    }
    const selectedRouteIndex = Number(selected.routeIndex || 0);
    const sessionRouteIndex = Number(session.routeIndex || 0);
    return sessionRouteIndex >= selectedRouteIndex ? session : selected;
  }, null);
}

/**
 * PURPOSE: Allocate the next child-session route index for new provider
 * sessions registered by backend automation.
 */
function getNextWorkflowChildRouteIndex(workflow) {
  return (workflow.childSessions || []).reduce((maxValue, session) => {
    const parsed = Number(session?.routeIndex);
    return Number.isInteger(parsed) && parsed > maxValue ? parsed : maxValue;
  }, 0) + 1;
}

/**
 * PURPOSE: Return whether all OpenSpec execution tasks are done.
 */
function hasCompletedExecutionTasks(workflow) {
  const taskProgress = workflow.openspecTaskProgress || null;
  return Boolean(
    taskProgress
    && typeof taskProgress.totalTasks === 'number'
    && taskProgress.totalTasks > 0
    && typeof taskProgress.completedTasks === 'number'
    && taskProgress.completedTasks >= taskProgress.totalTasks,
  );
}

/**
 * PURPOSE: Keep downstream review from racing a provider execution turn that has
 * completed OpenSpec tasks but has not closed its internal session yet.
 */
function hasActiveProviderWorkflowSession(session) {
  if (!session?.id) {
    return false;
  }
  if (session.provider === 'claude') {
    return isClaudeSDKSessionActive(session.id);
  }
  return session.provider === 'codex' && isCodexSessionActive(session.id);
}

/**
 * PURPOSE: Build a stable checkpoint for an action. The same action only runs
 * once per server lifetime unless workflow evidence changes to a different
 * stage/session checkpoint.
 */
function buildActionKey(project, workflow, action) {
  return [
    project.fullPath || project.path || project.name,
    workflow.id,
    action.stage,
    action.checkpoint || 'initial',
  ].join(':');
}

/**
 * PURPOSE: Extract the review pass encoded in a review_N/repair_N stage key.
 */
function getReviewPassFromStage(stage) {
  const match = String(stage || '').match(/^(?:review|repair)_(\d+)$/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * PURPOSE: Decide if a persisted review result requires a repair stage.
 */
function isRepairReviewResult(reviewResult) {
  const decision = String(reviewResult?.decision || '').trim().toLowerCase();
  const hasFindings = Array.isArray(reviewResult?.findings) && reviewResult.findings.length > 0;
  return REVIEW_REPAIR_DECISIONS.has(decision) || hasFindings || !REVIEW_PASS_DECISIONS.has(decision);
}

/**
 * PURPOSE: Decide the next backend-owned action. Planning approval and final
 * acceptance are human gates; execution/review/repair/archive are automated
 * only when their prerequisite evidence is present.
 */
export async function resolveWorkflowAutoAction(project, workflow) {
  const planningStatus = getWorkflowStageStatus(workflow, 'planning');
  const executionStatus = getWorkflowStageStatus(workflow, 'execution');
  const executionSession = getLatestWorkflowStageSession(workflow, 'execution');
  const executionDone = isWorkflowPassedStatus(executionStatus)
    && hasCompletedExecutionTasks(workflow)
    && !hasActiveProviderWorkflowSession(executionSession);
  const finalAcceptanceDone = getWorkflowStageStatus(workflow, 'verification') === 'completed';

  if (finalAcceptanceDone) {
    return null;
  }

  const planningDone =
    workflow.openspecChangeDetected === true ||
    workflow.adoptsExistingOpenSpec === true ||
    isWorkflowPassedStatus(planningStatus);
  if (!planningDone) {
    if (planningStatus !== 'active' && planningStatus !== 'ready' && workflow.stage !== 'planning') {
      return null;
    }
    const existingSession = getLatestWorkflowStageSession(workflow, 'planning');
    if (existingSession) {
      return null;
    }
    return {
      stage: 'planning',
      checkpoint: `planning:${workflow.id || workflow.routeIndex || workflow.updatedAt || planningStatus}`,
    };
  }

  if (!executionDone) {
    if (executionStatus !== 'active' && executionStatus !== 'ready') {
      return null;
    }
    return {
      stage: 'execution',
      sessionId: executionSession?.id,
      routeIndex: executionSession?.routeIndex,
      checkpoint: executionSession?.id || `execution:${executionStatus}`,
    };
  }

  const archiveStatus = getWorkflowStageStatus(workflow, 'archive');
  if (isWorkflowPassedStatus(archiveStatus)) {
    return null;
  }

  for (const passIndex of REVIEW_PASSES) {
    const reviewStatus = getWorkflowStageStatus(workflow, `review_${passIndex}`);
    const repairStatus = getWorkflowStageStatus(workflow, `repair_${passIndex}`);
    const latestCycleSession = getLatestWorkflowCycleSession(workflow, passIndex);
    const latestCycleStage = latestCycleSession?.stageKey || '';

    if (repairStatus === 'completed') {
      if (passIndex < REVIEW_PASSES.length) {
        const nextReviewStatus = getWorkflowStageStatus(workflow, `review_${passIndex + 1}`);
        if (isWorkflowPassedStatus(nextReviewStatus)) {
          continue;
        }
        const nextReviewSession = getLatestWorkflowReviewSession(workflow, passIndex + 1);
        return {
          stage: `review_${passIndex + 1}`,
          sessionId: nextReviewSession?.id,
          routeIndex: nextReviewSession?.routeIndex,
          checkpoint: nextReviewSession?.id || `after-repair:${latestCycleSession?.id || latestCycleSession?.routeIndex || passIndex}`,
        };
      }
      const archiveSession = getLatestWorkflowStageSession(workflow, 'archive');
      if (archiveSession) {
        return null;
      }
      return {
        stage: 'archive',
        checkpoint: `after-repair:${latestCycleSession?.id || latestCycleSession?.routeIndex || passIndex}`,
      };
    }

    if (repairStatus === 'pending' && latestCycleStage === `repair_${passIndex}`) {
      return {
        stage: `repair_${passIndex}`,
        sessionId: latestCycleSession?.id,
        routeIndex: latestCycleSession?.routeIndex,
        checkpoint: latestCycleSession?.id || `pending-repair:${passIndex}`,
      };
    }

    if (isWorkflowPassedStatus(reviewStatus)) {
      const reviewResult = await getWorkflowReviewResult(project, workflow.id, passIndex);
      if (!reviewResult || typeof reviewResult !== 'object') {
        return null;
      }
      if (isRepairReviewResult(reviewResult)) {
        const repairSession = getLatestWorkflowStageSession(workflow, `repair_${passIndex}`);
        return {
          stage: `repair_${passIndex}`,
          sessionId: repairSession?.id,
          routeIndex: repairSession?.routeIndex,
          checkpoint: repairSession?.id || `after-review:${latestCycleSession?.id || latestCycleSession?.routeIndex || passIndex}`,
        };
      }

      if (passIndex < REVIEW_PASSES.length) {
        const nextReviewSession = getLatestWorkflowReviewSession(workflow, passIndex + 1);
        if (!nextReviewSession) {
          return {
            stage: `review_${passIndex + 1}`,
            checkpoint: `after-review:${latestCycleSession?.id || latestCycleSession?.routeIndex || passIndex}`,
          };
        }
        continue;
      }

      if (archiveStatus === 'pending') {
        const archiveSession = getLatestWorkflowStageSession(workflow, 'archive');
        if (archiveSession) {
          return null;
        }
        return {
          stage: 'archive',
          checkpoint: `after-review:${latestCycleSession?.id || latestCycleSession?.routeIndex || passIndex}`,
        };
      }
      continue;
    }

    const reviewSession = getLatestWorkflowReviewSession(workflow, passIndex);
    if (reviewStatus === 'pending' || (reviewStatus === 'active' && !reviewSession)) {
      return {
        stage: `review_${passIndex}`,
        sessionId: reviewSession?.id,
        routeIndex: reviewSession?.routeIndex,
        checkpoint: reviewSession?.id || `pending-review:${passIndex}`,
      };
    }

    break;
  }

  return null;
}

export const resolveWorkflowAutoLauncher = resolveWorkflowAutoAction;

/**
 * PURPOSE: Capture the real Codex thread id emitted by queryCodex without a
 * browser WebSocket.
 */
function createWorkflowAutoRunWriter(onSessionCreated, onTurnFinished) {
  let sessionId = null;
  let sessionCreatedNotified = false;
  let turnFinishedNotified = false;
  const notifySessionCreated = (nextSessionId) => {
    if (!nextSessionId || sessionCreatedNotified) {
      return;
    }
    sessionCreatedNotified = true;
    Promise.resolve(onSessionCreated?.(nextSessionId)).catch(() => {
      sessionCreatedNotified = false;
    });
  };
  return {
    send(payload) {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      const nextSessionId = data?.actualSessionId || data?.sessionId;
      if (nextSessionId) {
        sessionId = nextSessionId;
        notifySessionCreated(nextSessionId);
      }
      if (
        data?.type === 'codex-response'
        && ['turn_complete', 'turn_failed'].includes(data?.data?.type)
        && !turnFinishedNotified
      ) {
        turnFinishedNotified = true;
        Promise.resolve(onTurnFinished?.(data.data.type)).catch(() => {
          turnFinishedNotified = false;
        });
      }
    },
    setSessionId(nextSessionId) {
      if (nextSessionId) {
        sessionId = nextSessionId;
        notifySessionCreated(nextSessionId);
      }
    },
    getSessionId() {
      return sessionId;
    },
  };
}

/**
 * PURPOSE: Execute one selected workflow action and persist the provider
 * session as a workflow child session.
 */
async function launchWorkflowAction(project, workflow, action, logger) {
  const projectPath = project?.fullPath || project?.path || '';
  const launcher = await buildWorkflowLauncherConfig(project, workflow.id, action.stage);
  if (!launcher?.autoPrompt) {
    return false;
  }

  const summary = launcher.sessionSummary || `${workflow.title} 自动阶段`;
  const provider = launcher.provider === 'claude' ? 'claude' : 'codex';
  let registeredSessionId = null;
  let registrationPromise = null;
  const registerLaunchedSession = (actualSessionId) => {
    if (!actualSessionId || registeredSessionId === actualSessionId) {
      return registrationPromise;
    }
    registeredSessionId = actualSessionId;
    registrationPromise = registerWorkflowChildSession(project, workflow.id, {
      sessionId: actualSessionId,
      title: summary,
      summary,
      provider,
      stageKey: launcher.workflowStageKey || action.stage,
      repairPassIndex: launcher.workflowRepairPass,
      routeIndex: Number.isInteger(Number(action.routeIndex))
        ? Number(action.routeIndex)
        : getNextWorkflowChildRouteIndex(workflow),
    });
    return registrationPromise;
  };

  const writer = createWorkflowAutoRunWriter(registerLaunchedSession, () => {
    scheduleWorkflowAutoRun(`${provider}-turn-event`, { logger });
  });
  const queryProvider = provider === 'claude' ? queryClaudeSDK : queryCodex;
  const sessionId = await queryProvider(
    launcher.autoPrompt,
    {
      projectPath,
      cwd: projectPath,
      sessionId: resolveProviderResumeSessionId(action.sessionId),
      permissionMode: resolveWorkflowAutoRunPermissionMode(),
    },
    writer,
  );
  const actualSessionId = sessionId || writer.getSessionId();
  if (!actualSessionId) {
    logger.warn(`[WorkflowAutoRunner] ${provider} session was not created for ${project.name}/${workflow.id}`);
    return false;
  }

  await registerLaunchedSession(actualSessionId);
  if (provider === 'codex') {
    await renameCodexSession(actualSessionId, summary, projectPath).catch((error) => {
      logger.warn(`[WorkflowAutoRunner] Failed to rename ${actualSessionId}:`, error);
    });
  }

  logger.info(`[WorkflowAutoRunner] Completed ${project.name}/${workflow.id}/${launcher.workflowStageKey || action.stage}`);
  return true;
}

/**
 * PURPOSE: Run one reconciliation pass. Existing action keys make repeated
 * scans harmless.
 */
export async function runWorkflowAutoOnce(options = {}) {
  const logger = options.logger || console;
  if (runnerState.running) {
    return { skipped: true, reason: 'already-running' };
  }

  runnerState.running = true;
  const stats = { launched: 0, inspected: 0, skipped: 0 };
  try {
    const projects = await attachWorkflowMetadata(await getProjects());
    for (const project of projects) {
      for (const workflow of project.workflows || []) {
        stats.inspected += 1;
        const action = await resolveWorkflowAutoAction(project, workflow);
        if (!action) {
          continue;
        }

        const actionKey = buildActionKey(project, workflow, action);
        if (runnerState.inFlightKeys.has(actionKey) || runnerState.completedKeys.has(actionKey)) {
          stats.skipped += 1;
          continue;
        }

        runnerState.inFlightKeys.add(actionKey);
        try {
          const launched = await launchWorkflowAction(project, workflow, action, logger);
          if (launched) {
            runnerState.completedKeys.add(actionKey);
            stats.launched += 1;
            scheduleWorkflowAutoRun('codex-turn-complete', { logger });
          }
        } catch (error) {
          logger.error(`[WorkflowAutoRunner] Failed ${project.name}/${workflow.id}:`, error);
        } finally {
          runnerState.inFlightKeys.delete(actionKey);
        }
      }
    }
    return stats;
  } finally {
    runnerState.running = false;
  }
}

/**
 * PURPOSE: Wake the runner soon without stacking timers.
 */
export function scheduleWorkflowAutoRun(reason = 'manual', options = {}) {
  if (process.env.CCFLOW_WORKFLOW_AUTORUN === '0' || runnerState.stopped) {
    return false;
  }
  if (runnerState.wakeTimer) {
    return true;
  }

  const logger = options.logger || console;
  const configuredDelay = Number.parseInt(process.env.CCFLOW_WORKFLOW_AUTORUN_WAKE_DELAY_MS || '', 10);
  const delayMs = Number.isFinite(configuredDelay) && configuredDelay >= 0
    ? configuredDelay
    : DEFAULT_WAKE_DELAY_MS;

  runnerState.wakeTimer = setTimeout(() => {
    runnerState.wakeTimer = null;
    void runWorkflowAutoOnce({ logger }).catch((error) => {
      logger.error(`[WorkflowAutoRunner] Wake failed (${reason}):`, error);
    });
  }, delayMs);
  runnerState.wakeTimer.unref?.();
  return true;
}

/**
 * PURPOSE: Start event-triggered automation plus a slow reconciliation timer
 * for missed filesystem events.
 */
export function startWorkflowAutoRunner(options = {}) {
  if (process.env.CCFLOW_WORKFLOW_AUTORUN === '0') {
    return null;
  }

  const logger = options.logger || console;
  runnerState.stopped = false;
  scheduleWorkflowAutoRun('startup', { logger });

  if (!runnerState.reconcileTimer) {
    const configuredInterval = Number.parseInt(process.env.CCFLOW_WORKFLOW_AUTORUN_RECONCILE_MS || '', 10);
    const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
      ? configuredInterval
      : DEFAULT_RECONCILE_INTERVAL_MS;
    runnerState.reconcileTimer = setInterval(() => {
      scheduleWorkflowAutoRun('reconcile', { logger });
    }, intervalMs);
    runnerState.reconcileTimer.unref?.();
    logger.info(`[WorkflowAutoRunner] Enabled (wake=${DEFAULT_WAKE_DELAY_MS}ms, reconcile=${intervalMs}ms)`);
  }

  return runnerState.reconcileTimer;
}

/**
 * PURPOSE: Stop all workflow automation timers during graceful shutdown.
 */
export function stopWorkflowAutoRunner() {
  runnerState.stopped = true;
  if (runnerState.wakeTimer) {
    clearTimeout(runnerState.wakeTimer);
    runnerState.wakeTimer = null;
  }
  if (runnerState.reconcileTimer) {
    clearInterval(runnerState.reconcileTimer);
    runnerState.reconcileTimer = null;
  }
}
