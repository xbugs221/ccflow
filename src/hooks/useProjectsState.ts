/**
 * Project and session selection state.
 * Keeps the sidebar model synchronized with API data and ordered WebSocket update events.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { SocketMessageEnvelope } from '../contexts/WebSocketContext';
import {
  getMessageHistoryTailSequence,
  getPendingSocketMessages,
  reduceProjectsUpdatedMessages,
} from '../../shared/socket-message-utils.js';
import { api } from '../utils/api';
import {
  buildProjectRoute,
  buildProjectSessionRoute,
  buildProjectWorkflowRoute,
  buildWorkflowChildSessionRoute,
  getProjectRoutePath,
  parseIndexedRouteSegment,
} from '../utils/projectRoute';
import {
  createWorkflowAutoStartDraft,
  type NewSessionOptions,
} from '../utils/workflowAutoStart';
import type {
  AppSocketMessage,
  AppTab,
  LoadingProgress,
  Project,
  ProjectSession,
  ProjectWorkflow,
  ProjectsUpdatedMessage,
} from '../types/app';

type UseProjectsStateArgs = {
  locationPathname: string;
  locationSearch?: string;
  navigate: NavigateFunction;
  messageHistory: SocketMessageEnvelope[];
  isMobile: boolean;
  activeSessions: Set<string>;
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);
const isTemporarySessionId = (sessionId: string | null | undefined): boolean =>
  Boolean(sessionId && (sessionId.startsWith('new-session-') || /^c\d+$/.test(sessionId)));
const normalizeComparablePath = (value: string | null | undefined): string =>
  String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '');

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.workflows) !== serialize(prevProject.workflows) ||
      serialize(nextProject.hasUnreadActivity) !== serialize(prevProject.hasUnreadActivity) ||
      serialize(nextProject.taskmaster) !== serialize(prevProject.taskmaster);

    if (baseChanged) {
      return true;
    }

    if (!includeExternalSessions) {
      return false;
    }

    return (
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  const visibleSessions = [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
  ];

  return visibleSessions.filter((session) => {
    return !(
      session.hidden === true ||
      session.archived === true ||
      session.status === 'archived' ||
      session.status === 'hidden'
    );
  });
};

/**
 * PURPOSE: Resolve the freshest workflow snapshot available for child-session
 * navigation so newly created workflows do not fall back to plain `/cN` routes.
 */
const findWorkflowById = (
  project: Project | null | undefined,
  workflowId: string | undefined,
): ProjectWorkflow | null => {
  if (!project || !workflowId) {
    return null;
  }

  return (project.workflows || []).find((workflow) => workflow.id === workflowId) || null;
};

/**
 * PURPOSE: Resolve the refreshed session that should replace one selected session.
 * Manual drafts may be finalized into a real provider session before the next
 * sidebar refresh sees the new history file, so we reconcile by pending id and
 * then by stable route index within the same provider bucket.
 */
const findRefreshedSelectedSession = (
  project: Project,
  selectedSession: ProjectSession,
  pendingSessionId: string | null,
): ProjectSession | null => {
  const visibleSessions = getProjectSessions(project);
  const exactSession = visibleSessions.find((session) => session.id === selectedSession.id) || null;
  if (exactSession) {
    return exactSession;
  }

  const pendingSession = pendingSessionId
    ? visibleSessions.find((session) => session.id === pendingSessionId) || null
    : null;
  if (pendingSession) {
    return pendingSession;
  }

  if (!isTemporarySessionId(String(selectedSession.id || ''))) {
    return null;
  }

  const providerSessions = selectedSession.__provider === 'codex'
    ? (project.codexSessions || [])
    : (project.sessions || []);

  return providerSessions.find((session) => (
    session.routeIndex === selectedSession.routeIndex
  )) || null;
};

const isWorkflowChildSession = (project: Project, sessionId: string): boolean => {
  return (project.workflows || []).some((workflow) => (
    (workflow.childSessions || []).some((session) => session.id === sessionId)
  ));
};

const hasPlanningChildSession = (workflow: ProjectWorkflow | null): boolean => {
  /**
   * PURPOSE: Detect whether the workflow detail already has a routable planning
   * session, including normalized legacy chat entries.
   */
  return Boolean((workflow?.childSessions || []).some((session) => (
    session.stageKey === 'planning'
    || session.substageKey === 'planning'
    || session.substageKey === 'planner_output'
  )));
};

const shouldPollWorkflowPlanningSession = (workflow: ProjectWorkflow | null): boolean => {
  /**
   * PURPOSE: Keep newly-created workflow details fresh only while the planning
   * child session is expected but not yet visible in the local read model.
   */
  if (!workflow || hasPlanningChildSession(workflow)) {
    return false;
  }

  const planningStatus = (workflow.stageStatuses || []).find((stage) => stage.key === 'planning')?.status;
  return workflow.stage === 'planning' || planningStatus === 'active' || planningStatus === 'ready';
};

type ResolvedRouteSelection = {
  project: Project | null;
  workflow: ProjectWorkflow | null;
  session: ProjectSession | null;
};

const normalizePathname = (pathname: string): string => {
  if (!pathname || pathname === '/') {
    return '/';
  }
  return pathname.replace(/\/+$/g, '') || '/';
};

const resolveRouteSelection = (
  projects: Project[],
  pathname: string,
): ResolvedRouteSelection => {
  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname === '/') {
    return { project: null, workflow: null, session: null };
  }

  const legacySessionMatch = normalizedPathname.match(/^\/session\/([^/]+)$/);
  if (legacySessionMatch) {
    const legacySessionId = decodeURIComponent(legacySessionMatch[1]);
    for (const project of projects) {
      const session = getProjectSessions(project).find((entry) => entry.id === legacySessionId) || null;
      if (session) {
        return { project, workflow: null, session };
      }
    }
    if (legacySessionId.startsWith('codex-') && projects[0]) {
      return {
        project: projects[0],
        workflow: null,
        session: {
          id: legacySessionId,
          summary: 'Codex Session',
          provider: 'codex',
          __provider: 'codex',
        } as ProjectSession,
      };
    }
  }

  const matchedProject = [...projects]
    .sort((left, right) => getProjectRoutePath(right).length - getProjectRoutePath(left).length)
    .find((project) => {
      const projectRoute = getProjectRoutePath(project);
      return normalizedPathname === projectRoute || normalizedPathname.startsWith(`${projectRoute}/`);
    }) || null;

  if (!matchedProject) {
    return { project: null, workflow: null, session: null };
  }

  const projectRoute = getProjectRoutePath(matchedProject);
  const remainder = normalizedPathname.slice(projectRoute.length).replace(/^\/+/g, '');
  if (!remainder) {
    return { project: matchedProject, workflow: null, session: null };
  }

  const routeSegments = remainder.split('/').filter(Boolean);
  const workflowRouteIndex = parseIndexedRouteSegment(routeSegments[0], 'w');
  const sessionRouteIndex = parseIndexedRouteSegment(routeSegments[0], 'c');

  if (workflowRouteIndex && routeSegments.length === 1) {
    const workflow = (matchedProject.workflows || []).find((entry) => entry.routeIndex === workflowRouteIndex) || null;
    return { project: matchedProject, workflow, session: null };
  }

  if (sessionRouteIndex && routeSegments.length === 1) {
    const session = getProjectSessions(matchedProject).find((entry) => (
      entry.routeIndex === sessionRouteIndex && !isWorkflowChildSession(matchedProject, entry.id)
    )) || null;
    return { project: matchedProject, workflow: null, session };
  }

  if (workflowRouteIndex && routeSegments.length === 2) {
    const workflow = (matchedProject.workflows || []).find((entry) => entry.routeIndex === workflowRouteIndex) || null;
    const childRouteIndex = parseIndexedRouteSegment(routeSegments[1], 'c');
    if (!workflow || !childRouteIndex) {
      return { project: matchedProject, workflow: null, session: null };
    }

    const childSession = (workflow.childSessions || []).find((entry) => entry.routeIndex === childRouteIndex) || null;
    const projectSession = getProjectSessions(matchedProject).find((entry) => (
      entry.id === childSession?.id
      || (entry.workflowId === workflow.id && entry.routeIndex === childRouteIndex)
    )) || null;
    const session = (childSession || projectSession)
      ? (() => {
          const sessionProvider: 'claude' | 'codex' = (
            childSession?.provider === 'codex'
            || projectSession?.__provider === 'codex'
            || (matchedProject.codexSessions || []).some((entry) => entry.id === (childSession?.id || projectSession?.id))
          )
            ? 'codex'
            : 'claude';
          const baseSession = projectSession || {
            id: childSession?.id || `${workflow.id}-c${childRouteIndex}`,
            title: childSession?.title,
            summary: childSession?.summary,
            routeIndex: childSession?.routeIndex,
          };
          return {
            ...baseSession,
            routeIndex: childSession?.routeIndex || projectSession?.routeIndex,
            workflowId: childSession?.workflowId || projectSession?.workflowId || workflow.id,
            projectPath: childSession?.projectPath || projectSession?.projectPath || matchedProject.fullPath || matchedProject.path,
            stageKey: childSession?.stageKey || projectSession?.stageKey,
            substageKey: childSession?.substageKey || projectSession?.substageKey,
            reviewPassIndex: childSession?.reviewPassIndex || projectSession?.reviewPassIndex,
            __provider: sessionProvider,
            __projectName: matchedProject.name,
          };
        })()
      : null;
    return { project: matchedProject, workflow: null, session };
  }

  return { project: matchedProject, workflow: null, session: null };
};

const getDirectSessionRouteIndex = (
  project: Project | null,
  pathname: string,
): number | null => {
  /**
   * PURPOSE: Extract the stable `/cN` route segment for a project-level manual
   * session even when the refreshed sidebar payload has not indexed that session.
   */
  if (!project) {
    return null;
  }

  const normalizedPathname = normalizePathname(pathname);
  const projectRoute = getProjectRoutePath(project);
  if (!normalizedPathname.startsWith(`${projectRoute}/`)) {
    return null;
  }

  const remainder = normalizedPathname.slice(projectRoute.length).replace(/^\/+/g, '');
  const routeSegments = remainder.split('/').filter(Boolean);
  if (routeSegments.length !== 1) {
    return null;
  }

  return parseIndexedRouteSegment(routeSegments[0], 'c');
};

/**
 * Choose the next default manual session label from the persisted high-water counter.
 */
const getNextManualSessionLabel = (project: Project): string => {
  const persistedNextRouteIndex = Number(project.manualSessionNextRouteIndex);
  const nextRouteIndex = Number.isInteger(persistedNextRouteIndex) && persistedNextRouteIndex > 0
    ? persistedNextRouteIndex
    : getProjectSessions(project).length + 1;

  return `会话${nextRouteIndex}`;
};

/**
 * Preserve the backend project owner for merged worktree sessions.
 */
const withSessionProjectMetadata = (
  session: ProjectSession,
  project: Pick<Project, 'name' | 'fullPath' | 'path'>,
  provider: 'claude' | 'codex',
): ProjectSession => ({
  ...session,
  __provider: session.__provider || provider,
  projectPath:
    typeof session.projectPath === 'string' && session.projectPath
      ? session.projectPath
      : (project.fullPath || project.path || ''),
  __projectName:
    typeof session.__projectName === 'string' && session.__projectName
      ? session.__projectName
      : project.name,
});

/**
 * PURPOSE: Show a freshly created manual session in the sidebar immediately
 * instead of waiting for the next backend refresh cycle.
 */
const insertSessionIntoProject = (
  project: Project,
  session: ProjectSession,
  provider: 'claude' | 'codex',
): Project => {
  const targetKey = provider === 'codex' ? 'codexSessions' : 'sessions';
  const currentSessions = Array.isArray(project[targetKey]) ? project[targetKey] : [];
  const withoutDuplicate = currentSessions.filter((entry) => entry.id !== session.id);
  const nextSessions = [session, ...withoutDuplicate];
  const currentTotal = Number(project.sessionMeta?.total || 0);

  return {
    ...project,
    [targetKey]: nextSessions,
    sessionMeta: {
      ...project.sessionMeta,
      total: Math.max(currentTotal, getProjectSessions(project).length + 1),
    },
  };
};

const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) {
    return true;
  }

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);

  if (!currentSelectedProject || !updatedSelectedProject) {
    return false;
  }

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );

  if (!currentSelectedSession || !updatedSelectedSession) {
    return false;
  }

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};

const VALID_TABS: Set<string> = new Set(['chat', 'files', 'shell', 'git', 'tasks', 'preview']);

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored === 'workflows') {
      return 'chat';
    }
    if (stored && VALID_TABS.has(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  locationPathname,
  locationSearch = '',
  navigate,
  messageHistory,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<ProjectWorkflow | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);

  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('appearance');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWorkflowRefreshKeyRef = useRef<string | null>(null);
  const finalizedManualDraftsRef = useRef<Set<string>>(new Set());
  /**
   * Initialize at the current tail so remounting the app shell does not replay stale socket events.
   */
  const lastProcessedMessageSequenceRef = useRef(
    getMessageHistoryTailSequence(messageHistory),
  );

  const fetchProjects = useCallback(async () => {
    try {
      setIsLoadingProjects(true);
      const response = await api.projects();
      const projectData = (await response.json()) as Project[];

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return projectData;
        }

        return projectsHaveChanges(prevProjects, projectData, true)
          ? projectData
          : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  /**
   * Open settings on the requested tab, defaulting normal entry points to appearance.
   */
  const openSettings = useCallback((tab = 'appearance') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Auto-select the project when there is only one, so the user lands on the new session page
  useEffect(() => {
    if (!isLoadingProjects && projects.length === 1 && !selectedProject && locationPathname === '/') {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, locationPathname, projects, selectedProject]);

  useEffect(() => {
    const pendingMessages = getPendingSocketMessages(messageHistory, lastProcessedMessageSequenceRef.current);
    if (pendingMessages.length === 0) {
      return;
    }

    for (const entry of pendingMessages) {
      lastProcessedMessageSequenceRef.current = entry.sequence;
      const latestMessage = entry.message as AppSocketMessage | null;
      if (!latestMessage) {
        continue;
      }

      if (latestMessage.type === 'loading_progress') {
        if (loadingProgressTimeoutRef.current) {
          clearTimeout(loadingProgressTimeoutRef.current);
          loadingProgressTimeoutRef.current = null;
        }

        setLoadingProgress(latestMessage as LoadingProgress);

        if (latestMessage.phase === 'complete') {
          loadingProgressTimeoutRef.current = setTimeout(() => {
            setLoadingProgress(null);
            loadingProgressTimeoutRef.current = null;
          }, 500);
        }
        continue;
      }

      if (latestMessage.type !== 'projects_updated') {
        continue;
      }
    }

    const projectMessages = pendingMessages
      .map((entry) => entry.message as ProjectsUpdatedMessage | null)
      .filter((message): message is ProjectsUpdatedMessage => Boolean(message && message.type === 'projects_updated'));

    if (projectMessages.length === 0) {
      return;
    }

    const reducedState = reduceProjectsUpdatedMessages({
      messages: projectMessages,
      projects,
      selectedProject,
      selectedSession,
      activeSessions,
      getProjectSessions: getProjectSessions as unknown as (project: Record<string, unknown>) => Array<Record<string, unknown>>,
      isUpdateAdditive: isUpdateAdditive as (
        currentProjects: Array<Record<string, unknown>>,
        updatedProjects: Array<Record<string, unknown>>,
        selectedProject: Record<string, unknown> | null,
        selectedSession: Record<string, unknown> | null,
      ) => boolean,
    }) as {
      projects: Project[];
      selectedProject: Project | null;
      selectedSession: ProjectSession | null;
      externalMessageUpdateCount: number;
    };

    if (reducedState.externalMessageUpdateCount > 0) {
      setExternalMessageUpdate((previous) => previous + reducedState.externalMessageUpdateCount);
    }

    if (serialize(reducedState.projects) !== serialize(projects)) {
      setProjects(reducedState.projects);
    }

    if (serialize(reducedState.selectedProject) !== serialize(selectedProject)) {
      setSelectedProject(reducedState.selectedProject);
    }

    if (serialize(reducedState.selectedSession) !== serialize(selectedSession)) {
      setSelectedSession(reducedState.selectedSession);
    }
  }, [messageHistory, selectedProject, selectedSession, activeSessions, projects]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const legacySessionMatch = normalizePathname(locationPathname).match(/^\/session\/([^/]+)$/);
    if (legacySessionMatch) {
      const searchParams = new URLSearchParams(locationSearch);
      const hintedProjectPath = searchParams.get('projectPath') || '';
      const hintedProvider = searchParams.get('provider') === 'codex' ? 'codex' : 'claude';
      const decodedSessionId = decodeURIComponent(legacySessionMatch[1]);
      const matchedProject = projects.find((project) => (
        normalizeComparablePath(project.fullPath || project.path || '') === normalizeComparablePath(hintedProjectPath)
      )) || null;

      if (matchedProject && decodedSessionId) {
        const existingSession = getProjectSessions(matchedProject).find(
          (entry) => entry.id === decodedSessionId && (entry.__provider || hintedProvider) === hintedProvider,
        );
        const fallbackSession = {
          id: decodedSessionId,
          title: decodedSessionId,
          summary: decodedSessionId,
          routeIndex: existingSession?.routeIndex,
        } as ProjectSession;
        const nextSession = withSessionProjectMetadata(
          existingSession || fallbackSession,
          matchedProject,
          hintedProvider,
        );

        if (serialize(selectedProject) !== serialize(matchedProject)) {
          setSelectedProject(matchedProject);
        }
        if (
          selectedSession?.id !== nextSession.id
          || selectedSession?.__provider !== nextSession.__provider
          || selectedSession?.__projectName !== nextSession.__projectName
        ) {
          setSelectedSession(nextSession);
        }
        if (selectedWorkflow) {
          setSelectedWorkflow(null);
        }
      }
      return;
    }

    const resolvedSelection = resolveRouteSelection(projects, locationPathname);
    const resolvedProject = resolvedSelection.project;
    const resolvedWorkflow = resolvedSelection.workflow;
    const resolvedSession = resolvedSelection.session;

    if (!resolvedProject) {
      if (normalizePathname(locationPathname) === '/') {
        if (selectedWorkflow) {
          setSelectedWorkflow(null);
        }
        if (selectedSession) {
          setSelectedSession(null);
        }
      }
      return;
    }

    if (serialize(selectedProject) !== serialize(resolvedProject)) {
      setSelectedProject(resolvedProject);
    }

    if (resolvedWorkflow) {
      if (serialize(selectedWorkflow) !== serialize(resolvedWorkflow)) {
        setSelectedWorkflow(resolvedWorkflow);
      }
      if (selectedSession) {
        setSelectedSession(null);
      }
      return;
    }

    if (resolvedSession) {
      const provider = resolvedSession.__provider || ((resolvedProject.codexSessions || []).some(
        (session) => session.id === resolvedSession.id,
      ) ? 'codex' : 'claude');
      const nextSession = withSessionProjectMetadata(resolvedSession, resolvedProject, provider);
      if (
        selectedSession?.id !== nextSession.id
        || selectedSession?.routeIndex !== nextSession.routeIndex
        || selectedSession?.__provider !== nextSession.__provider
        || selectedSession?.__projectName !== nextSession.__projectName
      ) {
        setSelectedSession(nextSession);
      }
      if (selectedWorkflow) {
        setSelectedWorkflow(null);
      }
      return;
    }

    const directSessionRouteIndex = getDirectSessionRouteIndex(resolvedProject, locationPathname);
    if (
      selectedSession
      && directSessionRouteIndex
      && selectedSession.routeIndex === directSessionRouteIndex
      && selectedSession.__projectName === resolvedProject.name
    ) {
      if (selectedWorkflow) {
        setSelectedWorkflow(null);
      }
      return;
    }

    if (selectedSession) {
      setSelectedSession(null);
    }
    if (selectedWorkflow) {
      setSelectedWorkflow(null);
    }
  }, [locationPathname, locationSearch, projects, selectedProject, selectedSession, selectedWorkflow]);

  useEffect(() => {
    /**
     * A hard refresh can preserve an old pending session id from a previous
     * draft handoff. Once the current route resolves to a concrete session,
     * that stale value must not be allowed to redirect the next message turn.
     */
    if (typeof window === 'undefined') {
      return;
    }

    if (!selectedSession?.id || isTemporarySessionId(selectedSession.id)) {
      return;
    }

    const pendingSessionId = window.sessionStorage.getItem('pendingSessionId');
    if (pendingSessionId && pendingSessionId !== selectedSession.id) {
      window.sessionStorage.removeItem('pendingSessionId');
    }
  }, [selectedSession?.id]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setSelectedWorkflow(null);
      setActiveTab('chat');
      navigate(buildProjectRoute(project));

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      setSelectedSession(session);
      setSelectedWorkflow(null);

      if (activeTab === 'tasks' || activeTab === 'preview') {
        setActiveTab('chat');
      }

      if (isMobile) {
        const sessionProjectName = session.__projectName;
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      const sessionProjectName = session.__projectName || selectedProject?.name || '';
      const sessionProjectPath = session.projectPath || selectedProject?.fullPath || selectedProject?.path || '';
      const sessionProject = {
        fullPath: sessionProjectPath,
        path: sessionProjectPath,
        name: sessionProjectName,
        routePath: selectedProject?.routePath,
      };
      navigate(
        buildProjectSessionRoute(sessionProject, session),
      );
    },
    [activeTab, isMobile, navigate, selectedProject?.fullPath, selectedProject?.name, selectedProject?.path, selectedProject?.routePath],
  );

  const handleNewSession = useCallback(
    async (project: Project, provider: 'claude' | 'codex' = 'codex', options: NewSessionOptions = {}) => {
      const isManualSessionDraft = !options.workflowId && !options.autoPrompt;
      const defaultSessionLabel = getNextManualSessionLabel(project);
      let sessionSummary = typeof options.sessionSummary === 'string' ? options.sessionSummary.trim() : '';

      if (!sessionSummary && isManualSessionDraft && typeof window !== 'undefined') {
        const requestedLabel = window.prompt('请输入会话名称', defaultSessionLabel);
        if (requestedLabel === null) {
          return;
        }
        sessionSummary = requestedLabel.trim() || defaultSessionLabel;
      }

      if (!sessionSummary) {
        sessionSummary = isManualSessionDraft ? defaultSessionLabel : '新会话';
      }

      let draftSession: ProjectSession = {
        id: `new-session-${Date.now()}`,
        routeIndex: undefined,
      };
      if (isManualSessionDraft) {
        try {
          const response = await api.createManualSessionDraft(project.name, {
            provider,
            label: sessionSummary,
            projectPath: project.fullPath || project.path || '',
          });
          const payload = response.ok ? await response.json() : null;
          const createdSession = payload?.session;
          if (typeof createdSession?.id !== 'string' || !createdSession.id) {
            throw new Error('Manual session draft did not return a valid id');
          }
          draftSession = createdSession;
        } catch (error) {
          console.error('Error creating manual session draft:', error);
          return;
        }
      } else if (options.workflowId) {
        try {
          draftSession = await createWorkflowAutoStartDraft(project, provider, options);
        } catch (error) {
          console.error('Error creating workflow draft session:', error);
          return;
        }
      }

      let navigationProject = project;
      let targetWorkflow = findWorkflowById(project, options.workflowId);
      if (options.workflowId && !targetWorkflow) {
        const knownProject = projects.find((entry) => entry.name === project.name) || null;
        const knownWorkflow = findWorkflowById(knownProject, options.workflowId);
        if (knownProject && knownWorkflow) {
          navigationProject = knownProject;
          targetWorkflow = knownWorkflow;
        } else {
          try {
            const response = await api.projects();
            if (response.ok) {
              const freshProjects = (await response.json()) as Project[];
              const freshProject = freshProjects.find((entry) => entry.name === project.name) || null;
              const freshWorkflow = findWorkflowById(freshProject, options.workflowId);
              if (freshProject && freshWorkflow) {
                navigationProject = freshProject;
                targetWorkflow = freshWorkflow;
                setProjects((prevProjects) => (
                  projectsHaveChanges(prevProjects, freshProjects, true) ? freshProjects : prevProjects
                ));
              }
            }
          } catch (error) {
            console.error('Error refreshing workflow route target:', error);
          }
        }
      }

      const syntheticSession = withSessionProjectMetadata(
        {
          id: draftSession.id,
          routeIndex: draftSession.routeIndex,
          label: sessionSummary,
          title: sessionSummary,
          summary: sessionSummary,
          workflowId: draftSession.workflowId || options.workflowId,
          stageKey: draftSession.stageKey || options.workflowStageKey,
          substageKey: draftSession.substageKey || options.workflowSubstageKey,
          reviewPassIndex: draftSession.reviewPassIndex || options.workflowReviewPass,
          projectPath: draftSession.projectPath || navigationProject.fullPath || navigationProject.path || '',
        },
        navigationProject,
        provider,
      );
      const nextManualSessionRouteIndex = isManualSessionDraft && Number.isInteger(Number(draftSession.routeIndex))
        ? Number(draftSession.routeIndex) + 1
        : navigationProject.manualSessionNextRouteIndex;
      const projectWithSyntheticSession = {
        ...insertSessionIntoProject(navigationProject, syntheticSession, provider),
        manualSessionNextRouteIndex: nextManualSessionRouteIndex,
      };

      setProjects((prevProjects) => prevProjects.map((entry) => (
        entry.name === navigationProject.name
          ? {
            ...insertSessionIntoProject(entry, syntheticSession, provider),
            manualSessionNextRouteIndex: nextManualSessionRouteIndex,
          }
          : entry
      )));
      setSelectedProject(projectWithSyntheticSession);
      setSelectedSession(syntheticSession);
      setSelectedWorkflow(null);
      setActiveTab('chat');
      if (options.autoPrompt && typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          `workflow-autostart:${draftSession.id}`,
          JSON.stringify({
            prompt: options.autoPrompt,
            stageKey: options.workflowStageKey,
            substageKey: options.workflowSubstageKey,
            reviewPass: options.workflowReviewPass,
            repairPass: options.workflowRepairPass,
            reviewProfile: options.workflowReviewProfile,
          }),
        );
      }
      navigate(
        targetWorkflow
          ? buildWorkflowChildSessionRoute(projectWithSyntheticSession, targetWorkflow, syntheticSession)
          : buildProjectSessionRoute(projectWithSyntheticSession, syntheticSession),
        {
          state: options.autoPrompt
            ? {
                workflowAutoPrompt: options.autoPrompt,
                workflowStageKey: options.workflowStageKey,
                workflowSubstageKey: options.workflowSubstageKey,
                workflowReviewPass: options.workflowReviewPass,
                workflowRepairPass: options.workflowRepairPass,
                workflowReviewProfile: options.workflowReviewProfile,
              }
            : undefined,
        },
      );

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate, projects],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        setSelectedWorkflow(null);
        navigate(selectedProject ? buildProjectRoute(selectedProject) : '/');
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          sessions: project.sessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          codexSessions: project.codexSessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );
    },
    [navigate, selectedProject, selectedSession?.id],
  );

  const handleWorkflowSelect = useCallback(
    (project: Project, workflow: ProjectWorkflow) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setSelectedWorkflow(workflow);
      setActiveTab('chat');
      navigate(buildProjectWorkflowRoute(project, workflow));

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const response = await api.projects();
      const freshProjects = (await response.json()) as Project[];

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, freshProjects, true) ? freshProjects : prevProjects,
      );

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        if (selectedWorkflow) {
          const refreshedWorkflow =
            refreshedProject.workflows?.find((workflow) => workflow.id === selectedWorkflow.id) || null;

          if (serialize(refreshedWorkflow) !== serialize(selectedWorkflow)) {
            setSelectedWorkflow(refreshedWorkflow);
          }
        }
        return;
      }

      const pendingSessionId = typeof window !== 'undefined'
        ? window.sessionStorage.getItem('pendingSessionId')
        : null;
      const refreshedSession = findRefreshedSelectedSession(
        refreshedProject,
        selectedSession,
        pendingSessionId,
      );

      if (refreshedSession) {
        const normalizedRefreshedSession = withSessionProjectMetadata(
          refreshedSession,
          refreshedProject,
          selectedSession.__provider || 'claude',
        );

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [selectedProject, selectedSession, selectedWorkflow]);

  useEffect(() => {
    if (!selectedProject || !selectedSession?.id || !isTemporarySessionId(selectedSession.id)) {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const pendingSessionId = window.sessionStorage.getItem('pendingSessionId');
    if (!pendingSessionId || isTemporarySessionId(pendingSessionId)) {
      return;
    }
    const pendingDraftSessionId = window.sessionStorage.getItem('pendingDraftSessionId');
    if (pendingDraftSessionId !== selectedSession.id) {
      return;
    }

    const latestSessionCreatedMessage = [...messageHistory]
      .reverse()
      .find((entry) => {
        if (entry.message?.type !== 'session-created' || entry.message?.sessionId !== pendingSessionId) {
          return false;
        }
        const pendingClientRequestId = window.sessionStorage.getItem('pendingSessionClientRequestId');
        return !pendingClientRequestId || entry.message?.clientRequestId === pendingClientRequestId;
      });
    if (!latestSessionCreatedMessage) {
      return;
    }

    const provider = selectedSession.__provider === 'codex' ? 'codex' : 'claude';
    const finalizeKey = `${selectedProject.name}:${selectedSession.id}:${pendingSessionId}:${provider}`;
    if (finalizedManualDraftsRef.current.has(finalizeKey)) {
      return;
    }

    finalizedManualDraftsRef.current.add(finalizeKey);
    void (async () => {
      try {
        const response = await api.finalizeManualSessionDraft(selectedProject.name, selectedSession.id, {
          actualSessionId: pendingSessionId,
          provider,
          projectPath: selectedProject.fullPath || selectedProject.path || '',
        });
        if (!response.ok) {
          throw new Error(`Finalize draft failed with status ${response.status}`);
        }
        const optimisticSession = withSessionProjectMetadata(
          {
            ...selectedSession,
            id: pendingSessionId,
            status: 'pending',
          },
          selectedProject,
          provider,
        );
        setSelectedSession(optimisticSession);
        window.sessionStorage.removeItem('pendingDraftSessionId');
        window.sessionStorage.removeItem('pendingSessionClientRequestId');
        setProjects((prevProjects) => prevProjects.map((project) => {
          if (project.name !== selectedProject.name) {
            return project;
          }

          const targetKey = provider === 'codex' ? 'codexSessions' : 'sessions';
          const currentSessions = Array.isArray(project[targetKey]) ? project[targetKey] : [];
          let replaced = false;
          const nextSessions = currentSessions.map((session) => {
            if (session.id !== selectedSession.id) {
              return session;
            }
            replaced = true;
            return {
              ...session,
              ...optimisticSession,
            };
          });

          return {
            ...project,
            [targetKey]: replaced ? nextSessions : [optimisticSession, ...nextSessions],
          };
        }));
        await handleSidebarRefresh();
      } catch (error) {
        finalizedManualDraftsRef.current.delete(finalizeKey);
        console.error('Error finalizing manual session draft:', error);
      }
    })();
  }, [handleSidebarRefresh, messageHistory, selectedProject, selectedSession]);

  useEffect(() => {
    /**
     * Workflow details can stay on an in-memory snapshot while the backend read
     * model changes underneath, so re-fetch once whenever a concrete workflow
     * route becomes active.
     */
    if (!selectedWorkflow?.id || !selectedProject || selectedSession) {
      lastWorkflowRefreshKeyRef.current = null;
      return;
    }

    const refreshKey = `${selectedProject.name}:${selectedWorkflow.id}`;
    if (lastWorkflowRefreshKeyRef.current === refreshKey) {
      return;
    }

    lastWorkflowRefreshKeyRef.current = refreshKey;
    void handleSidebarRefresh();
  }, [handleSidebarRefresh, selectedProject, selectedSession, selectedWorkflow?.id]);

  useEffect(() => {
    if (
      !selectedProject
      || selectedSession
      || !selectedWorkflow?.id
      || !shouldPollWorkflowPlanningSession(selectedWorkflow)
    ) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void handleSidebarRefresh();
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    handleSidebarRefresh,
    selectedProject,
    selectedSession,
    selectedWorkflow,
  ]);

  const handleWorkflowMarkRead = useCallback(
    async (projectName: string, workflowId: string) => {
      try {
        const response = await api.markProjectWorkflowRead(projectName, workflowId);
        if (!response.ok) {
          return;
        }

        await handleSidebarRefresh();
      } catch (error) {
        console.error('Error marking workflow as read:', error);
      }
    },
    [handleSidebarRefresh],
  );

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        setSelectedWorkflow(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      selectedWorkflow,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onWorkflowSelect: handleWorkflowSelect,
      onWorkflowMarkRead: handleWorkflowMarkRead,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      handleNewSession,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleSidebarRefresh,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      projects,
      settingsInitialTab,
      selectedProject,
      selectedSession,
      selectedWorkflow,
      showSettings,
    ],
  );

  return {
    projects,
    selectedProject,
    selectedSession,
    selectedWorkflow,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleWorkflowSelect,
    handleNewSession,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
    handleWorkflowMarkRead,
  };
}
