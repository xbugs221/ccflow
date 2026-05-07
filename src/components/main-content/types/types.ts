import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { AppTab, Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../../../types/app';
import type { SocketMessageEnvelope } from '../../../contexts/WebSocketContext';
import type { SessionWithProvider } from '../../sidebar/types/types';
import type { NewSessionOptions } from '../../../utils/workflowAutoStart';

export type SessionLifecycleHandler = (sessionId?: string | null) => void;

export type TaskMasterTask = {
  id: string | number;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  details?: string;
  testStrategy?: string;
  parentId?: string | number;
  dependencies?: Array<string | number>;
  subtasks?: TaskMasterTask[];
  [key: string]: unknown;
};

export type TaskReference = {
  id: string | number;
  title?: string;
  [key: string]: unknown;
};

export type TaskSelection = TaskMasterTask | TaskReference;

export type PrdFile = {
  name: string;
  content?: string;
  isExisting?: boolean;
  [key: string]: unknown;
};

export type MainContentProps = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: unknown;
  messageHistory: SocketMessageEnvelope[];
  isMobile: boolean;
  onMenuClick: () => void;
  isLoading: boolean;
  onInputFocusChange: (focused: boolean) => void;
  onSessionActive: SessionLifecycleHandler;
  onSessionInactive: SessionLifecycleHandler;
  onSessionProcessing: SessionLifecycleHandler;
  onSessionNotProcessing: SessionLifecycleHandler;
  processingSessions: Set<string>;
  onReplaceTemporarySession: SessionLifecycleHandler;
  onNavigateToSession: (
    targetSessionId: string,
    options?: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
      workflowId?: string;
      workflowStageKey?: string;
      routeSearch?: Record<string, string>;
    },
  ) => void;
  onSelectSession: (session: ProjectSession) => void;
  onSelectWorkflow: (project: Project, workflow: ProjectWorkflow) => void;
  onNewSession: (project: Project, provider?: SessionProvider, options?: NewSessionOptions) => void;
  onShowSettings: () => void;
  externalMessageUpdate: number;
  headerLeadingContent?: ReactNode;
};

export type MainContentHeaderProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  shouldShowTasksTab: boolean;
  isMobile: boolean;
  onMenuClick: () => void;
  leadingContent?: ReactNode;
};

export type MainContentStateViewProps = {
  mode: 'loading' | 'empty';
  isMobile: boolean;
  onMenuClick: () => void;
};

export type MobileMenuButtonProps = {
  onMenuClick: () => void;
  compact?: boolean;
};

export type TaskMasterPanelProps = {
  isVisible: boolean;
};

export type ProjectOverviewPanelProps = {
  project: Project;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  sessions: SessionWithProvider[];
  displayMode?: 'all' | 'workflows' | 'sessions';
  onNewSession: (project: Project, provider?: SessionProvider, options?: NewSessionOptions) => void;
  onSelectSession: (session: ProjectSession) => void;
  onSelectWorkflow: (project: Project, workflow: ProjectWorkflow) => void;
};
