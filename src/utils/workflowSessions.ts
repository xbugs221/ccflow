/**
 * PURPOSE: Share workflow-owned session detection across project session lists
 * and project route resolution so runner child sessions stay workflow-scoped.
 */
import type { Project, ProjectSession, SessionProvider } from '../types/app';

type SessionLike = Pick<ProjectSession, 'id' | 'workflowId' | 'stageKey'> & {
  provider?: SessionProvider | string;
  __provider?: SessionProvider | string;
};

function getSessionProvider(session: SessionLike): string {
  /**
   * PURPOSE: Normalize provider identity before comparing project and workflow
   * session ids, avoiding cross-provider false matches.
   */
  return String(session.__provider || session.provider || 'codex');
}

function getChildSessionProvider(provider: unknown): string {
  /**
   * PURPOSE: Treat missing or retired provider values as Codex ownership.
   */
  if (provider === 'opencode') return 'opencode';
  if (provider === 'pi') return 'pi';
  return 'codex';
}

export function isWorkflowOwnedSession(project: Pick<Project, 'workflows'>, session: SessionLike): boolean {
  /**
   * PURPOSE: Detect whether a session belongs to any workflow read model rather
   * than the project's manual session list.
   *
   * Checks:
   * 1. Session has explicit workflowId or stageKey metadata
   * 2. Session id appears in any workflow's childSessions
   * 3. Session id appears in any workflow's runnerProcesses.sessionId
 * 4. Session id appears in any workflow's runnerDiagnostics workflow session ids
   */
  if (session.workflowId || session.stageKey) {
    return true;
  }

  const provider = getSessionProvider(session);
  const workflows = project.workflows || [];
  return workflows.some((workflow) => (
    (workflow.childSessions || []).some((childSession) => (
      childSession.id === session.id
      && getChildSessionProvider(childSession.provider) === provider
    ))
    || (workflow.runnerProcesses || []).some((process) => (
      process.sessionId === session.id
      && provider === 'codex'
    ))
    // Check if session id matches any session in the wo state sessions role map.
    || isSessionInWorkflowDiagnosticsSessions(workflow, session.id)
  ));
}

/**
 * Check if a session id appears in the workflow's runner diagnostics sessions
 * (the wo state.json sessions role map).
 */
function isSessionInWorkflowDiagnosticsSessions(
  workflow: { runnerDiagnostics?: Record<string, unknown>; diagnostics?: Record<string, unknown> },
  sessionId: string,
): boolean {
  const diagnostics = (workflow.runnerDiagnostics || workflow.diagnostics || {}) as Record<string, unknown>;
  if (!diagnostics || typeof diagnostics !== 'object') {
    return false;
  }

  const ownedIds = diagnostics.workflowOwnedSessionIds;
  if (Array.isArray(ownedIds) && ownedIds.some((ownedId) => String(ownedId) === sessionId)) {
    return true;
  }

  const ownedSessions = diagnostics.workflowOwnedSessions;
  if (Array.isArray(ownedSessions)) {
    return ownedSessions.some((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }
      return String((entry as { sessionId?: unknown }).sessionId || '') === sessionId;
    });
  }

  return false;
}
