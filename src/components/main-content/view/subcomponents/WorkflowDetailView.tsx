/**
 * PURPOSE: Render a workflow control-plane detail tree with stage, substage,
 * artifact, and child-session inspection data.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, Play } from 'lucide-react';
import ClaudeLogo from '../../../llm-logo-provider/ClaudeLogo';
import CodexLogo from '../../../llm-logo-provider/CodexLogo';
import type {
  Project,
  ProjectWorkflow,
  SessionProvider,
  WorkflowArtifact,
  WorkflowChildSession,
  WorkflowRunnerProcess,
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
   * Workflow sessions are stage-owned for single-step stages, while reviewer
   * passes are keyed by the concrete substage they prove.
   */
  return (substage.agentSessions || []).filter((session) => (
    session.stageKey === substage.stageKey || session.stageKey === substage.substageKey
  ));
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

  if (workflow.runner === 'go') {
    return { canContinue: false, disabled: true, label: 'Go runner 执行中' };
  }

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
            {!canOpen && artifact.exists === false ? (
              <div className="pl-7 text-xs text-muted-foreground">
                {artifact.label} 尚未生成。
              </div>
            ) : null}
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

function buildRunnerProcessSession(
  workflow: ProjectWorkflow,
  process: WorkflowRunnerProcess,
): WorkflowChildSession | null {
  /**
   * PURPOSE: Resolve runner process thread rows to workflow child-session route
   * records so process links enter `/wN/cM` instead of project manual routes.
   */
  if (!process.sessionId) {
    return null;
  }
  return (workflow.childSessions || []).find((session) => (
    session.id === process.sessionId && (session.provider || 'codex') === 'codex'
  )) || {
    id: process.sessionId,
    title: process.stage,
    provider: 'codex',
    workflowId: workflow.id,
    stageKey: process.stage,
  };
}

function renderRunnerProcesses(
  project: Project,
  workflow: ProjectWorkflow,
  onNavigateToSession: WorkflowDetailViewProps['onNavigateToSession'],
  onOpenArtifactFile: WorkflowDetailViewProps['onOpenArtifactFile'],
) {
  /**
   * PURPOSE: Show Go runner process rows from the backend read model without
   * parsing terminal output in the browser.
   */
  const processes = Array.isArray(workflow.runnerProcesses) ? workflow.runnerProcesses : [];
  if (processes.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2" data-testid="workflow-runner-processes">
      <h3 className="text-sm font-semibold text-foreground">进程</h3>
      <div className="overflow-hidden rounded-md border border-border">
        {processes.map((process, index) => {
          const session = buildRunnerProcessSession(workflow, process);
          const meta = [
            process.role ? `role=${process.role}` : '',
            process.pid !== undefined ? `pid=${process.pid}` : '',
            process.exitCode !== undefined ? `exit=${process.exitCode}` : '',
            process.failed !== undefined ? `failed=${process.failed ? 'true' : 'false'}` : '',
          ].filter(Boolean).join(' ');
          return (
            <div
              key={`${process.stage}-${process.role}-${process.sessionId || index}`}
              className="grid gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 md:grid-cols-[minmax(7rem,1fr)_minmax(6rem,0.8fr)_minmax(10rem,1.3fr)_auto]"
            >
              <div className="font-medium text-foreground">{process.stage}</div>
              <div className="text-muted-foreground">{process.status}</div>
              <div className="min-w-0 text-muted-foreground">
                {session ? (
                  <button
                    type="button"
                    className="max-w-full truncate text-left text-indigo-600 underline decoration-current underline-offset-2 hover:text-violet-700 dark:text-violet-300"
                    onClick={() => onNavigateToSession(
                      session.id,
                      buildWorkflowSessionRouteOptions(project, workflow, session),
                    )}
                  >
                    thread={process.sessionId}
                  </button>
                ) : meta || 'pending'}
                {session && meta ? <span className="ml-2">{meta}</span> : null}
              </div>
              <div className="flex justify-start md:justify-end">
                {process.logPath ? (
                  <button
                    type="button"
                    className="text-indigo-600 underline decoration-current underline-offset-2 hover:text-violet-700 dark:text-violet-300"
                    onClick={() => onOpenArtifactFile(process.logPath || '')}
                  >
                    log
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function renderStageControlPlaneEvents(stage: WorkflowStageInspection) {
  /**
   * Render workflow controller warnings and recovery records beside the stage
   * that owns the affected child-session index.
   */
  const warnings = Array.isArray(stage.warnings) ? stage.warnings : [];
  const recoveryEvents = Array.isArray(stage.recoveryEvents) ? stage.recoveryEvents : [];
  if (warnings.length === 0 && recoveryEvents.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 pl-8" data-testid={`workflow-stage-control-plane-events-${stage.stageKey}`}>
      {warnings.map((event, index) => (
        <div
          key={`warning-${event.type}-${event.createdAt || index}`}
          className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>{event.message || event.type}</span>
        </div>
      ))}
      {recoveryEvents.map((event, index) => (
        <div
          key={`recovery-${event.type}-${event.createdAt || index}`}
          className="rounded-md border border-emerald-300/60 bg-emerald-50 px-2 py-1 text-xs text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          {event.message || event.type}
        </div>
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
}: WorkflowDetailViewProps) {
  const [freshWorkflow, setFreshWorkflow] = useState<ProjectWorkflow | null>(null);
  const [graphPaths, setGraphPaths] = useState<WorkflowGraphPath[]>([]);
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
     * Keep Go runner-backed detail views in sync while state.json/log watchers
     * broadcast sidebar updates through the shared projects channel.
     */
    if (currentWorkflow.runner !== 'go' || currentWorkflow.runState !== 'running') {
      return undefined;
    }

    let cancelled = false;
    const refreshWorkflow = () => {
      api.projectWorkflow(project.name, workflow.id)
        .then(async (response) => {
          if (!response.ok || cancelled) {
            return;
          }
          setFreshWorkflow(await response.json());
        })
        .catch(() => undefined);
    };
    const intervalId = window.setInterval(refreshWorkflow, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentWorkflow.runner, currentWorkflow.runState, project.name, workflow.id]);
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
    <span
      ref={registerNodeAnchor(nodeId)}
      data-node-id={nodeId}
      data-node-status={normalizeLampStatus(status)}
      className="relative z-10 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background"
    >
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
        const collapsedSubstageVisualStatus = collapsedSubstage
          ? getSubstageVisualStatus(stage, collapsedSubstage)
          : null;

        return (
          <div
            key={stage.stageKey}
            data-testid={`workflow-stage-${stage.stageKey}`}
            className="space-y-2"
          >
            <div
              data-testid={collapsedSubstage ? `workflow-substage-${collapsedSubstage.substageKey}` : undefined}
              className="relative z-10 flex items-center gap-2 rounded-md bg-card/80 py-1"
            >
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
                  {isWorkflowReviewStageKey(stage.stageKey) ? collapsedSubstage?.title || stage.title : stage.title}
                </button>
              ) : (
                <span className={['text-sm font-medium', getTodoTextTone(stage.status)].join(' ')}>
                  {stage.title}
                </span>
              )}
              <div className="ml-auto">
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
              </div>
            </div>
            {renderStageControlPlaneEvents(stage)}

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
                    <div key={substage.substageKey} data-testid={`workflow-substage-${substage.substageKey}`} className="space-y-1">
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
              {currentWorkflow.runner === 'go' && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Go runner: {currentWorkflow.runId || '未绑定'}</span>
                  <span>阶段: {currentWorkflow.stage}</span>
                  <span>状态: {currentWorkflow.runState}</span>
                  <span>Provider: Codex</span>
                  {currentWorkflow.runnerError && <span className="text-destructive">{currentWorkflow.runnerError}</span>}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
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
          {renderRunnerProcesses(project, currentWorkflow, onNavigateToSession, onOpenArtifactFile)}
          {stageTree}
        </div>

      </div>
    </div>
  );
}
