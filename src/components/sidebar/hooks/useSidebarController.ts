/**
 * PURPOSE: Drive sidebar project/session interactions while preserving the
 * backend identity each session must use for follow-up API calls.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type { TFunction } from 'i18next';
import { api } from '../../../utils/api';
import type { Project, ProjectSession } from '../../../types/app';
import type {
  AdditionalSessionsByProject,
  DeleteProjectConfirmation,
  LoadingSessionsByProject,
  ProjectSortOrder,
  SessionDeleteConfirmation,
  SessionWithProvider,
} from '../types/types';
import {
  filterProjects,
  getAllSessions,
  readProjectSortOrder,
  sortProjects,
  sortSessions,
} from '../utils/utils';

type UseSidebarControllerArgs = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  isMobile: boolean;
  t: TFunction;
  onRefresh: () => Promise<void> | void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectDelete?: (projectName: string) => void;
  setCurrentProject: (project: Project) => void;
  setSidebarVisible: (visible: boolean) => void;
  sidebarVisible: boolean;
};

export function useSidebarController({
  projects,
  selectedProject,
  selectedSession,
  isLoading,
  isMobile,
  t,
  onRefresh,
  onProjectSelect,
  onSessionSelect,
  onSessionDelete,
  onProjectDelete,
  setCurrentProject,
  setSidebarVisible,
  sidebarVisible,
}: UseSidebarControllerArgs) {
  /**
   * PURPOSE: Coordinate sidebar project/session actions and keep local UI state in sync with backend data.
   */
  /**
   * Resolve the backend project name that owns a session.
   * Worktree sessions can be rendered under the parent project, but their
   * message/rename/delete APIs still need the original Claude project folder.
   */
  const getSessionProjectName = useCallback(
    (session: ProjectSession, fallbackProjectName: string) => (
      typeof session.__projectName === 'string' && session.__projectName
        ? session.__projectName
        : fallbackProjectName
    ),
    [],
  );

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [loadingSessions, setLoadingSessions] = useState<LoadingSessionsByProject>({});
  const [additionalSessions, setAdditionalSessions] = useState<AdditionalSessionsByProject>({});
  const [initialSessionsLoaded, setInitialSessionsLoaded] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(new Date());
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [projectHasMoreOverrides, setProjectHasMoreOverrides] = useState<Record<string, boolean>>({});
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [deletingProjects, setDeletingProjects] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteProjectConfirmation | null>(null);
  const [sessionDeleteConfirmation, setSessionDeleteConfirmation] = useState<SessionDeleteConfirmation | null>(null);
  const [showVersionModal, setShowVersionModal] = useState(false);

  const isSidebarCollapsed = !isMobile && !sidebarVisible;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setAdditionalSessions({});
    setInitialSessionsLoaded(new Set());
    setProjectHasMoreOverrides({});
  }, [projects]);

  useEffect(() => {
    if (selectedProject) {
      setExpandedProjects((prev) => {
        if (prev.has(selectedProject.name)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(selectedProject.name);
        return next;
      });
    }
  }, [selectedSession?.id, selectedProject?.name]);

  useEffect(() => {
    if (projects.length > 0 && !isLoading) {
      const loadedProjects = new Set<string>();
      projects.forEach((project) => {
        if (project.sessions && project.sessions.length >= 0) {
          loadedProjects.add(project.name);
        }
      });
      setInitialSessionsLoaded(loadedProjects);
    }
  }, [projects, isLoading]);

  useEffect(() => {
    const loadSortOrder = () => {
      setProjectSortOrder(readProjectSortOrder());
    };

    loadSortOrder();

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'claude-settings') {
        loadSortOrder();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    const interval = setInterval(() => {
      if (document.hasFocus()) {
        loadSortOrder();
      }
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  const handleTouchClick = useCallback(
    (callback: () => void) =>
      (event: React.TouchEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('.overflow-y-auto') || target.closest('[data-scroll-container]')) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        callback();
      },
    [],
  );

  const toggleProject = useCallback((projectName: string) => {
    setExpandedProjects((prev) => {
      const next = new Set<string>();
      if (!prev.has(projectName)) {
        next.add(projectName);
      }
      return next;
    });
  }, []);

  const handleSessionClick = useCallback(
    (session: SessionWithProvider, projectName: string) => {
      onSessionSelect({
        ...session,
        __projectName: getSessionProjectName(session, projectName),
      });
    },
    [getSessionProjectName, onSessionSelect],
  );

  const toggleStarSession = useCallback(async (session: SessionWithProvider, projectName: string) => {
    const resolvedProjectName = getSessionProjectName(session, projectName);
    await api.updateSessionUiState(resolvedProjectName, session.id, {
      provider: session.__provider,
      favorite: session.favorite !== true,
      pending: session.pending === true,
      hidden: session.hidden === true,
    });
    await onRefresh();
  }, [getSessionProjectName, onRefresh]);

  const togglePendingSession = useCallback(async (session: SessionWithProvider, projectName: string) => {
    /**
     * Toggle the same pending flag that project overview cards expose.
     */
    const resolvedProjectName = getSessionProjectName(session, projectName);
    await api.updateSessionUiState(resolvedProjectName, session.id, {
      provider: session.__provider,
      favorite: session.favorite === true,
      pending: session.pending !== true,
      hidden: session.hidden === true,
    });
    await onRefresh();
  }, [getSessionProjectName, onRefresh]);

  const toggleHiddenSession = useCallback(async (session: SessionWithProvider, projectName: string) => {
    /**
     * Hide the session from the sidebar/project overview without deleting it.
     */
    const resolvedProjectName = getSessionProjectName(session, projectName);
    await api.updateSessionUiState(resolvedProjectName, session.id, {
      provider: session.__provider,
      favorite: session.favorite === true,
      pending: session.pending === true,
      hidden: session.hidden !== true,
    });
    await onRefresh();
  }, [getSessionProjectName, onRefresh]);

  const isSessionStarred = useCallback((session: SessionWithProvider, projectName: string) => {
    void projectName;
    return session.favorite === true;
  }, []);

  const isSessionPending = useCallback((session: SessionWithProvider, projectName: string) => {
    void projectName;
    return session.pending === true;
  }, []);

  /**
   * PURPOSE: Count every session tied to a project, including hidden ones,
   * so destructive actions stay aligned with backend delete rules.
   */
  const getProjectSessionCount = useCallback(
    (project: Project) => getAllSessions(project, additionalSessions).length,
    [additionalSessions],
  );

  const getProjectSessions = useCallback(
    (project: Project) => {
      const visibleSessions = getAllSessions(project, additionalSessions).filter((session) => session.hidden !== true);

      return sortSessions(
        visibleSessions,
        (session) => ({
          favorite: session.favorite === true,
          pending: session.pending === true,
          hidden: session.hidden === true,
        }),
        project.name,
      );
    },
    [additionalSessions],
  );

  const projectsWithSessionMeta = useMemo(
    () =>
      projects.map((project) => {
        const hasMoreOverride = projectHasMoreOverrides[project.name];
        if (hasMoreOverride === undefined) {
          return project;
        }

        return {
          ...project,
          sessionMeta: { ...project.sessionMeta, hasMore: hasMoreOverride },
        };
      }),
    [projectHasMoreOverrides, projects],
  );

  const sortedProjects = useMemo(
    () => sortProjects(projectsWithSessionMeta, projectSortOrder, additionalSessions),
    [additionalSessions, projectSortOrder, projectsWithSessionMeta],
  );

  const filteredProjects = useMemo(
    () => filterProjects(sortedProjects, searchFilter),
    [searchFilter, sortedProjects],
  );

  const startEditing = useCallback((project: Project) => {
    setEditingProject(project.name);
    setEditingName(project.displayName);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingProject(null);
    setEditingName('');
  }, []);

  const saveProjectName = useCallback(
    async (projectName: string) => {
      try {
        const matchedProject = projects.find((project) => project.name === projectName);
        const projectPath = matchedProject?.fullPath || matchedProject?.path || null;
        const response = await api.renameProject(projectName, editingName, projectPath);
        if (response.ok) {
          await onRefresh();
        } else {
          console.error('Failed to rename project');
        }
      } catch (error) {
        console.error('Error renaming project:', error);
      } finally {
        setEditingProject(null);
        setEditingName('');
      }
    },
    [editingName, onRefresh, projects],
  );

  const showDeleteSessionConfirmation = useCallback(
    (
      projectName: string,
      sessionId: string,
      sessionTitle: string,
      provider: SessionDeleteConfirmation['provider'] = 'claude',
      projectPath = '',
    ) => {
      setSessionDeleteConfirmation({ projectName, sessionId, sessionTitle, provider, projectPath });
    },
    [],
  );

  const confirmDeleteSession = useCallback(async () => {
    if (!sessionDeleteConfirmation) {
      return;
    }

    const { projectName, sessionId, provider, projectPath } = sessionDeleteConfirmation;
    setSessionDeleteConfirmation(null);

    try {
      let response;
      if (provider === 'codex') {
        response = await api.deleteCodexSession(sessionId, projectPath || '');
      } else {
        response = await api.deleteSession(projectName, sessionId);
      }

      if (response.ok) {
        onSessionDelete?.(sessionId);
        await onRefresh();
      } else {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to delete session:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.deleteSessionFailed'));
      }
    } catch (error) {
      console.error('[Sidebar] Error deleting session:', error);
      alert(t('messages.deleteSessionError'));
    }
  }, [onRefresh, onSessionDelete, sessionDeleteConfirmation, t]);

  const requestProjectDelete = useCallback(
    (project: Project) => {
      setDeleteConfirmation({
        project,
        sessionCount: getProjectSessionCount(project),
      });
    },
    [getProjectSessionCount],
  );

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteConfirmation) {
      return;
    }

    const { project } = deleteConfirmation;

    setDeleteConfirmation(null);
    setDeletingProjects((prev) => new Set([...prev, project.name]));

    try {
      const response = await api.deleteProject(project.name, true);

      if (response.ok) {
        onProjectDelete?.(project.name);
      } else {
        const error = (await response.json()) as { error?: string };
        alert(error.error || t('messages.deleteProjectFailed'));
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      alert(t('messages.deleteProjectError'));
    } finally {
      setDeletingProjects((prev) => {
        const next = new Set(prev);
        next.delete(project.name);
        return next;
      });
    }
  }, [deleteConfirmation, onProjectDelete, t]);

  const loadMoreSessions = useCallback(
    async (project: Project) => {
      const hasMoreOverride = projectHasMoreOverrides[project.name];
      const canLoadMore =
        hasMoreOverride !== undefined ? hasMoreOverride : project.sessionMeta?.hasMore === true;
      if (!canLoadMore || loadingSessions[project.name]) {
        return;
      }

      setLoadingSessions((prev) => ({ ...prev, [project.name]: true }));

      try {
        const currentSessionCount =
          (project.sessions?.length || 0) + (additionalSessions[project.name]?.length || 0);
        const response = await api.sessions(project.name, 5, currentSessionCount);

        if (!response.ok) {
          return;
        }

        const result = (await response.json()) as {
          sessions?: ProjectSession[];
          hasMore?: boolean;
        };

        setAdditionalSessions((prev) => ({
          ...prev,
          [project.name]: [...(prev[project.name] || []), ...(result.sessions || [])],
        }));

        if (result.hasMore === false) {
          // Keep hasMore state in local hook state instead of mutating the project prop object.
          setProjectHasMoreOverrides((prev) => ({ ...prev, [project.name]: false }));
        }
      } catch (error) {
        console.error('Error loading more sessions:', error);
      } finally {
        setLoadingSessions((prev) => ({ ...prev, [project.name]: false }));
      }
    },
    [additionalSessions, loadingSessions, projectHasMoreOverrides],
  );

  const handleProjectSelect = useCallback(
    (project: Project) => {
      onProjectSelect(project);
      setCurrentProject(project);
    },
    [onProjectSelect, setCurrentProject],
  );

  const refreshProjects = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  const updateSessionSummary = useCallback(
    async (projectName: string, sessionId: string, summary: string) => {
      const trimmedSummary = summary.trim();
      if (!trimmedSummary) {
        return;
      }

      try {
        const matchedSession = projects
          .flatMap((project) => getAllSessions(project, additionalSessions))
          .find((session) => session.id === sessionId);
        const matchedProject = projects.find((project) => project.name === projectName);
        const sessionProjectPath = matchedSession?.projectPath || matchedProject?.fullPath || matchedProject?.path || '';
        const response = matchedSession?.__provider === 'codex'
          ? await api.renameCodexSession(sessionId, trimmedSummary, sessionProjectPath)
          : await api.renameSession(projectName, sessionId, trimmedSummary, sessionProjectPath);

        if (response.ok) {
          await onRefresh();
          setEditingSession(null);
          setEditingSessionName('');
          return;
        }

        console.error('[Sidebar] Failed to rename session:', {
          projectName,
          sessionId,
          status: response.status,
        });
      } catch (error) {
        console.error('[Sidebar] Error renaming session:', error);
      }
    },
    [additionalSessions, onRefresh, projects],
  );

  const collapseSidebar = useCallback(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  const expandSidebar = useCallback(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  return {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    loadingSessions,
    additionalSessions,
    initialSessionsLoaded,
    currentTime,
    projectSortOrder,
    isRefreshing,
    editingSession,
    editingSessionName,
    searchFilter,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    filteredProjects,
    handleTouchClick,
    toggleProject,
    handleSessionClick,
    toggleStarSession,
    togglePendingSession,
    toggleHiddenSession,
    isSessionStarred,
    isSessionPending,
    getProjectSessions,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    loadMoreSessions,
    handleProjectSelect,
    refreshProjects,
    updateSessionSummary,
    collapseSidebar,
    expandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  };
}
