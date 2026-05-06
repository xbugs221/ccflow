/**
 * PURPOSE: Define shared application read-model types used by project,
 * workflow, and session UI components.
 */
export type SessionProvider = 'claude' | 'codex' | 'opencode';

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'preview';

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
  stage?: string;
  substageKey?: string;
  exists?: boolean;
}

export interface WorkflowChildSession {
  id: string;
  title: string;
  summary?: string;
  provider?: SessionProvider | string;
  routeIndex?: number;
  workflowId?: string;
  projectPath?: string;
  stageKey?: string;
  url?: string;
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

export interface ProjectWorkflow {
  id: string;
  routeIndex?: number;
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
  favorite?: boolean;
  pending?: boolean;
  hidden?: boolean;
  gateDecision?: string;
  stageStatuses: WorkflowStageStatus[];
  artifacts: WorkflowArtifact[];
  childSessions: WorkflowChildSession[];
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
  scheduledAt?: string;
  [key: string]: unknown;
}

export interface ProjectSession {
  id: string;
  routeIndex?: number;
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
  messageCount?: number;
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

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
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
  opencodeSessions?: ProjectSession[];
  workflows?: ProjectWorkflow[];
  sessionMeta?: ProjectSessionMeta;
  manualSessionNextRouteIndex?: number;
  taskmaster?: ProjectTaskmasterInfo;
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
