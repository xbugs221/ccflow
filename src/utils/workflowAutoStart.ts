/**
 * PURPOSE: Centralize automatic workflow kickoff rules so workflow creation,
 * workflow selection, and chat auto-submit stay consistent.
 */
import type { Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../types/app';
import { api } from './api';

export type NewSessionOptions = {
  workflowId?: string;
  sessionSummary?: string;
  workflowAutoStart?: 'planning' | 'execution' | 'review' | 'repair' | 'archive';
  workflowTitle?: string;
  workflowChangeName?: string;
  workflowStageKey?: string;
  workflowRepairPass?: number;
  workflowReviewProfile?: string;
  autoPrompt?: string;
  provider?: SessionProvider;
};

type WorkflowDraftSessionResult = Pick<
  ProjectSession,
  'id' | 'routeIndex' | 'workflowId' | 'projectPath' | 'stageKey'
>;

/**
 * PURPOSE: Create a workflow-bound draft session before the real provider
 * session exists so workflow detail can route into it immediately.
 */
export async function createWorkflowAutoStartDraft(
  project: Pick<Project, 'name' | 'fullPath' | 'path'>,
  provider: SessionProvider,
  options: NewSessionOptions,
): Promise<WorkflowDraftSessionResult> {
  if (!options.workflowId) {
    throw new Error('Workflow ID is required to create a workflow auto-start draft');
  }

  const sessionSummary = String(options.sessionSummary || '').trim();
  if (!sessionSummary) {
    throw new Error('Session summary is required to create a workflow auto-start draft');
  }

  const draftResponse = await api.createManualSessionDraft(project.name, {
    provider,
    label: sessionSummary,
    projectPath: project.fullPath || project.path || '',
    workflowId: options.workflowId,
    stageKey: options.workflowStageKey,
  });
  if (!draftResponse.ok) {
    throw new Error(`Workflow draft creation failed with status ${draftResponse.status}`);
  }

  const draftPayload = await draftResponse.json();
  const draftSessionId = draftPayload?.session?.id;
  const draftRouteIndex = draftPayload?.session?.routeIndex;
  if (typeof draftSessionId !== 'string' || !draftSessionId) {
    throw new Error('Workflow draft creation did not return a valid session id');
  }

  if (options.autoPrompt && typeof window !== 'undefined') {
    window.sessionStorage.setItem(
      `workflow-autostart:${draftSessionId}`,
      JSON.stringify({
        prompt: options.autoPrompt,
        stageKey: options.workflowStageKey,
        repairPass: options.workflowRepairPass,
        reviewProfile: options.workflowReviewProfile,
      }),
    );
  }

  return {
    id: draftSessionId,
    routeIndex: typeof draftRouteIndex === 'number' ? draftRouteIndex : undefined,
    workflowId: options.workflowId,
    projectPath: project.fullPath || project.path || '',
    stageKey: options.workflowStageKey,
  };
}

/**
 * Decide whether a workflow still needs the system to automatically kick off planning.
 */
export function shouldAutoStartWorkflowPlanning(workflow: ProjectWorkflow | null | undefined): boolean {
  if (!workflow || String(workflow.stage || '').toLowerCase() !== 'planning') {
    return false;
  }

  const hasPlanningArtifact = (workflow.artifacts || []).some(
    (artifact) => artifact.stage === 'planning' && artifact.substageKey === 'planner_output',
  );
  const hasOpenSpecChange = Boolean((workflow as { openspecChangeDetected?: boolean } | null)?.openspecChangeDetected);
  const hasPlanningSession = (workflow.childSessions || []).some(
    (session) => session.stageKey === 'planning',
  );

  return !hasPlanningArtifact && !hasPlanningSession && !hasOpenSpecChange;
}
