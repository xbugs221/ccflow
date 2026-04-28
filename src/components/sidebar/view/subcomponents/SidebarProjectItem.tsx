/**
 * PURPOSE: Render a single sidebar project row with activity status, rename,
 * delete, and session expansion controls.
 */
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Button } from '../../../ui/button';
import { Check, Edit3, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import TaskIndicator from '../../../taskmaster/view/TaskIndicator';
import type { Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../../../../types/app';
import type { MCPServerStatus, SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import type { NewSessionOptions } from '../../../../utils/workflowAutoStart';
import { getTaskIndicatorStatus, isSessionActive } from '../../utils/utils';
import SidebarProjectSessions from './SidebarProjectSessions';
import SidebarProjectWorkflows from './SidebarProjectWorkflows';

const PROJECT_ACTION_LONG_PRESS_MS = 450;

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  isExpanded: boolean;
  isDeleting: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onEditingNameChange: (name: string) => void;
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
  isSessionStarred: (session: SessionWithProvider, projectName: string) => boolean;
  isSessionPending: (session: SessionWithProvider, projectName: string) => boolean;
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

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  selectedWorkflow,
  isExpanded,
  isDeleting,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingSessions,
  currentTime,
  editingSession,
  editingSessionName,
  tasksEnabled,
  mcpServerStatus,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onWorkflowSelect,
  onWorkflowMarkRead: _onWorkflowMarkRead,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onToggleStarSession,
  onTogglePendingSession,
  onToggleHiddenSession,
  isSessionStarred,
  isSessionPending,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  touchHandlerFactory,
  t,
}: SidebarProjectItemProps) {
  const isSelected = selectedProject?.name === project.name;
  const isEditing = editingProject === project.name;
  const taskStatus = getTaskIndicatorStatus(project, mcpServerStatus);
  const hasActiveSession = sessions.some((session) => isSessionActive(session, currentTime));
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);
  const [projectActionMenu, setProjectActionMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
  });
  const normalizedProjectLabel = String(project.displayName || project.name).toLowerCase().trim();
  const projectTestId = `project-list-item-${normalizedProjectLabel
    .replace(/^\./, 'dot-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;

  const saveProjectName = () => {
    onSaveProjectName(project.name);
  };

  const renderProjectMarker = (className: string, wrapperClassName: string) => (
    <div
      className={cn(
        'flex items-center justify-center rounded-md',
        wrapperClassName,
      )}
      title={hasActiveSession ? '有活跃会话' : '当前无活跃会话'}
    >
      <span
        data-testid={hasActiveSession ? `${projectTestId}-active-dot` : undefined}
        className={cn(
          className,
          'rounded-full',
          hasActiveSession ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30',
        )}
      />
    </div>
  );

  const selectProject = () => {
    onToggleProject(project.name);
    onProjectSelect(project);
  };

  /**
   * Dismiss the contextual action menu when focus moves away.
   */
  useEffect(() => {
    if (!projectActionMenu.isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setProjectActionMenu((current) => (current.isOpen ? { ...current, isOpen: false } : current));
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProjectActionMenu((current) => (current.isOpen ? { ...current, isOpen: false } : current));
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    const handleScroll = () => {
      setProjectActionMenu((current) => (current.isOpen ? { ...current, isOpen: false } : current));
    };

    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [projectActionMenu.isOpen]);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  /**
   * Open the project action menu near the user's interaction point.
   */
  const openProjectActionMenu = (x: number, y: number) => {
    setProjectActionMenu({
      isOpen: true,
      x,
      y,
    });
  };

  const closeProjectActionMenu = () => {
    setProjectActionMenu((current) => (current.isOpen ? { ...current, isOpen: false } : current));
  };

  const handleStartEditingProject = () => {
    closeProjectActionMenu();
    onStartEditingProject(project);
  };

  const handleDeleteProject = () => {
    closeProjectActionMenu();
    onDeleteProject(project);
  };

  /**
   * On desktop, project actions live behind the native right-click gesture.
   */
  const handleDesktopContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openProjectActionMenu(event.clientX, event.clientY);
  };

  /**
   * On mobile, a long press reveals project actions without selecting the project.
   */
  const handleMobileTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (isEditing) {
      return;
    }

    const touch = event.touches[0];
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = touch?.clientX ?? bounds.left + bounds.width / 2;
    const y = touch?.clientY ?? bounds.top + bounds.height / 2;

    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      suppressNextClickRef.current = true;
      openProjectActionMenu(x, y);
      clearLongPressTimer();
    }, PROJECT_ACTION_LONG_PRESS_MS);
  };

  const handleMobileTouchEnd = () => {
    clearLongPressTimer();
  };

  const handleMobileProjectClick = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    selectProject();
  };

  return (
    <div
      className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}
      data-testid={projectTestId}
    >
      <div className="group md:group">
        <div className="md:hidden">
          <div
            className={cn(
              'p-3 mx-3 my-1 rounded-lg bg-card border border-border/50 active:scale-[0.98] transition-all duration-150',
              isSelected && 'bg-primary/5 border-primary/20',
              !isSelected && hasActiveSession && 'border-green-500/30 bg-green-50/5 dark:bg-green-900/5',
            )}
            data-testid={`${projectTestId}-mobile-surface`}
            role="button"
            tabIndex={0}
            aria-expanded={isExpanded}
            onClick={handleMobileProjectClick}
            onTouchStart={handleMobileTouchStart}
            onTouchEnd={handleMobileTouchEnd}
            onTouchCancel={handleMobileTouchEnd}
            onTouchMove={handleMobileTouchEnd}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleMobileProjectClick();
              }
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <button
                        className="w-8 h-8 rounded-lg bg-green-500 dark:bg-green-600 flex items-center justify-center active:scale-90 transition-all duration-150 shadow-sm active:shadow-none"
                        onClick={(event) => {
                          event.stopPropagation();
                          saveProjectName();
                        }}
                      >
                        <Check className="w-4 h-4 text-white" />
                      </button>
                      <button
                        className="w-8 h-8 rounded-lg bg-gray-500 dark:bg-gray-600 flex items-center justify-center active:scale-90 transition-all duration-150 shadow-sm active:shadow-none"
                        onClick={(event) => {
                          event.stopPropagation();
                          onCancelEditingProject();
                        }}
                      >
                        <X className="w-4 h-4 text-white" />
                      </button>
                    </>
                  ) : (
                    <></>
                  )}

                  <div
                    className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                      hasActiveSession ? 'bg-green-500/10' : isExpanded ? 'bg-primary/10' : 'bg-muted',
                    )}
                  >
                    {renderProjectMarker('h-2.5 w-2.5', 'w-8 h-8')}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(event) => onEditingNameChange(event.target.value)}
                      className="w-full px-3 py-2 text-sm border-2 border-primary/40 focus:border-primary rounded-lg bg-background text-foreground shadow-sm focus:shadow-md transition-all duration-200 focus:outline-none"
                      placeholder={t('projects.projectNamePlaceholder')}
                      autoFocus
                      autoComplete="off"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          saveProjectName();
                        }

                        if (event.key === 'Escape') {
                          onCancelEditingProject();
                        }
                      }}
                      style={{
                        fontSize: '16px',
                        WebkitAppearance: 'none',
                        borderRadius: '8px',
                      }}
                    />
                  ) : (
                    <>
                      <div className="flex items-center justify-between min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="text-sm font-medium text-foreground truncate">{project.displayName}</h3>
                          {project.hasUnreadActivity && (
                            <span
                              className="inline-flex h-2.5 w-2.5 flex-shrink-0 rounded-full bg-green-500"
                            />
                          )}
                        </div>
                        {tasksEnabled && (
                          <TaskIndicator
                            status={taskStatus}
                            size="xs"
                            className="hidden md:inline-flex flex-shrink-0 ml-2"
                          />
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          className={cn(
            'hidden md:flex w-full justify-between p-2 h-auto font-normal hover:bg-accent/50',
            isSelected && 'bg-accent text-accent-foreground',
            !isSelected && hasActiveSession && 'border border-green-500/20 bg-green-50/10 dark:bg-green-900/5',
          )}
          onClick={selectProject}
          onContextMenu={handleDesktopContextMenu}
          data-testid={`${projectTestId}-desktop-surface`}
          aria-expanded={isExpanded}
        >
          <div className="flex items-center gap-2 flex-shrink-0">
            {isEditing ? (
              <>
                <div
                  className="w-6 h-6 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20 flex items-center justify-center rounded cursor-pointer transition-colors"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveProjectName();
                  }}
                >
                  <Check className="w-3 h-3" />
                </div>
                <div
                  className="w-6 h-6 text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-center rounded cursor-pointer transition-colors"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingProject();
                  }}
                >
                  <X className="w-3 h-3" />
                </div>
              </>
            ) : (
              <></>
            )}
            {renderProjectMarker('h-2.5 w-2.5 flex-shrink-0', 'h-4 w-4 flex-shrink-0')}
          </div>

          <div className="min-w-0 flex-1 text-left">
            {isEditing ? (
              <div className="space-y-1">
                <input
                  type="text"
                  value={editingName}
                  onChange={(event) => onEditingNameChange(event.target.value)}
                  className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:ring-2 focus:ring-primary/20"
                  placeholder={t('projects.projectNamePlaceholder')}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      saveProjectName();
                    }
                    if (event.key === 'Escape') {
                      onCancelEditingProject();
                    }
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground" title={project.displayName}>
                <span className="truncate">{project.displayName}</span>
                {project.hasUnreadActivity && (
                  <span
                    data-testid={`${projectTestId}-unread-dot`}
                    className="inline-flex h-2.5 w-2.5 flex-shrink-0 rounded-full bg-green-500"
                  />
                )}
              </div>
            )}
          </div>
        </Button>

        {projectActionMenu.isOpen && !isEditing && (
          <div
            ref={actionMenuRef}
            className="fixed z-[80] min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: projectActionMenu.x, top: projectActionMenu.y }}
            data-testid={`${projectTestId}-context-menu`}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={handleStartEditingProject}
              data-testid={`${projectTestId}-rename-action`}
            >
              <Edit3 className="h-4 w-4" />
              {t('actions.rename')}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              onClick={handleDeleteProject}
              data-testid={`${projectTestId}-delete-action`}
            >
              <Trash2 className="h-4 w-4" />
              {t('actions.delete')}
            </button>
          </div>
        )}
      </div>

      <SidebarProjectWorkflows
        project={project}
        isExpanded={isExpanded}
        selectedWorkflow={selectedWorkflow}
        onProjectSelect={onProjectSelect}
        onWorkflowSelect={onWorkflowSelect}
        onNewSession={onNewSession}
        t={t}
      />

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        selectedWorkflow={selectedWorkflow}
        initialSessionsLoaded={initialSessionsLoaded}
        isLoadingSessions={isLoadingSessions}
        currentTime={currentTime}
        editingSession={editingSession}
        editingSessionName={editingSessionName}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onToggleStarSession={onToggleStarSession}
        onTogglePendingSession={onTogglePendingSession}
        onToggleHiddenSession={onToggleHiddenSession}
        isSessionStarred={isSessionStarred}
        isSessionPending={isSessionPending}
        onDeleteSession={onDeleteSession}
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        touchHandlerFactory={touchHandlerFactory}
        t={t}
      />
    </div>
  );
}
