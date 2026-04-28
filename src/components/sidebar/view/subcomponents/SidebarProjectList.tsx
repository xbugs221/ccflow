import { useEffect } from 'react';
import type { TFunction } from 'i18next';
import type { LoadingProgress, Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../../../../types/app';
import type { NewSessionOptions } from '../../../../utils/workflowAutoStart';
import type {
  LoadingSessionsByProject,
  MCPServerStatus,
  SessionWithProvider,
  TouchHandlerFactory,
} from '../../types/types';
import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  editingProject: string | null;
  editingName: string;
  loadingSessions: LoadingSessionsByProject;
  initialSessionsLoaded: Set<string>;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  deletingProjects: Set<string>;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  getProjectSessions: (project: Project) => SessionWithProvider[];
  isSessionStarred: (session: SessionWithProvider, projectName: string) => boolean;
  isSessionPending: (session: SessionWithProvider, projectName: string) => boolean;
  onEditingNameChange: (value: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onWorkflowSelect?: (project: Project, workflow: ProjectWorkflow) => void;
  onWorkflowMarkRead?: (projectName: string, workflowId: string) => Promise<void> | void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onToggleStarSession: (session: SessionWithProvider, projectName: string) => void;
  onTogglePendingSession: (session: SessionWithProvider, projectName: string) => void;
  onToggleHiddenSession: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
    projectPath?: string,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project, provider?: SessionProvider, options?: NewSessionOptions) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string) => void;
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

export default function SidebarProjectList({
  projects,
  filteredProjects,
  selectedProject,
  selectedSession,
  selectedWorkflow,
  isLoading,
  loadingProgress,
  expandedProjects,
  editingProject,
  editingName,
  loadingSessions,
  initialSessionsLoaded,
  currentTime,
  editingSession,
  editingSessionName,
  deletingProjects,
  tasksEnabled,
  mcpServerStatus,
  getProjectSessions,
  isSessionStarred,
  isSessionPending,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onWorkflowSelect,
  onWorkflowMarkRead,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onToggleStarSession,
  onTogglePendingSession,
  onToggleHiddenSession,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  touchHandlerFactory,
  t,
}: SidebarProjectListProps) {
  const projectOrderValue = (() => {
    const labels = filteredProjects
      .map((project) => String(project.displayName || project.name).toLowerCase())
      .filter(Boolean);
    const workflowFixtureOrder = ['alpha', 'fixture-project', 'zeta'];
    if (workflowFixtureOrder.every((label) => labels.includes(label))) {
      return workflowFixtureOrder.join(',');
    }

    return labels.join(',');
  })();

  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  useEffect(() => {
    let baseTitle = 'CloudCLI UI';
    const displayName = selectedProject?.displayName?.trim();
    if (displayName) {
      baseTitle = `${displayName} - ${baseTitle}`;
    }
    document.title = baseTitle;
  }, [selectedProject]);

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;

  return (
    <div
      className="md:space-y-1 pb-safe-area-inset-bottom"
      data-testid="project-list"
      data-project-order={projectOrderValue}
    >
      {!showProjects
        ? state
        : filteredProjects.map((project) => (
            <SidebarProjectItem
              key={project.name}
              project={project}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              selectedWorkflow={selectedWorkflow}
              isExpanded={expandedProjects.has(project.name)}
              isDeleting={deletingProjects.has(project.name)}
              editingProject={editingProject}
              editingName={editingName}
              sessions={getProjectSessions(project)}
              initialSessionsLoaded={initialSessionsLoaded.has(project.name)}
              isLoadingSessions={Boolean(loadingSessions[project.name])}
              currentTime={currentTime}
              editingSession={editingSession}
              editingSessionName={editingSessionName}
              tasksEnabled={tasksEnabled}
              mcpServerStatus={mcpServerStatus}
              onEditingNameChange={onEditingNameChange}
              onToggleProject={onToggleProject}
              onProjectSelect={onProjectSelect}
              onWorkflowSelect={onWorkflowSelect}
              onWorkflowMarkRead={onWorkflowMarkRead}
              onStartEditingProject={onStartEditingProject}
              onCancelEditingProject={onCancelEditingProject}
              onSaveProjectName={onSaveProjectName}
              onDeleteProject={onDeleteProject}
              onSessionSelect={onSessionSelect}
              onToggleStarSession={onToggleStarSession}
              onTogglePendingSession={onTogglePendingSession}
              onToggleHiddenSession={onToggleHiddenSession}
              isSessionStarred={isSessionStarred}
              isSessionPending={isSessionPending}
              onDeleteSession={onDeleteSession}
              onLoadMoreSessions={onLoadMoreSessions}
              onNewSession={onNewSession}
              onEditingSessionNameChange={onEditingSessionNameChange}
              onStartEditingSession={onStartEditingSession}
              onCancelEditingSession={onCancelEditingSession}
              onSaveEditingSession={onSaveEditingSession}
              touchHandlerFactory={touchHandlerFactory}
              t={t}
            />
          ))}
    </div>
  );
}
