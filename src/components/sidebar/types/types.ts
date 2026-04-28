import type React from 'react';
import type { LoadingProgress, Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../../../types/app';
import type { NewSessionOptions } from '../../../utils/workflowAutoStart';

export type ProjectSortOrder = 'name' | 'date';

export type SessionWithProvider = ProjectSession & {
  __provider: SessionProvider;
};

export type AdditionalSessionsByProject = Record<string, ProjectSession[]>;
export type LoadingSessionsByProject = Record<string, boolean>;

export type DeleteProjectConfirmation = {
  project: Project;
  sessionCount: number;
};

export type SessionDeleteConfirmation = {
  projectName: string;
  sessionId: string;
  sessionTitle: string;
  provider: SessionProvider;
  projectPath?: string;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onWorkflowSelect?: (project: Project, workflow: ProjectWorkflow) => void;
  onWorkflowMarkRead?: (projectName: string, workflowId: string) => Promise<void> | void;
  onNewSession: (project: Project, provider?: SessionProvider, options?: NewSessionOptions) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectDelete?: (projectName: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: () => void;
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  isMobile: boolean;
};

export type SessionViewModel = {
  isCodexSession: boolean;
  isActive: boolean;
  sessionName: string;
  sessionTime: string;
  messageCount: number;
};

export type MCPServerStatus = {
  hasMCPServer?: boolean;
  isConfigured?: boolean;
} | null;

export type TouchHandlerFactory = (
  callback: () => void,
) => (event: React.TouchEvent<HTMLElement>) => void;

export type SettingsProject = Pick<Project, 'name' | 'displayName' | 'fullPath' | 'path'>;
