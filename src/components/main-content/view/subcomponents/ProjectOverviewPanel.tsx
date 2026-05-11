/**
 * PURPOSE: Render the project-level manual session list and workflow checklist
 * in the main content area before the user opens a concrete page.
 */
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Clock, FolderOpen, MessageSquarePlus, Star, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../ui/button';
import type { ProjectSession, ProjectWorkflow, SessionProvider } from '../../../../types/app';
import type { ProjectOverviewPanelProps } from '../../types/types';
import {
  compareSessionsByCardSortMode,
  createSessionViewModel,
  type SessionCardSortMode,
} from '../../../sidebar/utils/utils';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import { api } from '../../../../utils/api';
import { isWorkflowOwnedSession } from '../../../../utils/workflowSessions';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import SessionActionIconMenu from '../../../session-actions/SessionActionIconMenu';
import WorkflowStageProgress from '../../../workflow/WorkflowStageProgress';
import WorkflowActionDialog from '../../../workflow/WorkflowActionDialog';
import {
  getSessionActivitySignature,
  getSessionProjectName,
  getViewedSessionKey,
  hasUnreadSessionActivity,
  readViewedSessionSignature,
  writeViewedSessionSignature,
} from './sessionActivityState.js';

const ITEM_ACTION_LONG_PRESS_MS = 450;
type WorkflowCardSortMode = 'created' | 'updated' | 'title' | 'provider';

const normalizeActionSessionProvider = (provider: unknown): SessionProvider => (
  provider === 'opencode' ? 'opencode' : 'codex'
);

const CARD_SORT_OPTIONS: Array<{ value: SessionCardSortMode; label: string }> = [
  { value: 'created', label: '创建时间' },
  { value: 'updated', label: '最近消息' },
  { value: 'title', label: '标题' },
  { value: 'provider', label: 'Provider' },
];

/**
 * Read the visible session number from the same stable index used by `/cN` URLs.
 */
const getSessionRouteNumber = (session: { routeIndex?: number | null; id?: string | number }): string | null => {
  const routeIndex = Number(session.routeIndex);
  if (Number.isInteger(routeIndex) && routeIndex > 0) {
    return String(routeIndex);
  }

  const idMatch = String(session.id || '').match(/^c(\d+)$/);
  return idMatch ? idMatch[1] : null;
};

type OverviewActionMenuState =
  | {
    isOpen: false;
    x: number;
    y: number;
  }
  | {
    isOpen: true;
    x: number;
    y: number;
    kind: 'workflow';
    workflowId: string;
    workflowTitle: string;
  }
  | {
    isOpen: true;
    x: number;
    y: number;
    kind: 'session';
    sessionId: string;
    sessionTitle: string;
    sessionProvider: SessionProvider;
    sessionProjectName: string;
  };

type OverviewActionMenuTarget =
  | {
    kind: 'workflow';
    workflowId: string;
    workflowTitle: string;
  }
  | {
    kind: 'session';
    sessionId: string;
    sessionTitle: string;
    sessionProvider: SessionProvider;
    sessionProjectName: string;
  };

function getSessionSelectionKey(session: ProjectSession & { __provider: SessionProvider }, projectName: string): string {
  /**
   * Create a stable key so Claude and Codex sessions with the same id do not
   * collide when selected together on the project homepage.
   */
  return `${session.__projectName || projectName}::${session.__provider}::${session.id}`;
}

/**
 * Resolve the effective timestamp for sorting workflows.
 */
function getWorkflowUpdatedAt(workflow: ProjectWorkflow): number {
  return new Date(String(workflow.updatedAt || 0)).getTime();
}

/**
 * Sort workflow overview cards by stable runner read-model fields.
 */
function compareWorkflowBySortMode(
  workflowA: ProjectWorkflow,
  workflowB: ProjectWorkflow,
  mode: WorkflowCardSortMode,
): number {
  if (mode === 'updated') {
    return getWorkflowUpdatedAt(workflowB) - getWorkflowUpdatedAt(workflowA);
  }

  if (mode === 'title') {
    return String(workflowA.title || '').localeCompare(String(workflowB.title || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  if (mode === 'provider') {
    const leftProvider = String(workflowA.provider || workflowA.ownerProvider || workflowA.childSessions?.[0]?.provider || '');
    const rightProvider = String(workflowB.provider || workflowB.ownerProvider || workflowB.childSessions?.[0]?.provider || '');
    return leftProvider.localeCompare(rightProvider) || String(workflowA.title || '').localeCompare(String(workflowB.title || ''));
  }

  return getWorkflowUpdatedAt(workflowB) - getWorkflowUpdatedAt(workflowA)
    || String(workflowA.title || workflowA.runId || workflowA.id || '').localeCompare(String(workflowB.title || workflowB.runId || workflowB.id || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
}

export default function ProjectOverviewPanel({
  project,
  selectedSession,
  selectedWorkflow,
  sessions,
  displayMode = 'all',
  onNewSession,
  onSelectSession,
  onSelectWorkflow,
}: ProjectOverviewPanelProps) {
  const navigate = useNavigate();
  const { t } = useTranslation(['sidebar', 'common']);
  const currentTime = new Date();
  const [showHiddenItems, setShowHiddenItems] = useState(false);
  /** 卡片排序只改变展示顺序，不参与 cN/wN 编号。 */
  const [sessionSortMode, setSessionSortMode] = useState<SessionCardSortMode>('created');
  /** 卡片排序只改变展示顺序，不参与 cN/wN 编号。 */
  const [workflowSortMode, setWorkflowSortMode] = useState<WorkflowCardSortMode>('created');
  const [optimisticSessionUiState, setOptimisticSessionUiState] = useState<Record<string, Pick<ProjectSession, 'favorite' | 'pending' | 'hidden'>>>({});
  const workflowEntries = [...(project.workflows || [])]
    .sort((workflowA, workflowB) => compareWorkflowBySortMode(workflowA, workflowB, workflowSortMode));
  const workflows = workflowEntries;
  const sessionEntries = [...sessions]
    .map((session) => ({
      ...session,
      ...(optimisticSessionUiState[getSessionSelectionKey(session, project.name)] || {}),
    }))
    .filter((session) => {
      if (selectedSession?.workflowId && selectedSession.id === session.id) {
        return false;
      }
      return !isWorkflowOwnedSession(project, session);
    })
    .sort((sessionA, sessionB) => compareSessionsByCardSortMode(sessionA, sessionB, sessionSortMode, t));
  const visibleSessions = sessionEntries
    .filter((session) => showHiddenItems || session.hidden !== true);
  const hiddenSessionCount = sessionEntries.filter((session) => session.hidden === true).length;
  const [workflowExpanded, setWorkflowExpanded] = useState(() => displayMode === 'all' || displayMode === 'workflows');
  const [sessionExpanded, setSessionExpanded] = useState(() => displayMode === 'all' || displayMode === 'sessions');
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [workflowActionDialogOpen, setWorkflowActionDialogOpen] = useState(false);
  const [sessionCreateError, setSessionCreateError] = useState('');
  const [actionMenu, setActionMenu] = useState<OverviewActionMenuState>({ isOpen: false, x: 0, y: 0 });
  const [isSessionSelectionMode, setSessionSelectionMode] = useState(false);
  const [selectedSessionKeys, setSelectedSessionKeys] = useState<Set<string>>(() => new Set());
  const [viewedSessionSignatures, setViewedSessionSignatures] = useState<Record<string, string | null>>({});
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const lastSelectedSessionKeyRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    if (!actionMenu.isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setActionMenu((current) => (current.isOpen ? { isOpen: false, x: 0, y: 0 } : current));
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionMenu({ isOpen: false, x: 0, y: 0 });
      }
    };

    const handleScroll = () => {
      setActionMenu({ isOpen: false, x: 0, y: 0 });
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [actionMenu.isOpen]);

  useEffect(() => {
    /**
     * Refresh local read receipts for visible session cards after project data changes.
     */
    const nextSignatures: Record<string, string | null> = {};
    visibleSessions.forEach((session) => {
      const sessionProjectName = getSessionProjectName(project.name, session);
      const sessionKey = getViewedSessionKey(sessionProjectName, session);
      nextSignatures[sessionKey] = readViewedSessionSignature(sessionKey)
        || getSessionActivitySignature(session);
    });
    setViewedSessionSignatures(nextSignatures);
  }, [project.name, sessions, showHiddenItems, optimisticSessionUiState]);

  useEffect(() => {
    /**
     * Drop selections that no longer exist after refresh, hide, or delete.
     */
    const availableKeys = new Set(sessionEntries.map((session) => getSessionSelectionKey(session, project.name)));
    setSelectedSessionKeys((current) => {
      const next = new Set([...current].filter((key) => availableKeys.has(key)));
      if (next.size === current.size && [...next].every((key) => current.has(key))) {
        return current;
      }
      return next;
    });
  }, [project.name, sessionEntries]);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const closeActionMenu = () => {
    setActionMenu({ isOpen: false, x: 0, y: 0 });
  };

  const openActionMenu = (nextState: OverviewActionMenuState) => {
    setActionMenu(nextState);
  };

  const bindLongPress = (nextState: OverviewActionMenuTarget) => ({
    onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = touch?.clientX ?? bounds.left + bounds.width / 2;
      const y = touch?.clientY ?? bounds.top + bounds.height / 2;

      clearLongPressTimer();
      longPressTimerRef.current = setTimeout(() => {
        suppressNextClickRef.current = true;
        openActionMenu({ ...nextState, isOpen: true, x, y });
        clearLongPressTimer();
      }, ITEM_ACTION_LONG_PRESS_MS);
    },
    onTouchEnd: clearLongPressTimer,
    onTouchCancel: clearLongPressTimer,
    onTouchMove: clearLongPressTimer,
  });

  const handleProtectedClick = (callback: () => void) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    callback();
  };

  const selectedSessions = sessionEntries.filter((session) => selectedSessionKeys.has(
    getSessionSelectionKey(session, project.name),
  ));
  const allVisibleSessionsSelected = visibleSessions.length > 0
    && visibleSessions.every((session) => selectedSessionKeys.has(getSessionSelectionKey(session, project.name)));
  const allSelectedSessionsFavorite = selectedSessions.length > 0
    && selectedSessions.every((session) => session.favorite === true);
  const allSelectedSessionsPending = selectedSessions.length > 0
    && selectedSessions.every((session) => session.pending === true);
  const allSelectedSessionsHidden = selectedSessions.length > 0
    && selectedSessions.every((session) => session.hidden === true);

  const enableSessionSelectionMode = () => {
    /**
     * Enter batch-selection mode without changing the current visible sessions.
     */
    setSessionSelectionMode(true);
    closeActionMenu();
  };

  const toggleSessionSelection = (
    session: ProjectSession & { __provider: SessionProvider },
    event?: React.MouseEvent<HTMLElement>,
  ) => {
    /**
     * Toggle one card or extend the selection range when Shift is held.
     */
    const sessionKey = getSessionSelectionKey(session, project.name);
    if (event?.shiftKey && lastSelectedSessionKeyRef.current) {
      const visibleKeys = visibleSessions.map((visibleSession) => getSessionSelectionKey(visibleSession, project.name));
      const anchorIndex = visibleKeys.indexOf(lastSelectedSessionKeyRef.current);
      const targetIndex = visibleKeys.indexOf(sessionKey);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [startIndex, endIndex] = anchorIndex < targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
        setSelectedSessionKeys((current) => {
          const next = new Set(current);
          visibleKeys.slice(startIndex, endIndex + 1).forEach((key) => next.add(key));
          return next;
        });
        lastSelectedSessionKeyRef.current = sessionKey;
        return;
      }
    }

    setSelectedSessionKeys((current) => {
      const next = new Set(current);
      if (next.has(sessionKey)) {
        next.delete(sessionKey);
      } else {
        next.add(sessionKey);
      }
      return next;
    });
    lastSelectedSessionKeyRef.current = sessionKey;
  };

  const selectAllVisibleSessions = () => {
    /**
     * Select or clear every currently visible manual session card.
     */
    setSelectedSessionKeys((current) => {
      const next = new Set(current);
      if (allVisibleSessionsSelected) {
        visibleSessions.forEach((session) => next.delete(getSessionSelectionKey(session, project.name)));
      } else {
        visibleSessions.forEach((session) => next.add(getSessionSelectionKey(session, project.name)));
      }
      return next;
    });
  };

  const clearSelectedSessions = () => {
    /**
     * Reset the batch toolbar state.
     */
    setSelectedSessionKeys(new Set());
    lastSelectedSessionKeyRef.current = null;
  };

  const exitSessionSelectionMode = () => {
    /**
     * Leave batch-selection mode and restore normal card navigation.
     */
    clearSelectedSessions();
    setSessionSelectionMode(false);
  };

  const handleSessionCardClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    session: ProjectSession & { __provider: SessionProvider },
  ) => {
    /**
     * Route card clicks to either navigation or selection based on mode.
     */
    handleProtectedClick(() => {
      if (isSessionSelectionMode) {
        toggleSessionSelection(session, event);
        return;
      }

      const sessionProjectName = getSessionProjectName(project.name, session);
      const sessionKey = getViewedSessionKey(sessionProjectName, session);
      const activitySignature = getSessionActivitySignature(session);
      writeViewedSessionSignature(sessionKey, activitySignature);
      setViewedSessionSignatures((current) => ({
        ...current,
        [sessionKey]: activitySignature,
      }));
      onSelectSession(session);
    });
  };

  const handleCreateSession = async (provider: SessionProvider) => {
    /**
     * Ask the shared session launcher to create a manual draft after the user
     * picks the provider for the new conversation.
     */
    setSessionCreateError('');
    setProviderPickerOpen(false);
    const result = await Promise.resolve(onNewSession(project, provider));
    if (result && result.ok === false) {
      setSessionCreateError(result.error);
      setProviderPickerOpen(true);
    }
  };

  const handleDeleteSession = async (
    sessionProjectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => {
    closeActionMenu();
    if (!window.confirm(`确定删除“${sessionTitle}”吗？此操作无法撤销。`)) {
      return;
    }

    try {
      const response = provider === 'codex'
        ? await api.deleteCodexSession(sessionId, project.fullPath || project.path || '')
        : await api.deleteSession(sessionProjectName, sessionId);
      if (!response.ok) {
        return;
      }
      await window.refreshProjects?.();
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  };

  const handleBatchDeleteSessions = async () => {
    /**
     * Delete every selected manual session through the same provider-specific
     * endpoints used by the one-card context menu.
     */
    closeActionMenu();
    if (selectedSessions.length === 0) {
      return;
    }

    if (!window.confirm(`确定删除选中的 ${selectedSessions.length} 个会话吗？此操作无法撤销。`)) {
      return;
    }

    try {
      const responses = await Promise.all(selectedSessions.map((session) => (
        session.__provider === 'codex'
          ? api.deleteCodexSession(session.id, session.projectPath || project.fullPath || project.path || '')
          : api.deleteSession(session.__projectName || project.name, session.id)
      )));
      if (responses.every((response) => response.ok)) {
        clearSelectedSessions();
      }
      await window.refreshProjects?.();
    } catch (error) {
      console.error('Error deleting selected sessions:', error);
    }
  };

  /**
   * Rename a session summary/title without changing the underlying jsonl filename.
   */
  const handleRenameSession = async (
    sessionProjectName: string,
    sessionId: string,
    provider: SessionProvider,
    currentTitle: string,
  ) => {
    const nextTitle = window.prompt('请输入新的会话名称', currentTitle);
    if (nextTitle == null) {
      return;
    }

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === currentTitle.trim()) {
      closeActionMenu();
      return;
    }

    const response = provider === 'codex'
      ? await api.renameCodexSession(sessionId, trimmedTitle, project.fullPath || project.path || '')
      : await api.renameSession(sessionProjectName, sessionId, trimmedTitle, project.fullPath || project.path || '');

    if (response.ok) {
      await window.refreshProjects?.();
    }
    closeActionMenu();
  };

  /**
   * Toggle a session between favorite and normal priority.
   */
  const handleToggleSessionFavorite = (
    sessionProjectName: string,
    sessionId: string,
    provider: SessionProvider,
    session: ProjectSession,
  ) => {
    void api.updateSessionUiState(sessionProjectName, sessionId, {
      provider,
      favorite: session.favorite !== true,
      pending: session.pending === true,
      hidden: session.hidden === true,
    }).then(() => window.refreshProjects?.());
    closeActionMenu();
  };

  /**
   * Toggle a session's pending marker.
   */
  const handleToggleSessionPending = (
    sessionProjectName: string,
    sessionId: string,
    provider: SessionProvider,
    session: ProjectSession,
  ) => {
    void api.updateSessionUiState(sessionProjectName, sessionId, {
      provider,
      favorite: session.favorite === true,
      pending: session.pending !== true,
      hidden: session.hidden === true,
    }).then(() => window.refreshProjects?.());
    closeActionMenu();
  };

  /**
   * Hide a session from both the homepage and sidebar lists.
   */
  const handleHideSession = (
    sessionProjectName: string,
    sessionId: string,
    provider: SessionProvider,
    session: ProjectSession,
  ) => {
    void api.updateSessionUiState(sessionProjectName, sessionId, {
      provider,
      favorite: session.favorite === true,
      pending: session.pending === true,
      hidden: session.hidden !== true,
    }).then(() => window.refreshProjects?.());
    closeActionMenu();
  };

  const handleBatchUpdateSelectedSessions = async (
    nextState: Pick<ProjectSession, 'favorite' | 'pending' | 'hidden'>,
  ) => {
    /**
     * Apply one batch metadata operation to the selected manual sessions while
     * preserving any flags that are not part of this operation.
     */
    if (selectedSessions.length === 0) {
      return;
    }

    await Promise.all(selectedSessions.map((session) => api.updateSessionUiState(
      session.__projectName || project.name,
      session.id,
      {
        provider: session.__provider,
        favorite: nextState.favorite ?? session.favorite === true,
        pending: nextState.pending ?? session.pending === true,
        hidden: nextState.hidden ?? session.hidden === true,
      },
    )));
    setOptimisticSessionUiState((current) => {
      const next = { ...current };
      selectedSessions.forEach((session) => {
        const key = getSessionSelectionKey(session, project.name);
        next[key] = {
          favorite: nextState.favorite ?? session.favorite === true,
          pending: nextState.pending ?? session.pending === true,
          hidden: nextState.hidden ?? session.hidden === true,
        };
      });
      return next;
    });
    await window.refreshProjects?.();
  };

  const activeWorkflowActionItem = actionMenu.isOpen && actionMenu.kind === 'workflow'
    ? workflows.find((workflow) => workflow.id === actionMenu.workflowId) || null
    : null;
  const activeSessionActionItem = actionMenu.isOpen && actionMenu.kind === 'session'
    ? sessionEntries.find((session) => (
      session.id === actionMenu.sessionId
      && session.__provider === actionMenu.sessionProvider
      && (session.__projectName || project.name) === actionMenu.sessionProjectName
    )) || null
    : null;
  const showWorkflowSection = displayMode === 'all' || displayMode === 'workflows';
  const showSessionSection = displayMode === 'all' || displayMode === 'sessions';

  return (
    <div data-testid="project-workspace-overview" className="h-full min-h-0 overflow-y-auto">
      <div className="flex w-full min-w-0 flex-col p-3 sm:p-4 md:p-6">
        {showWorkflowSection && (
        <section
          data-testid="project-overview-workflows"
          className={showSessionSection ? 'w-full pb-6' : 'w-full'}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              className="flex items-center gap-2 text-left"
              onClick={() => setWorkflowExpanded((value) => !value)}
            >
              {workflowExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <div>
                <h3 className="text-base font-semibold text-foreground">自动工作流</h3>
                <p className="text-sm text-muted-foreground">{workflows.length} 条需求正在跟进</p>
              </div>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={workflowSortMode}
                onChange={(event) => setWorkflowSortMode(event.target.value as WorkflowCardSortMode)}
                className="h-9 min-w-[9.5rem] rounded-md border border-input bg-transparent py-1 pl-3 pr-10 text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                aria-label="工作流排序"
              >
                {CARD_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {hiddenSessionCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setShowHiddenItems((current) => !current)}
                >
                  {showHiddenItems ? '收起已隐藏项' : `显示已隐藏项 (${hiddenSessionCount})`}
                </Button>
              )}
              <Button variant="outline" className="h-9 gap-2 self-start" onClick={() => setWorkflowActionDialogOpen(true)}>
                工作流操作
              </Button>
            </div>
          </div>
          <WorkflowActionDialog
            project={project}
            isOpen={workflowActionDialogOpen}
            onClose={() => setWorkflowActionDialogOpen(false)}
            onNewSession={onNewSession}
            onRefresh={() => window.refreshProjects?.()}
            navigateTo={navigate}
          />
          {workflowExpanded && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {workflows.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
                  暂无自动工作流
                </div>
              ) : (
                workflows.map((workflow) => {
                  const isSelected = selectedWorkflow?.id === workflow.id;
                  const workflowActionState: OverviewActionMenuTarget = {
                    kind: 'workflow',
                    workflowId: workflow.id,
                    workflowTitle: workflow.title,
                  };
                  return (
                    <div
                      key={workflow.id}
	                      className={[
	                        'flex min-h-[132px] flex-col rounded-md border p-4',
	                        isSelected ? 'border-primary bg-primary/10' : 'border-border/50 bg-background',
	                      ].join(' ')}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openActionMenu({
                          isOpen: true,
                          ...workflowActionState,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      {...bindLongPress(workflowActionState)}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 flex-col items-start gap-3 text-left"
                        onClick={() => handleProtectedClick(() => onSelectWorkflow(project, workflow))}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-sm font-medium text-foreground">{workflow.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {workflow.updatedAt
                              ? formatTimeAgo(workflow.updatedAt, currentTime, t)
                              : '未知时间'}
                          </div>
                        </div>
                        <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
	                          <WorkflowStageProgress stageStatuses={workflow.stageStatuses} size="md" />
                        </div>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
        )}

        {showSessionSection && (
        <section
          data-testid="project-overview-manual-sessions"
          className={showWorkflowSection ? 'w-full border-t border-border/60 pt-6' : 'w-full'}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              className="flex items-center gap-2 text-left"
              onClick={() => setSessionExpanded((value) => !value)}
            >
              {sessionExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <div>
                <h3 className="text-base font-semibold text-foreground">手动会话</h3>
                <p className="text-sm text-muted-foreground">{visibleSessions.length} 个可直接进入的会话</p>
              </div>
            </button>
            <div className="flex flex-col items-start gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={sessionSortMode}
                  onChange={(event) => setSessionSortMode(event.target.value as SessionCardSortMode)}
                  className="h-9 min-w-[9.5rem] rounded-md border border-input bg-transparent py-1 pl-3 pr-10 text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                  aria-label="手动会话排序"
                >
                  {CARD_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <Button
                  className="h-9 gap-2 self-start"
                  onClick={() => {
                    setSessionCreateError('');
                    setProviderPickerOpen((value) => !value);
                  }}
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  {t('sessions.newSession')}
                </Button>
                <Button
                  type="button"
                  variant={isSessionSelectionMode ? 'secondary' : 'outline'}
                  className="h-9"
                  data-testid="project-overview-session-selection-toggle"
                  onClick={isSessionSelectionMode ? exitSessionSelectionMode : enableSessionSelectionMode}
                >
                  {isSessionSelectionMode ? '退出选择' : '多选'}
                </Button>
              </div>
              {providerPickerOpen && (
                <div
                  data-testid="project-new-session-provider-picker"
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2"
                >
                  <span className="text-xs text-muted-foreground">选择会话提供方</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="project-new-session-provider-codex"
                    onClick={() => handleCreateSession('codex')}
                  >
                    Codex
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="project-new-session-provider-opencode"
                    onClick={() => handleCreateSession('opencode')}
                  >
                    OpenCode
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setProviderPickerOpen(false)}
                  >
                    取消
                  </Button>
                </div>
              )}
              {sessionCreateError && (
                <div
                  data-testid="project-new-session-error"
                  className="max-w-xl rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive break-words"
                >
                  {sessionCreateError}
                </div>
              )}
            </div>
          </div>
          {sessionExpanded && (
            <div className="mt-4 space-y-3">
              {isSessionSelectionMode && visibleSessions.length > 0 && (
                <div
                  data-testid="project-overview-session-bulk-toolbar"
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-sm"
                >
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={allVisibleSessionsSelected}
                      onChange={selectAllVisibleSessions}
                    />
                    全选可见
                  </label>
                  <span className="text-muted-foreground">已选 {selectedSessions.length} 个</span>
                  {selectedSessions.length > 0 && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        data-testid="project-overview-bulk-favorite"
                        onClick={() => void handleBatchUpdateSelectedSessions({
                          favorite: !allSelectedSessionsFavorite,
                        })}
                      >
                        {allSelectedSessionsFavorite ? '取消收藏' : '收藏'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        data-testid="project-overview-bulk-pending"
                        onClick={() => void handleBatchUpdateSelectedSessions({
                          pending: !allSelectedSessionsPending,
                        })}
                      >
                        {allSelectedSessionsPending ? '取消待处理' : '待办'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        data-testid="project-overview-bulk-hide"
                        onClick={() => void handleBatchUpdateSelectedSessions({
                          hidden: !allSelectedSessionsHidden,
                        })}
                      >
                        {allSelectedSessionsHidden ? '取消隐藏' : '隐藏'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        data-testid="project-overview-bulk-delete"
                        onClick={() => void handleBatchDeleteSessions()}
                      >
                        删除
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        data-testid="project-overview-bulk-clear"
                        onClick={exitSessionSelectionMode}
                      >
                        <X className="h-4 w-4" />
                        退出
                      </Button>
                    </>
                  )}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                {visibleSessions.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground sm:col-span-2 lg:col-span-4 xl:col-span-5">
                    {t('sessions.noSessions')}
                  </div>
                ) : (
                  visibleSessions.map((session) => {
                    const sessionView = createSessionViewModel(session, currentTime, t);
                    const isSelected = selectedSession?.id === session.id;
                    const isBatchSelected = selectedSessionKeys.has(getSessionSelectionKey(session, project.name));
                    const sessionProjectName = session.__projectName || project.name;
                    const activityProjectName = getSessionProjectName(project.name, session);
                    const activitySessionKey = getViewedSessionKey(activityProjectName, session);
                    const activitySignature = getSessionActivitySignature(session);
                    const hasUnreadActivity = hasUnreadSessionActivity({
                      isSelected,
                      viewedSignature: viewedSessionSignatures[activitySessionKey] ?? null,
                      activitySignature,
                    });
                    const sessionActionState: OverviewActionMenuTarget = {
                      kind: 'session',
                      sessionId: session.id,
                      sessionTitle: sessionView.sessionName,
                      sessionProvider: session.__provider,
                      sessionProjectName,
                    };
                    return (
                      <div
                        key={`${session.__provider}-${session.id}`}
                        className={[
                          'relative min-h-[132px] min-w-0 rounded-md border transition-colors',
                          isSelected || isBatchSelected ? 'border-primary bg-primary/10' : 'border-border/50 bg-background hover:bg-accent/40',
                          session.hidden === true ? 'opacity-60' : '',
                        ].join(' ')}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          openActionMenu({
                            isOpen: true,
                            ...sessionActionState,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                        {...bindLongPress(sessionActionState)}
                      >
                        {isSessionSelectionMode && (
                          <span
                            className={[
                              'absolute left-3 top-3 z-10 flex h-4 w-4 items-center justify-center rounded border text-[10px]',
                              isBatchSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
                            ].join(' ')}
                            aria-hidden="true"
                          >
                            {isBatchSelected ? '✓' : ''}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-pressed={isSessionSelectionMode ? isBatchSelected : undefined}
                          className={[
                            'flex h-full w-full min-w-0 flex-col items-start justify-between gap-4 px-4 py-3 text-left',
                            isSessionSelectionMode ? 'pl-10' : '',
                          ].join(' ')}
                          onClick={(event) => handleSessionCardClick(event, session)}
                        >
                          <div className="w-full min-w-0 space-y-2">
                            <div className="flex w-full min-w-0 items-start gap-2">
                              <span className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">
                                {sessionView.sessionName}
                              </span>
                              <SessionProviderLogo
                                provider={session.__provider}
                                model={session.model || null}
                                className="h-4 w-4 shrink-0 text-muted-foreground"
                              />
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {sessionView.sessionTime
                                ? formatTimeAgo(sessionView.sessionTime, currentTime, t)
                                : '未知时间'}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {hasUnreadActivity && (
                              <span
                                className="inline-flex h-2.5 w-2.5 rounded-full bg-yellow-400 shadow-sm"
                                title="有未读新消息"
                              />
                            )}
                            {(() => {
                              const routeNumber = getSessionRouteNumber(session);
                              return routeNumber ? (
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  #{routeNumber}
                                </span>
                              ) : null;
                            })()}
                            {session.favorite === true && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-yellow-50 px-2 py-1 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
                                <Star className="h-3 w-3 fill-current" />
                                收藏
                              </span>
                            )}
                            {session.pending === true && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                                <Clock className="h-3 w-3" />
                              待处理
                            </span>
                          )}
                          <span>{sessionView.messageCount} 条消息</span>
                        </div>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            </div>
          )}
        </section>
        )}

        {actionMenu.isOpen && actionMenu.kind === 'session' && activeSessionActionItem && (
          <SessionActionIconMenu
            ref={actionMenuRef}
            style={{ left: actionMenu.x, top: actionMenu.y }}
            isFavorite={activeSessionActionItem.favorite === true}
            isPending={activeSessionActionItem.pending === true}
            isHidden={activeSessionActionItem.hidden === true}
            labels={{
              rename: '改名',
              favorite: '收藏',
              unfavorite: '取消收藏',
              pending: '待办',
              unpending: '取消待处理',
              hide: '隐藏',
              unhide: '取消隐藏',
              delete: '删除',
            }}
            testIds={{
              rename: 'project-overview-context-rename',
              favorite: 'project-overview-context-favorite',
              pending: 'project-overview-context-pending',
              hide: 'project-overview-context-hide',
              delete: 'project-overview-context-delete',
            }}
            onRename={() => {
              const actionProvider = normalizeActionSessionProvider(activeSessionActionItem.__provider);
              void handleRenameSession(
                activeSessionActionItem.__projectName || project.name,
                activeSessionActionItem.id,
                actionProvider,
                createSessionViewModel(activeSessionActionItem, currentTime, t).sessionName,
              );
            }}
            onToggleFavorite={() => {
              const actionProvider = normalizeActionSessionProvider(activeSessionActionItem.__provider);
              handleToggleSessionFavorite(
                activeSessionActionItem.__projectName || project.name,
                activeSessionActionItem.id,
                actionProvider,
                activeSessionActionItem,
              );
            }}
            onTogglePending={() => {
              const actionProvider = normalizeActionSessionProvider(activeSessionActionItem.__provider);
              handleToggleSessionPending(
                activeSessionActionItem.__projectName || project.name,
                activeSessionActionItem.id,
                actionProvider,
                activeSessionActionItem,
              );
            }}
            onToggleHidden={() => {
              const actionProvider = normalizeActionSessionProvider(activeSessionActionItem.__provider);
              handleHideSession(
                activeSessionActionItem.__projectName || project.name,
                activeSessionActionItem.id,
                actionProvider,
                activeSessionActionItem,
              );
            }}
            onDelete={() => void handleDeleteSession(
              actionMenu.sessionProjectName,
              actionMenu.sessionId,
              actionMenu.sessionTitle,
              actionMenu.sessionProvider,
            )}
          />
        )}

        {actionMenu.isOpen && actionMenu.kind === 'workflow' && activeWorkflowActionItem && (
          <div
            ref={actionMenuRef}
            className="fixed z-[80] min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: actionMenu.x, top: actionMenu.y }}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onSelectWorkflow(project, activeWorkflowActionItem);
                closeActionMenu();
              }}
            >
              <ChevronRight className="h-4 w-4" />
              打开详情
            </button>
          </div>
        )}

        <section className="mt-6 border-t border-dashed border-border/60 pt-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            先从右侧列表进入会话或需求，再继续对应页面操作。
          </div>
        </section>
      </div>
    </div>
  );
}
