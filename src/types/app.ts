/**
 * PURPOSE: Define shared application read-model types used by project,
 * workflow, and session UI components.
 */
export type SessionProvider = 'codex' | 'pi';

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'preview';

export interface WorkflowStageStatus {
  key: string;
  label: string;
  status: string;
  provider?: SessionProvider;
}

export interface WorkflowArtifact {
  id: string;
  label: string;
  status: string;
  path?: string;
  relativePath?: string;
  type?: 'file' | 'directory' | string;
  semanticType?: string;
  stage?: string;
  substageKey?: string;
  exists?: boolean;
}

export interface WorkflowChildSession {
  id: string;
  title: string;
  summary?: string;
  provider?: SessionProvider | string;
  role?: string;
  workflowId?: string;
  projectPath?: string;
  stageKey?: string;
  address?: string;
  routePath?: string;
  url?: string;
}

export interface WorkflowRunnerProcess {
  stage: string;
  role: string;
  status: string;
  sessionId?: string;
  pid?: number | string;
  exitCode?: number | string;
  failed?: boolean;
  logPath?: string;
}

export interface WorkflowSubstageInspection {
  stageKey: string;
  substageKey: string;
  title: string;
  status: string;
  summary?: string;
  whyBlocked?: string;
  latestEvent?: string;
  statusSource?: string;
  currentNode?: string;
  files?: WorkflowArtifact[];
  agentSessions?: WorkflowChildSession[];
}

export interface WorkflowStageInspection {
  stageKey: string;
  title: string;
  status: string;
  provider?: SessionProvider;
  note?: string;
  warnings?: WorkflowControllerEvent[];
  recoveryEvents?: WorkflowControllerEvent[];
  substages: WorkflowSubstageInspection[];
}

export interface WorkflowControllerEvent {
  type: string;
  stageKey?: string;
  provider?: SessionProvider | string;
  sessionId?: string;
  message?: string;
  createdAt?: string;
}

export interface WorkflowDisplayLine {
  id: string;
  marker: string;
  text: string;
  status: string;
  rawLine?: string;
  sessionRef?: {
    label: string;
    sessionId?: string;
    provider?: SessionProvider | string;
    stageKey?: string;
    address?: string;
    routePath?: string;
    unlinked?: boolean;
  } | null;
}

export interface WorkflowRoleSummaryRow {
  key: string;
  label: string;
  role: string;
  sessionRef?: {
    label: string;
    sessionId: string;
    provider?: SessionProvider | string;
    stageKey?: string;
    address?: string;
    routePath?: string;
    unlinked?: boolean;
  } | null;
  placeholder?: string;
  checkCount: number;
}

export interface WorkflowBatchInfo {
  id: string;
  displayId: string;
  status: string;
  currentIndex: number;
  displayCurrentIndex?: number;
  total: number;
  runIds: string[];
  changes: string[];
  error?: string;
}

export interface ProjectWorkflow {
  id: string;
  title: string;
  objective: string;
  openspecChangePrefix?: string;
  openspecChangeName?: string;
  openspecChangeDetected?: boolean;
  runner?: string;
  runnerProvider?: SessionProvider | string;
  runId?: string;
  runnerPid?: number;
  runnerError?: string;
  stage: string;
  runState: string;
  hasUnreadActivity?: boolean;
  updatedAt?: string;
  gateDecision?: string;
  stageStatuses: WorkflowStageStatus[];
  artifacts: WorkflowArtifact[];
  childSessions: WorkflowChildSession[];
  runnerProcesses?: WorkflowRunnerProcess[];
  runnerDiagnostics?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  workflowDisplay?: {
    lines?: WorkflowDisplayLine[];
  };
  workflowRoleSummary?: {
    rows?: WorkflowRoleSummaryRow[];
  };
  openspecTaskProgress?: {
    name?: string;
    status?: string;
    completedTasks?: number;
    totalTasks?: number;
    lastModified?: string | null;
  };
  stageInspections?: WorkflowStageInspection[];
  controllerEvents?: WorkflowControllerEvent[];
  controlPlaneReadModel?: unknown;
  recommendedActions?: string[];
  failureReason?: string;
  activeStep?: string;
  completedSteps?: number;
  totalSteps?: number;
  batchId?: string;
  batchDisplayId?: string;
  batchIndex?: number;
  batchTotal?: number;
  batchStatus?: string;
  [key: string]: unknown;
}

export interface ProjectSession {
  id: string;
  routeIndex?: number;
  routeTitle?: string;
  label?: string;
  title?: string;
  summary?: string;
  name?: string;
  model?: string;
  reasoningEffort?: string;
  thinkingMode?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number | null;
  messageCountKnown?: boolean;
  status?: string;
  favorite?: boolean;
  pending?: boolean;
  hidden?: boolean;
  archived?: boolean;
  projectPath?: string;
  workflowId?: string;
  stageKey?: string;
  projectPathExists?: boolean;
  visibilityReason?: string;
  __provider?: SessionProvider;
  __projectName?: string;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface Project {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  routePath?: string;
  sessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  piSessions?: ProjectSession[];
  workflows?: ProjectWorkflow[];
  batches?: WorkflowBatchInfo[];
  sessionMeta?: ProjectSessionMeta;
  manualSessionNextRouteIndex?: number;
  hasUnreadActivity?: boolean;
  [key: string]: unknown;
}

export interface LoadingProgress {
  type?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  projects: Project[];
  changedFile?: string;
  [key: string]: unknown;
}

export interface LoadingProgressMessage extends LoadingProgress {
  type: 'loading_progress';
}

export type AppSocketMessage =
  | LoadingProgressMessage
  | ProjectsUpdatedMessage
  | { type?: string;[key: string]: unknown };
