// PURPOSE: Provide sidebar project/session formatting, filtering, and stable ordering helpers.
import type { TFunction } from 'i18next';
import type { Project } from '../../../types/app';
import type {
  AdditionalSessionsByProject,
  ProjectSortOrder,
  SettingsProject,
  SessionViewModel,
  SessionWithProvider,
} from '../types/types';

type SessionUiState = {
  favorite?: boolean;
  pending?: boolean;
  hidden?: boolean;
};

export type SessionCardSortMode = 'created' | 'updated' | 'title' | 'provider';

export const readProjectSortOrder = (): ProjectSortOrder => {
  try {
    const rawSettings = localStorage.getItem('claude-settings');
    if (!rawSettings) {
      return 'name';
    }

    const settings = JSON.parse(rawSettings) as { projectSortOrder?: ProjectSortOrder };
    return settings.projectSortOrder === 'date' ? 'date' : 'name';
  } catch {
    return 'name';
  }
};

export const getSessionDate = (session: SessionWithProvider): Date => {
  return new Date(getSessionActivityTime(session) || 0);
};

/**
 * Read the timestamp that represents visible session activity.
 */
const getSessionActivityTime = (session: SessionWithProvider): string => (
  String(session.lastActivity || session.updated_at || session.createdAt || session.created_at || '')
);

/**
 * Read the immutable creation route number used to keep manual sessions stable.
 */
const getSessionRouteIndex = (session: SessionWithProvider): number | null => {
  const routeIndex = Number(session.routeIndex);
  if (Number.isInteger(routeIndex) && routeIndex > 0) {
    return routeIndex;
  }

  const idMatch = String(session.id || '').match(/^c(\d+)$/);
  if (!idMatch) {
    return null;
  }

  const idRouteIndex = Number.parseInt(idMatch[1], 10);
  return Number.isInteger(idRouteIndex) && idRouteIndex > 0 ? idRouteIndex : null;
};

/**
 * Use creation time only as a fallback for old sessions that predate route indexes.
 */
const getSessionCreatedTime = (session: SessionWithProvider): number => (
  new Date(session.createdAt || session.created_at || 0).getTime()
);

/**
 * Compare two numbers while keeping invalid timestamps at the end.
 */
const compareDescendingNumber = (left: number, right: number): number => {
  const safeLeft = Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY;
  const safeRight = Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY;
  return safeRight - safeLeft;
};

/**
 * Sort manual sessions by fixed creation number, newest first.
 */
export const compareSessionsByCreationNumber = (
  sessionA: SessionWithProvider,
  sessionB: SessionWithProvider,
): number => {
  const routeIndexA = getSessionRouteIndex(sessionA);
  const routeIndexB = getSessionRouteIndex(sessionB);

  if (routeIndexA !== null || routeIndexB !== null) {
    return (routeIndexB ?? Number.NEGATIVE_INFINITY) - (routeIndexA ?? Number.NEGATIVE_INFINITY);
  }

  return getSessionCreatedTime(sessionB) - getSessionCreatedTime(sessionA);
};

/**
 * Sort session cards by the selected business field without changing route ids.
 */
export const compareSessionsByCardSortMode = (
  sessionA: SessionWithProvider,
  sessionB: SessionWithProvider,
  mode: SessionCardSortMode,
  t: TFunction,
): number => {
  if (mode === 'updated') {
    const byActivity = compareDescendingNumber(
      new Date(getSessionActivityTime(sessionA)).getTime(),
      new Date(getSessionActivityTime(sessionB)).getTime(),
    );
    return byActivity || compareSessionsByCreationNumber(sessionA, sessionB);
  }

  if (mode === 'title') {
    const byTitle = getSessionName(sessionA, t).localeCompare(getSessionName(sessionB, t), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    return byTitle || compareSessionsByCreationNumber(sessionA, sessionB);
  }

  if (mode === 'provider') {
    const byProvider = String(sessionA.__provider || '').localeCompare(String(sessionB.__provider || ''));
    return byProvider || compareSessionsByCreationNumber(sessionA, sessionB);
  }

  return compareSessionsByCreationNumber(sessionA, sessionB);
};

export const getSessionName = (session: SessionWithProvider, t: TFunction): string => {
  if (session.__provider === 'codex') {
    return session.label || session.summary || session.title || session.name || t('projects.codexSession');
  }

  return session.label || session.summary || session.title || t('projects.newSession');
};

export const getSessionTime = (session: SessionWithProvider): string => {
  return getSessionActivityTime(session);
};

export const createSessionViewModel = (
  session: SessionWithProvider,
  currentTime: Date,
  t: TFunction,
): SessionViewModel => {
  const sessionDate = getSessionDate(session);

  return {
    isCodexSession: session.__provider === 'codex',
    isActive: isSessionActive(session, currentTime),
    sessionName: getSessionName(session, t),
    sessionTime: getSessionTime(session),
    messageCount: Number(session.messageCount || 0),
  };
};

export const isSessionActive = (
  session: SessionWithProvider,
  currentTime: Date,
): boolean => {
  const sessionDate = getSessionDate(session);
  const diffInMinutes = Math.floor((currentTime.getTime() - sessionDate.getTime()) / (1000 * 60));
  return diffInMinutes < 10;
};

export const getAllSessions = (
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
  includeHidden = false,
): SessionWithProvider[] => {
  const isVisibleByDefault = (session: { hidden?: boolean; archived?: boolean; status?: string }) =>
    !(
      session.hidden === true ||
      session.archived === true ||
      session.status === 'archived' ||
      session.status === 'hidden'
    );

  const claudeSessions = [
    ...(project.sessions || []),
    ...(additionalSessions[project.name] || []),
  ]
    .filter((session) => includeHidden || isVisibleByDefault(session))
    .map((session) => ({ ...session, __provider: 'claude' as const }));

  const codexSessions = (project.codexSessions || [])
    .filter((session) => includeHidden || isVisibleByDefault(session))
    .map((session) => ({
      ...session,
      __provider: 'codex' as const,
    }));

  return [...claudeSessions, ...codexSessions].sort(compareSessionsByCreationNumber);
};

/**
 * Keep manual session order fixed by creation number, independent from refresh time.
 */
export const sortSessions = (
  sessions: SessionWithProvider[],
  getSessionMeta: (session: SessionWithProvider, projectName: string) => SessionUiState,
  projectName: string,
  sortMode: SessionCardSortMode = 'created',
  t?: TFunction,
): SessionWithProvider[] => {
  /**
   * The selected card order is primary; flags only break ties for duplicated legacy entries.
   */
  return [...sessions].sort((sessionA, sessionB) => {
    const bySelectedMode = t
      ? compareSessionsByCardSortMode(sessionA, sessionB, sortMode, t)
      : compareSessionsByCreationNumber(sessionA, sessionB);
    if (bySelectedMode !== 0) {
      return bySelectedMode;
    }

    const metaA = getSessionMeta(sessionA, projectName);
    const metaB = getSessionMeta(sessionB, projectName);
    const aFavoriteScore = metaA.favorite === true ? 1 : 0;
    const bFavoriteScore = metaB.favorite === true ? 1 : 0;

    if (aFavoriteScore !== bFavoriteScore) {
      return bFavoriteScore - aFavoriteScore;
    }

    const aPendingScore = metaA.pending === true ? 1 : 0;
    const bPendingScore = metaB.pending === true ? 1 : 0;

    if (aPendingScore !== bPendingScore) {
      return bPendingScore - aPendingScore;
    }

    return String(sessionB.id || '').localeCompare(String(sessionA.id || ''));
  });
};

export const getProjectLastActivity = (
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
): Date => {
  const sessions = getAllSessions(project, additionalSessions);
  if (sessions.length === 0) {
    return new Date(0);
  }

  return sessions.reduce((latest, session) => {
    const sessionDate = getSessionDate(session);
    return sessionDate > latest ? sessionDate : latest;
  }, new Date(0));
};

export const sortProjects = (
  projects: Project[],
  _projectSortOrder: ProjectSortOrder,
  _additionalSessions: AdditionalSessionsByProject,
): Project[] => {
  const sorted = [...projects];

  sorted.sort((projectA, projectB) => {
    const displayNameA = String(projectA.displayName || projectA.name || '').toLowerCase();
    const displayNameB = String(projectB.displayName || projectB.name || '').toLowerCase();
    const byDisplayName = displayNameA.localeCompare(displayNameB);
    if (byDisplayName !== 0) {
      return byDisplayName;
    }

    return String(projectA.name || '').localeCompare(String(projectB.name || ''));
  });

  return sorted;
};

export const filterProjects = (projects: Project[], searchFilter: string): Project[] => {
  const normalizedSearch = searchFilter.trim().toLowerCase();
  if (!normalizedSearch) {
    return projects;
  }

  return projects.filter((project) => {
    const displayName = (project.displayName || project.name).toLowerCase();
    const projectName = project.name.toLowerCase();
    return displayName.includes(normalizedSearch) || projectName.includes(normalizedSearch);
  });
};

export const getTaskIndicatorStatus = (
  project: Project,
  mcpServerStatus: { hasMCPServer?: boolean; isConfigured?: boolean } | null,
) => {
  const projectConfigured = Boolean(project.taskmaster?.hasTaskmaster);
  const mcpConfigured = Boolean(mcpServerStatus?.hasMCPServer && mcpServerStatus?.isConfigured);

  if (projectConfigured && mcpConfigured) {
    return 'fully-configured';
  }

  if (projectConfigured) {
    return 'taskmaster-only';
  }

  if (mcpConfigured) {
    return 'mcp-only';
  }

  return 'not-configured';
};

export const normalizeProjectForSettings = (project: Project): SettingsProject => {
  const fallbackPath =
    typeof project.fullPath === 'string' && project.fullPath.length > 0
      ? project.fullPath
      : typeof project.path === 'string'
        ? project.path
        : '';

  return {
    name: project.name,
    displayName:
      typeof project.displayName === 'string' && project.displayName.trim().length > 0
        ? project.displayName
        : project.name,
    fullPath: fallbackPath,
    path:
      typeof project.path === 'string' && project.path.length > 0
        ? project.path
        : fallbackPath,
  };
};
