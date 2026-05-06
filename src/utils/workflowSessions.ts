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
  return String(session.__provider || session.provider || 'claude');
}

export function isWorkflowOwnedSession(project: Pick<Project, 'workflows'>, session: SessionLike): boolean {
  /**
   * PURPOSE: Detect whether a session belongs to any workflow read model rather
   * than the project's manual session list.
   */
  if (session.workflowId || session.stageKey) {
    return true;
  }

  const provider = getSessionProvider(session);
  return (project.workflows || []).some((workflow) => (
    (workflow.childSessions || []).some((childSession) => (
      childSession.id === session.id
      && String(childSession.provider || 'claude') === provider
    ))
    || (workflow.runnerProcesses || []).some((process) => (
      process.sessionId === session.id
      && provider === 'codex'
    ))
  ));
}
