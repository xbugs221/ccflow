/**
 * PURPOSE: Render a workflow control-plane detail tree with stage, substage,
 * artifact, and child-session inspection data.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FileText, Play, Trash2 } from 'lucide-react';
import ClaudeLogo from '../../../llm-logo-provider/ClaudeLogo';
import CodexLogo from '../../../llm-logo-provider/CodexLogo';
import type {
  Project,
  ProjectWorkflow,
  SessionProvider,
  WorkflowArtifact,
  WorkflowChildSession,
  WorkflowStageInspection,
  WorkflowSubstageInspection,
} from '../../../../types/app';
import { api } from '../../../../utils/api';

type WorkflowDetailViewProps = {
  project: Project;
  workflow: ProjectWorkflow;
  treeOnly?: boolean;
  onNavigateToSession: (
    sessionId: string,
    options?: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
      workflowId?: string;
      workflowStageKey?: string;
      routeSearch?: Record<string, string>;
    },
  ) => void;
  onOpenArtifactFile: (filePath: string) => void;
  onOpenArtifactDirectory: (directoryPath: string) => void;
  onContinueWorkflow?: (workflow: ProjectWorkflow) => Promise<void> | void;
  onDeleteWorkflow?: (workflow: ProjectWorkflow) => Promise<void> | void;
  onUpdateWorkflowGateDecision?: (workflow: ProjectWorkflow, gateDecision: 'pass' | 'needs_repair') => Promise<void> | void;
};

type WorkflowGraphEdge = {
  childId: string;
  kind: 'branch' | 'chain';
  id: string;
  sourceStatus: string;
  targetId: string;
};

type WorkflowGraphPath = {
  d: string;
  id: string;
  toneClass: string;
};

type WorkflowVisualProgress = {
  stageStatuses: Record<string, string>;
  substageStatuses: Record<string, string>;
};

/**
 * PURPOSE: Preserve workflow session routing context so the chat view resolves
 * the correct provider/session history after navigation or reload.
 */
function buildWorkflowSessionRouteOptions(
  project: Project,
  workflow: ProjectWorkflow,
  session: WorkflowChildSession,
): {
  provider: SessionProvider;
  projectName: string;
  projectPath: string;
  workflowId: string;
  workflowStageKey?: string;
} {
  const normalizedProvider: SessionProvider = (project.codexSessions || []).some((candidate) => candidate.id === session.id)
    ? 'codex'
    : (session.provider === 'codex' ? 'codex' : 'claude');
  return {
    provider: normalizedProvider,
    projectName: project.name,
    projectPath: project.fullPath || project.path || '',
    workflowId: workflow.id,
    workflowStageKey: session.stageKey,
  };
}

function isCompletedStatus(status: string): boolean {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'completed' || normalized === 'ready' || normalized === 'skipped';
}

function isActiveStatus(status: string): boolean {
  /**
   * Collapse all in-flight or attention-needed backend states into the single
   * yellow lamp state requested for the workflow detail tree.
   */
  const normalized = String(status || '').toLowerCase();
  return normalized === 'active' || normalized === 'running' || normalized === 'blocked' || normalized === 'failed';
}

function normalizeLampStatus(status: string): string {
  /**
   * Reduce backend workflow state to the three visible lamp states: pending,
   * active, and completed.
   */
  if (isCompletedStatus(status)) {
    return 'completed';
  }
  if (isActiveStatus(status)) {
    return 'active';
  }
  return 'pending';
}

function getTodoTextTone(status: string): string {
  const normalized = String(status || '').toLowerCase();
  if (isCompletedStatus(normalized)) {
    return 'text-foreground';
  }
  if (normalized === 'active' || normalized === 'running') {
    return 'text-foreground';
  }
  if (normalized === 'blocked' || normalized === 'failed') {
    return 'text-foreground';
  }
  return 'text-muted-foreground';
}

function getLinkTone(status: string): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'blocked' || normalized === 'failed') {
    return 'text-indigo-700 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200';
  }
  if (normalized === 'active' || normalized === 'running') {
    return 'text-indigo-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200';
  }
  return 'text-indigo-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200';
}

function getWorkflowStageProvider(
  workflow: ProjectWorkflow,
  stageKey: string,
  stageSession?: WorkflowChildSession | null,
): SessionProvider {
  /**
   * PURPOSE: Read the stage provider from normalized status data or persisted map.
   */
  if (stageSession?.provider === 'claude') {
    return 'claude';
  }
  if (stageSession?.provider === 'codex') {
    return 'codex';
  }
  const stageProvider = workflow.stageStatuses.find((stage) => stage.key === stageKey)?.provider;
  return stageProvider === 'claude' ? 'claude' : 'codex';
}

function isStageProviderLocked(stage: WorkflowStageInspection, stageSession: WorkflowChildSession | null): boolean {
  /**
   * PURPOSE: Prevent provider changes after a stage has started or produced a session.
   */
  if (stageSession) {
    return true;
  }
  return ['active', 'running', 'blocked', 'failed', 'completed'].includes(normalizeLampStatus(stage.status));
}

function renderTodoMarker(status: string) {
  const normalized = normalizeLampStatus(status);
  const toneClass = normalized === 'completed'
    ? 'border-emerald-500 bg-emerald-500/90'
    : normalized === 'active'
      ? 'border-amber-500 bg-amber-500/85'
      : 'border-border bg-muted-foreground/25';
  return (
    <span
      aria-hidden="true"
      className={[
        'inline-flex h-3.5 w-3.5 rounded-full border',
        toneClass,
      ].join(' ')}
    />
  );
}

function getPipelineSegmentTone(status: string): string {
  /**
   * Keep pipeline segments visually aligned with node state without relying on
   * separate vertical guide rails.
   */
  const normalized = normalizeLampStatus(status);
  if (normalized === 'completed') {
    return 'bg-emerald-500/75';
  }
  if (normalized === 'active') {
    return 'bg-amber-500/75';
  }
  return 'bg-slate-300 dark:bg-slate-700';
}

function getPipelineBorderTone(status: string): string {
  /**
   * Keep elbow borders aligned with the same tone used by the branch trunk.
   */
  const normalized = normalizeLampStatus(status);
  if (normalized === 'completed') {
    return 'border-emerald-500/75';
  }
  if (normalized === 'active') {
    return 'border-amber-500/75';
  }
  return 'border-slate-300 dark:border-slate-700';
}

function getPipelineStrokeTone(status: string): string {
  /**
   * SVG paths need text-current color classes instead of background helpers.
   */
  const normalized = normalizeLampStatus(status);
  if (normalized === 'completed') {
    return 'text-emerald-500/80';
  }
  if (normalized === 'active') {
    return 'text-amber-500/80';
  }
  return 'text-slate-300 dark:text-slate-700';
}

function buildWorkflowEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  kind: 'branch' | 'chain',
): string {
  /**
   * Branch edges only bend for the first child item; same-level chain edges are
   * kept as straight vertical segments so sibling nodes share one trunk.
   */
  if (kind === 'chain' || Math.abs(targetX - sourceX) < 1) {
    return [
      `M ${sourceX} ${sourceY}`,
      `V ${targetY}`,
    ].join(' ');
  }
  const deltaX = Math.max(targetX - sourceX, 0);
  const radius = Math.min(10, Math.max(deltaX, 6));
  const elbowY = Math.max(sourceY + radius, targetY);
  const horizontalStartX = sourceX + radius;
  return [
    `M ${sourceX} ${sourceY}`,
    `V ${elbowY - radius}`,
    `Q ${sourceX} ${elbowY} ${horizontalStartX} ${elbowY}`,
    `H ${targetX}`,
  ].join(' ');
}

function resolveArtifactPath(project: Project, artifact: WorkflowArtifact): string | null {
  /**
   * Support both server-normalized absolute paths and older relative paths.
   */
  const artifactPath = typeof artifact.path === 'string' ? artifact.path.trim() : '';
  if (!artifactPath) {
    return null;
  }

  if (artifactPath.startsWith('/')) {
    return artifactPath;
  }

  const projectRoot = project.fullPath || project.path || '';
  if (!projectRoot) {
    return artifactPath;
  }

  return `${projectRoot.replace(/[/\\]+$/, '')}/${artifactPath.replace(/^[/\\]+/, '')}`;
}

function resolveArtifactType(artifact: WorkflowArtifact): 'file' | 'directory' {
  /**
   * Treat directories explicitly and default everything else to file opening.
   */
  if (artifact.type === 'directory') {
    return 'directory';
  }

  return 'file';
}

function buildFallbackStageInspections(workflow: ProjectWorkflow): WorkflowStageInspection[] {
  /**
   * Preserve the previous coarse detail view when the backend has not yet
   * attached the richer stage tree.
   */
  return workflow.stageStatuses.map((stage) => ({
    stageKey: stage.key,
    title: stage.label,
    status: stage.status,
    provider: stage.provider,
    note: undefined,
    substages: [],
  }));
}

function isWorkflowReviewStageKey(stageKey: string | null | undefined): boolean {
  /**
   * Recognize both the current independent review stages and legacy workflow
   * records that stored all reviewer passes under one verification stage.
   */
  return /^review_\d+$/.test(String(stageKey || '')) || stageKey === 'verification';
}

function getExactSubstageSessions(substage: WorkflowSubstageInspection): WorkflowChildSession[] {
  /**
   * Workflow sessions are stage-owned. Each current stage has one internal
   * conversation; review pass identity is derived from stageKey.
   */
  return (substage.agentSessions || []).filter((session) => session.stageKey === substage.stageKey);
}

function getRenderableSubstageSessions(substage: WorkflowSubstageInspection, hiddenSessionId?: string | null): WorkflowChildSession[] {
  /**
   * Keep terminal archive evidence readable without surfacing repeated delivery
   * session registrations as multiple competing archive links.
   */
  const sessions = getExactSubstageSessions(substage);
  if (substage.stageKey !== 'archive' && substage.substageKey !== 'delivery_package') {
    return sessions.filter((session) => session.id !== hiddenSessionId);
  }

  const latestSession = [...sessions].sort((left, right) => {
    const leftRoute = Number(left.routeIndex) || 0;
    const rightRoute = Number(right.routeIndex) || 0;
    return rightRoute - leftRoute;
  })[0];
  if (latestSession?.id === hiddenSessionId) {
    return [];
  }
  return latestSession ? [latestSession] : [];
}

function buildSubstageStatusKey(stageKey: string, substageKey: string): string {
  /**
   * Keep substage visual status keyed by parent stage because review and repair
   * phases can reuse similar substage names across old workflow records.
   */
  return `${stageKey}:${substageKey}`;
}

function hasSubstageEvidence(substage: WorkflowSubstageInspection): boolean {
  /**
   * Treat a persisted child session or inspectable output as proof that the
   * workflow reached this substage, even if older stored status rows still say
   * pending.
   */
  return isCompletedStatus(substage.status)
    || getExactSubstageSessions(substage).length > 0
    || (substage.files || []).some((file) => file.exists !== false && file.status !== 'missing');
}

function buildVisualProgress(stageInspections: WorkflowStageInspection[]): WorkflowVisualProgress {
  /**
   * Derive three-state lamp progress from evidence order. If a later stage has
   * evidence, earlier stages are visually passed; only the next stage after that
   * may show yellow from raw active state, and all later stages stay dark.
   */
  let lastEvidenceStageIndex = -1;
  let lastEvidenceSubstageIndex = -1;

  stageInspections.forEach((stage, stageIndex) => {
    let substageIndex = -1;
    stage.substages.forEach((substage, index) => {
      if (hasSubstageEvidence(substage)) {
        substageIndex = index;
      }
    });
    if (substageIndex >= 0 || isCompletedStatus(stage.status)) {
      lastEvidenceStageIndex = stageIndex;
      lastEvidenceSubstageIndex = Math.max(substageIndex, 0);
    }
  });

  return {
    stageStatuses: Object.fromEntries(stageInspections.map((stage, stageIndex) => {
      let status = 'pending';
      if (stageIndex <= lastEvidenceStageIndex) {
        status = 'completed';
      } else if (stageIndex === lastEvidenceStageIndex + 1) {
        status = normalizeLampStatus(stage.status);
      }
      return [stage.stageKey, status];
    })),
    substageStatuses: Object.fromEntries(stageInspections.flatMap((stage, stageIndex) => (
      stage.substages.map((substage, substageIndex) => {
        const completedByProgress = stageIndex < lastEvidenceStageIndex
          || (stageIndex === lastEvidenceStageIndex && substageIndex <= lastEvidenceSubstageIndex);
        let status = 'pending';
        if (completedByProgress) {
          status = 'completed';
        } else if (
          stageIndex === lastEvidenceStageIndex
          || stageIndex === lastEvidenceStageIndex + 1
        ) {
          status = normalizeLampStatus(substage.status);
        }
        return [buildSubstageStatusKey(stage.stageKey, substage.substageKey), status];
      })
    ))),
  };
}

function getPrimaryStageSession(stage: WorkflowStageInspection): WorkflowChildSession | null {
  /**
   * Treat the flat stage row as the only workflow-session navigation entry.
   * Substages remain evidence/artifact rows and must not create nested session links.
   */
  const collapsedSubstage = getSingleStageSubstage(stage);
  if (collapsedSubstage && (stage.stageKey === 'archive' || collapsedSubstage.substageKey === 'delivery_package')) {
    /**
     * Archive can contain repeated delivery registrations. The stage title should
     * still link to the latest package session instead of falling back to text.
     */
    return getRenderableSubstageSessions(collapsedSubstage)[0] || null;
  }

  const candidateSessions = stage.substages
    .flatMap((substage) => getExactSubstageSessions(substage).length > 0
      ? getExactSubstageSessions(substage)
      : (substage.agentSessions || []));
  const uniqueSessions = Array.from(new Map(candidateSessions.map((session) => [session.id, session])).values());
  return uniqueSessions.length === 1 ? uniqueSessions[0] || null : null;
}

function getSingleStageSubstage(stage: WorkflowStageInspection): WorkflowSubstageInspection | null {
  /**
   * Collapse one-child stages into the stage row itself when the child only
   * mirrors the stage concept.
   */
  if (![
    'planning',
    'execution',
    'review_1',
    'repair_1',
    'review_2',
    'repair_2',
    'review_3',
    'repair_3',
    'archive',
  ].includes(stage.stageKey) || stage.substages.length !== 1) {
    return null;
  }
  return stage.substages[0];
}

function isFollowCandidate(status: string): boolean {
  /**
   * Only running or problematic nodes should take follow priority over the
   * rest of the tree when auto-follow is enabled.
   */
  const normalized = String(status || '').toLowerCase();
  return normalized === 'active' || normalized === 'running' || normalized === 'blocked' || normalized === 'failed';
}

function resolveContinueState(workflow: ProjectWorkflow, stageInspections: WorkflowStageInspection[]): {
  canContinue: boolean;
  disabled: boolean;
  label: string;
} {
  /**
   * The workflow is backend-driven after execution starts. Keep the manual
   * continue affordance only for legacy/no-proposal planning handoff.
   */
  const getStageStatus = (stageKey: string): string => {
    const persistedStatus = workflow.stageStatuses.find((stage) => stage.key === stageKey)?.status;
    const inspectionStatus = stageInspections.find((stage) => stage.stageKey === stageKey)?.status;
    return String(persistedStatus || inspectionStatus || '').toLowerCase();
  };
  const executionStatus = getStageStatus('execution');
  const executionStarted = Boolean(
    workflow.childSessions.some((session) => session.stageKey === 'execution')
    || ['completed', 'skipped'].includes(executionStatus),
  );
  const hasOpenSpecChange = Boolean(
    workflow.openspecChangeName
    || workflow.openspecChangeDetected
    || workflow.adoptsExistingOpenSpec,
  );
  const hasPlanningSession = workflow.childSessions.some((session) => session.stageKey === 'planning');

  if ((isCompletedStatus(getStageStatus('planning')) || hasPlanningSession || hasOpenSpecChange) && !executionStarted) {
    return {
      canContinue: true,
      disabled: false,
      label: '继续推进',
    };
  }

  return { canContinue: false, disabled: true, label: '继续推进' };
}

function renderSubstageFiles(
  project: Project,
  stageKey: string,
  substage: WorkflowSubstageInspection,
  renderNodeAnchor: (nodeId: string, status: string) => JSX.Element,
  onOpenArtifactFile: (filePath: string) => void,
  onOpenArtifactDirectory: (directoryPath: string) => void,
) {
  /**
   * Render file and directory outputs inline so users can inspect deliverables
   * without leaving the workflow detail view.
   */
  if (!substage.files || substage.files.length === 0) {
    return null;
  }
  const substageFiles = substage.files;

  return (
    <div className="space-y-1 pl-5">
      {substageFiles.map((artifact) => {
        const artifactPath = resolveArtifactPath(project, artifact);
        const artifactType = resolveArtifactType(artifact);
        const canOpen = Boolean(artifactPath && artifact.exists !== false);
        return (
          <button
            key={`${substage.substageKey}-${artifact.id}`}
            type="button"
            disabled={!canOpen}
            className={[
              'block w-full rounded px-2 py-1 text-left',
              canOpen
                ? 'hover:bg-accent/30'
                : 'cursor-default text-muted-foreground opacity-80',
            ].join(' ')}
            onClick={() => {
              if (!artifactPath || !canOpen) {
                return;
              }

              if (artifactType === 'directory') {
                onOpenArtifactDirectory(artifactPath);
                return;
              }

              onOpenArtifactFile(artifactPath);
            }}
          >
            <div className="flex items-center gap-2">
              {renderNodeAnchor(`artifact:${stageKey}:${substage.substageKey}:${artifact.id}`, artifact.status)}
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span
                className={[
                  'text-sm',
                  canOpen
                    ? `${getLinkTone(artifact.status)} underline decoration-current underline-offset-2`
                    : getTodoTextTone(artifact.status),
                ].join(' ')}
              >
                {artifact.label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function renderSubstageSessions(
  project: Project,
  workflow: ProjectWorkflow,
  substage: WorkflowSubstageInspection,
  onNavigateToSession: WorkflowDetailViewProps['onNavigateToSession'],
  hiddenSessionId?: string | null,
) {
  /**
   * Surface reviewer and repair child sessions as first-class audit evidence so
   * workflow stages do not hide the actual internal review conversations.
   */
  const sessions = getRenderableSubstageSessions(substage, hiddenSessionId);
  if (sessions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 pl-5">
      {sessions.map((session) => (
        <button
          key={`${substage.substageKey}-${session.id}`}
          type="button"
          className="block w-full rounded px-2 py-1 text-left hover:bg-accent/30"
          onClick={() => {
            onNavigateToSession(
              session.id,
              buildWorkflowSessionRouteOptions(project, workflow, session),
            );
          }}
        >
          <span className={['text-sm underline decoration-current underline-offset-2', getLinkTone(substage.status)].join(' ')}>
            {session.title || session.summary || '子会话'}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function WorkflowDetailView({
  project,
  workflow,
  treeOnly = false,
  onNavigateToSession,
  onOpenArtifactFile,
  onOpenArtifactDirectory,
  onContinueWorkflow,
  onDeleteWorkflow,
  onUpdateWorkflowGateDecision,
}: WorkflowDetailViewProps) {
  const [freshWorkflow, setFreshWorkflow] = useState<ProjectWorkflow | null>(null);
  const [graphPaths, setGraphPaths] = useState<WorkflowGraphPath[]>([]);
  const [updatingProviderStage, setUpdatingProviderStage] = useState<string | null>(null);
  const [providerUpdateError, setProviderUpdateError] = useState<{ stageKey: string; message: string } | null>(null);
  const [openProviderDropdown, setOpenProviderDropdown] = useState<string | null>(null);
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const nodeAnchorRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const currentWorkflow = freshWorkflow || workflow;
  useEffect(() => {
    /**
     * PURPOSE: Re-read workflow detail from the backend so route-selected views
     * reflect external conf.json edits and cross-tab provider changes.
     */
    let cancelled = false;
    setFreshWorkflow(null);
    api.projectWorkflow(project.name, workflow.id)
      .then(async (response) => {
        if (!response.ok || cancelled) {
          return;
        }
        setFreshWorkflow(await response.json());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.name, workflow.id, workflow.updatedAt, workflow.gateDecision, workflow.runState]);
  useEffect(() => {
    /**
     * PURPOSE: Close provider dropdown when clicking outside.
     */
    if (!openProviderDropdown) {
      return undefined;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-provider-dropdown]')) {
        setOpenProviderDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [openProviderDropdown]);
  const stageInspections = useMemo(
    () => (currentWorkflow.stageInspections && currentWorkflow.stageInspections.length > 0
      ? currentWorkflow.stageInspections
      : buildFallbackStageInspections(currentWorkflow)),
    [currentWorkflow],
  );
  const visualProgress = useMemo(() => buildVisualProgress(stageInspections), [stageInspections]);
  const getStageVisualStatus = (stage: WorkflowStageInspection) => visualProgress.stageStatuses[stage.stageKey] || normalizeLampStatus(stage.status);
  const getSubstageVisualStatus = (stage: WorkflowStageInspection, substage: WorkflowSubstageInspection) => (
    visualProgress.substageStatuses[buildSubstageStatusKey(stage.stageKey, substage.substageKey)] || normalizeLampStatus(substage.status)
  );
  const continueState = useMemo(
    () => (freshWorkflow
      ? resolveContinueState(currentWorkflow, stageInspections)
      : { canContinue: false, disabled: true, label: '继续推进' }),
    [currentWorkflow, freshWorkflow, stageInspections],
  );
  const handleStageProviderChange = async (stageKey: string, provider: SessionProvider) => {
    /**
     * PURPOSE: Persist provider choices without altering stage progress.
     */
    setUpdatingProviderStage(stageKey);
    setProviderUpdateError(null);
    try {
      const response = await api.updateWorkflowStageProviders(project.name, currentWorkflow.id, {
        [stageKey]: provider,
      });
      if (!response.ok) {
        throw new Error(`Failed to update workflow stage provider: ${response.status}`);
      }
      await window.refreshProjects?.();
    } catch (error) {
      console.error('Error updating workflow stage provider:', error);
      setProviderUpdateError({ stageKey, message: '阶段已启动，无法修改 provider。' });
      await window.refreshProjects?.();
    } finally {
      setUpdatingProviderStage(null);
    }
  };
  const visibleGraphEdges = useMemo(() => {
    /**
     * Build the visible parent-child graph for the current expanded tree so the
     * SVG overlay can connect node centers instead of guessing with CSS rails.
     */
    const edges: WorkflowGraphEdge[] = [];
    const pushLinearChain = (
      parentId: string,
      childIds: string[],
      sourceStatus: string,
    ) => {
      childIds.forEach((childId, index) => {
	        edges.push({
	          childId,
	          kind: index === 0 ? 'branch' : 'chain',
	          id: `${index === 0 ? parentId : childIds[index - 1]}->${childId}`,
	          sourceStatus,
	          targetId: index === 0 ? parentId : childIds[index - 1],
	        });
      });
    };
    stageInspections.forEach((stage, index) => {
      if (index === 0) {
        return;
      }
      const previousStage = stageInspections[index - 1];
      edges.push({
        childId: `stage:${stage.stageKey}`,
        kind: 'chain',
        id: `stage:${previousStage.stageKey}->stage:${stage.stageKey}`,
        sourceStatus: getStageVisualStatus(previousStage),
        targetId: `stage:${previousStage.stageKey}`,
      });
    });
    stageInspections.forEach((stage) => {
      const stageNodeId = `stage:${stage.stageKey}`;
      const collapsedSubstage = getSingleStageSubstage(stage);
      if (collapsedSubstage) {
        pushLinearChain(
          stageNodeId,
          (collapsedSubstage.files || []).map((artifact) => `artifact:${stage.stageKey}:${collapsedSubstage.substageKey}:${artifact.id}`),
          getStageVisualStatus(stage),
        );
        return;
      }
      pushLinearChain(
        stageNodeId,
        stage.substages.map((substage) => `substage:${stage.stageKey}:${substage.substageKey}`),
        getStageVisualStatus(stage),
      );
      stage.substages.forEach((substage) => {
        const substageNodeId = `substage:${stage.stageKey}:${substage.substageKey}`;
        pushLinearChain(
          substageNodeId,
          (substage.files || []).map((artifact) => `artifact:${stage.stageKey}:${substage.substageKey}:${artifact.id}`),
          getSubstageVisualStatus(stage, substage),
        );
      });
    });
    return edges;
  }, [stageInspections, visualProgress]);

  useLayoutEffect(() => {
    /**
     * Measure rendered node anchors and convert the visible workflow tree into
     * deterministic SVG paths that actually pass through node centers.
     */
    const container = treeContainerRef.current;
    if (!container) {
      setGraphPaths([]);
      return;
    }
    const measureGraph = () => {
      const containerRect = container.getBoundingClientRect();
      const nextPaths = visibleGraphEdges.flatMap((edge) => {
        const sourceEl = nodeAnchorRefs.current[edge.targetId];
        const targetEl = nodeAnchorRefs.current[edge.childId];
        if (!sourceEl || !targetEl) {
          return [];
        }
        const sourceRect = sourceEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const sourceX = sourceRect.left - containerRect.left + sourceRect.width / 2;
        const sourceY = sourceRect.top - containerRect.top + sourceRect.height / 2;
        const targetX = targetRect.left - containerRect.left + targetRect.width / 2;
        const targetY = targetRect.top - containerRect.top + targetRect.height / 2;
        return [{
          d: buildWorkflowEdgePath(sourceX, sourceY, targetX, targetY, edge.kind),
          id: edge.id,
          toneClass: getPipelineStrokeTone(edge.sourceStatus),
        }];
      });
      setGraphPaths(nextPaths);
    };
    const frame = window.requestAnimationFrame(measureGraph);
    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(measureGraph);
    });
    resizeObserver.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [currentWorkflow.updatedAt, stageInspections, visibleGraphEdges]);

  const registerNodeAnchor = (nodeId: string) => (element: HTMLSpanElement | null) => {
    nodeAnchorRefs.current[nodeId] = element;
  };

  const renderNodeAnchor = (nodeId: string, status: string) => (
    <span ref={registerNodeAnchor(nodeId)} className="relative z-10 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background">
      {renderTodoMarker(status)}
    </span>
  );

  const stageTree = (
    <div
      ref={treeContainerRef}
      className={[
        'relative space-y-3',
        treeOnly ? 'p-3' : 'mt-4 border-t border-border/40 pt-4',
      ].join(' ')}
      data-testid={treeOnly ? 'workflow-stage-tree-preview' : 'workflow-stage-tree'}
    >
      <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible" aria-hidden="true">
        {graphPaths.map((path) => (
          <path
            key={path.id}
            d={path.d}
            className={path.toneClass}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        ))}
      </svg>

      {stageInspections.map((stage) => {
        const collapsedSubstage = getSingleStageSubstage(stage);
        const stageSession = getPrimaryStageSession(stage);
        const stageVisualStatus = getStageVisualStatus(stage);
        const stageProvider = getWorkflowStageProvider(currentWorkflow, stage.stageKey, stageSession);
        const providerLocked = isStageProviderLocked(stage, stageSession);
        const collapsedSubstageVisualStatus = collapsedSubstage
          ? getSubstageVisualStatus(stage, collapsedSubstage)
          : null;

        return (
          <div key={stage.stageKey} data-testid={`workflow-stage-${stage.stageKey}`} className="space-y-2">
            <div className="relative z-10 flex items-center gap-2 rounded-md bg-card/80 py-1">
              {renderNodeAnchor(`stage:${stage.stageKey}`, stageVisualStatus)}
              {stageSession ? (
                <button
                  type="button"
                  className={[
                    'min-w-0 text-left text-sm font-medium underline decoration-current underline-offset-2',
                    getLinkTone(stage.status),
                  ].join(' ')}
                  onClick={() => {
                    onNavigateToSession(
                      stageSession.id,
                      buildWorkflowSessionRouteOptions(project, currentWorkflow, stageSession),
                    );
                  }}
                >
                  {stage.title}
                </button>
              ) : (
                <span className={['text-sm font-medium', getTodoTextTone(stage.status)].join(' ')}>
                  {stage.title}
                </span>
              )}
              <div className="ml-auto">
                {providerLocked ? (
                  <span
                    data-testid="workflow-stage-provider-badge"
                    className="inline-flex h-6 items-center rounded-md border border-border/60 px-2"
                  >
                    {stageProvider === 'claude' ? (
                      <ClaudeLogo className="h-4 w-4" />
                    ) : (
                      <CodexLogo className="h-4 w-4" />
                    )}
                  </span>
                ) : (
                  <div className="relative" data-provider-dropdown>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center rounded-md border border-input bg-transparent px-2 outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                      disabled={updatingProviderStage === stage.stageKey}
                      onClick={() => {
                        setOpenProviderDropdown(
                          openProviderDropdown === stage.stageKey ? null : stage.stageKey,
                        );
                      }}
                    >
                      {stageProvider === 'claude' ? (
                        <ClaudeLogo className="h-4 w-4" />
                      ) : (
                        <CodexLogo className="h-4 w-4" />
                      )}
                    </button>
                    {openProviderDropdown === stage.stageKey && (
                      <div className="absolute right-0 z-50 mt-1 w-16 rounded-md border border-border bg-popover shadow-md">
                        <button
                          type="button"
                          className="flex w-full items-center justify-center px-2 py-1.5 hover:bg-accent"
                          onClick={() => {
                            void handleStageProviderChange(stage.stageKey, 'claude');
                            setOpenProviderDropdown(null);
                          }}
                        >
                          <ClaudeLogo className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center justify-center px-2 py-1.5 hover:bg-accent"
                          onClick={() => {
                            void handleStageProviderChange(stage.stageKey, 'codex');
                            setOpenProviderDropdown(null);
                          }}
                        >
                          <CodexLogo className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {providerUpdateError?.stageKey === stage.stageKey ? (
              <div className="pl-8 text-xs text-destructive">
                {providerUpdateError.message}
              </div>
            ) : null}

            {collapsedSubstage ? (
              <div className="relative z-10 space-y-1 pl-5">
                {renderSubstageSessions(
                  project,
                  currentWorkflow,
                  collapsedSubstage,
                  onNavigateToSession,
                  stageSession?.id,
                )}
                {renderSubstageFiles(
                  project,
                  stage.stageKey,
                  { ...collapsedSubstage, status: collapsedSubstageVisualStatus || collapsedSubstage.status },
                  renderNodeAnchor,
                  onOpenArtifactFile,
                  onOpenArtifactDirectory,
                )}
              </div>
            ) : (
              <div className="relative z-10 space-y-2 pl-5">
                {stage.substages.map((substage) => {
                  const substageVisualStatus = getSubstageVisualStatus(stage, substage);
                  return (
                    <div key={substage.substageKey} className="space-y-1">
                      <div className="flex items-center gap-2 rounded-md bg-card/80 py-1">
                        {renderNodeAnchor(`substage:${stage.stageKey}:${substage.substageKey}`, substageVisualStatus)}
                        <span className={['text-sm', getTodoTextTone(substage.status)].join(' ')}>
                          {substage.title}
                        </span>
                      </div>
                      {renderSubstageSessions(project, currentWorkflow, substage, onNavigateToSession, stageSession?.id)}
                      {renderSubstageFiles(
                        project,
                        stage.stageKey,
                        { ...substage, status: substageVisualStatus },
                        renderNodeAnchor,
                        onOpenArtifactFile,
                        onOpenArtifactDirectory,
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  if (treeOnly) {
    return (
      <div className="max-h-[70vh] overflow-auto rounded-md border border-border/60 bg-background/95 shadow-sm backdrop-blur-sm">
        {stageTree}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:px-6">
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-foreground">{currentWorkflow.title}</h2>
            </div>

            <div className="flex items-center gap-2">
              {onUpdateWorkflowGateDecision && (
                <div className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background p-1">
                  {([
                    ['pass', '通过'],
                    ['needs_repair', '待完善'],
                  ] as const).map(([decision, label]) => {
                    const active = currentWorkflow.gateDecision === decision;
                    return (
                      <button
                        key={decision}
                        type="button"
                        data-testid={`workflow-gate-decision-${decision}`}
                        className={[
                          'rounded px-2 py-1 text-xs',
                          active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                        ].join(' ')}
                        aria-pressed={active}
                        onClick={() => onUpdateWorkflowGateDecision(currentWorkflow, decision)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              {onDeleteWorkflow && (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-background px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-900/20"
                  onClick={() => onDeleteWorkflow(currentWorkflow)}
                >
                  <Trash2 className="h-4 w-4" />
                  删除工作流
                </button>
              )}
              {continueState.canContinue && (
                <button
                  type="button"
                  disabled={continueState.disabled}
                  className={[
                    'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                    continueState.disabled
                      ? 'cursor-not-allowed border-border bg-background text-muted-foreground opacity-70'
                      : 'border-primary/40 bg-primary/10 text-foreground',
                  ].join(' ')}
                  onClick={() => onContinueWorkflow?.(currentWorkflow)}
                >
                  <Play className="h-4 w-4 fill-current" />
                  {continueState.label}
                </button>
              )}
            </div>
          </div>
          {stageTree}
        </div>

      </div>
    </div>
  );
}
