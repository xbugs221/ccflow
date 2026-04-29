/**
 * PURPOSE: Render the project-level manual session list and workflow checklist
 * in the main content area before the user opens a concrete page.
 */
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Clock, Edit3, EyeOff, FolderOpen, MessageSquarePlus, Plus, Star, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import type { ProjectSession, ProjectWorkflow, SessionProvider } from '../../../../types/app';
import type { ProjectOverviewPanelProps } from '../../types/types';
import {
  compareSessionsByCardSortMode,
  createSessionViewModel,
  type SessionCardSortMode,
} from '../../../sidebar/utils/utils';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import { api } from '../../../../utils/api';
import { buildProjectWorkflowRoute } from '../../../../utils/projectRoute';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import SessionActionIconMenu from '../../../session-actions/SessionActionIconMenu';
import WorkflowStageProgress from '../../../workflow/WorkflowStageProgress';
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
 * Give favorite and pending items higher priority in overview lists.
 */
function compareOverviewPriority(
  left: { favorite?: boolean; pending?: boolean },
  right: { favorite?: boolean; pending?: boolean },
): number {
  const leftFavorite = left.favorite === true ? 1 : 0;
  const rightFavorite = right.favorite === true ? 1 : 0;
  if (leftFavorite !== rightFavorite) {
    return rightFavorite - leftFavorite;
  }

  const leftPending = left.pending === true ? 1 : 0;
  const rightPending = right.pending === true ? 1 : 0;
  if (leftPending !== rightPending) {
    return rightPending - leftPending;
  }

  return 0;
}

/**
 * PURPOSE: Keep workflow child sessions inside workflow detail links instead of
 * duplicating them in the project homepage manual-session checklist.
 */
function isWorkflowChildSession(
  project: { workflows?: ProjectWorkflow[] | null | undefined },
  session: ProjectSession & { __provider?: SessionProvider },
): boolean {
  if (session.workflowId || session.stageKey) {
    return true;
  }

  const childSessionIds = new Set(
    (project.workflows || []).flatMap((workflow) => (
      (workflow.childSessions || []).map((childSession) => childSession.id)
    )),
  );

  return childSessionIds.has(session.id);
}

/**
 * Resolve the effective timestamp for sorting workflows.
 */
function getWorkflowUpdatedAt(workflow: ProjectWorkflow): number {
  return new Date(String(workflow.updatedAt || 0)).getTime();
}

/**
 * Sort workflow overview cards by the selected visible field without changing wN ids.
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

  return Number(workflowB.routeIndex || 0) - Number(workflowA.routeIndex || 0);
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
  onMarkWorkflowRead,
}: ProjectOverviewPanelProps) {
  const navigate = useNavigate();
  const { t } = useTranslation(['sidebar', 'common']);
  const currentTime = new Date();
  const [showHiddenItems, setShowHiddenItems] = useState(false);
  /** 卡片排序只改变展示顺序，不参与 cN/wN 编号。 */
  const [sessionSortMode, setSessionSortMode] = useState<SessionCardSortMode>('created');
  /** 卡片排序只改变展示顺序，不参与 cN/wN 编号。 */
  const [workflowSortMode, setWorkflowSortMode] = useState<WorkflowCardSortMode>('created');
  const workflowEntries = [...(project.workflows || [])]
    .sort((workflowA, workflowB) => {
      const priorityOrder = compareOverviewPriority(
        workflowA,
        workflowB,
      );
      if (priorityOrder !== 0) {
        return priorityOrder;
      }
      return compareWorkflowBySortMode(workflowA, workflowB, workflowSortMode);
    });
  const workflows = workflowEntries.filter((workflow) => (
    showHiddenItems || workflow.hidden !== true
  ));
  const hiddenWorkflowCount = workflowEntries.filter((workflow) => (
    workflow.hidden === true
  )).length;
  const sessionEntries = [...sessions]
    .filter((session) => {
      if (selectedSession?.workflowId && selectedSession.id === session.id) {
        return false;
      }
      return !isWorkflowChildSession(project, session);
    })
    .sort((sessionA, sessionB) => compareSessionsByCardSortMode(sessionA, sessionB, sessionSortMode, t));
  const visibleSessions = sessionEntries
    .filter((session) => showHiddenItems || session.hidden !== true);
  const hiddenSessionCount = sessionEntries.filter((session) => session.hidden === true).length;
  const [workflowExpanded, setWorkflowExpanded] = useState(() => displayMode === 'all' || displayMode === 'workflows');
  const [sessionExpanded, setSessionExpanded] = useState(() => displayMode === 'all' || displayMode === 'sessions');
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [workflowComposerOpen, setWorkflowComposerOpen] = useState(false);
  const [workflowTitleInput, setWorkflowTitleInput] = useState('');
  const [workflowObjectiveInput, setWorkflowObjectiveInput] = useState('');
  const [availableOpenSpecChanges, setAvailableOpenSpecChanges] = useState<string[]>([]);
  const [selectedOpenSpecChange, setSelectedOpenSpecChange] = useState('');
  const [isLoadingOpenSpecChanges, setIsLoadingOpenSpecChanges] = useState(false);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);
  const [workflowComposerError, setWorkflowComposerError] = useState('');
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
  }, [project.name, sessions, showHiddenItems]);

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

  const handleCreateSession = (provider: SessionProvider) => {
    /**
     * Ask the shared session launcher to create a manual draft after the user
     * picks the provider for the new conversation.
     */
    setProviderPickerOpen(false);
    onNewSession(project, provider);
  };

  const openWorkflowComposer = async () => {
    /**
     * Open the inline workflow composer and preload adoptable OpenSpec changes
     * so the user can pick from a dropdown instead of typing change names.
     */
    setWorkflowComposerOpen(true);
    setWorkflowComposerError('');
    try {
      setIsLoadingOpenSpecChanges(true);
      const changesResponse = await api.projectOpenSpecChanges(project.name);
      const changesPayload = changesResponse.ok ? await changesResponse.json() : { changes: [] };
      const nextChanges = Array.isArray(changesPayload?.changes) ? changesPayload.changes : [];
      setAvailableOpenSpecChanges(nextChanges);
      setSelectedOpenSpecChange((current) => (nextChanges.includes(current) ? current : ''));
    } catch (error) {
      console.error('Error loading OpenSpec changes:', error);
      setAvailableOpenSpecChanges([]);
      setSelectedOpenSpecChange('');
      setWorkflowComposerError('无法读取可接手的 OpenSpec 提案。');
    } finally {
      setIsLoadingOpenSpecChanges(false);
    }
  };

  const closeWorkflowComposer = () => {
    setWorkflowComposerOpen(false);
    setWorkflowTitleInput('');
    setWorkflowObjectiveInput('');
    setAvailableOpenSpecChanges([]);
    setSelectedOpenSpecChange('');
    setWorkflowComposerError('');
  };

  const createWorkflow = async () => {
    const title = workflowTitleInput.trim();
    const objective = workflowObjectiveInput.trim();
    if (!title) {
      setWorkflowComposerError('请先填写摘要。');
      return;
    }
    if (!objective) {
      setWorkflowComposerError('请先填写需求正文。');
      return;
    }

    try {
      setIsCreatingWorkflow(true);
      setWorkflowComposerError('');
      const openspecChangeName = selectedOpenSpecChange.trim();
      const response = await api.createProjectWorkflow(project.name, {
        title,
        objective,
        openspecChangeName: openspecChangeName || undefined,
      });
      if (!response.ok) {
        setWorkflowComposerError('创建工作流失败，请稍后重试。');
        return;
      }

      const workflow = await response.json();
      await window.refreshProjects?.();
      closeWorkflowComposer();
      onSelectWorkflow(project, workflow);
      navigate(buildProjectWorkflowRoute(project, workflow));
    } catch (error) {
      console.error('Error creating workflow:', error);
      setWorkflowComposerError('创建工作流失败，请稍后重试。');
    } finally {
      setIsCreatingWorkflow(false);
    }
  };

  const handleDeleteWorkflow = async (workflowId: string, workflowTitle: string) => {
    closeActionMenu();
    if (!window.confirm(`确定删除工作流“${workflowTitle}”吗？此操作无法撤销。`)) {
      return;
    }

    try {
      const response = await api.deleteProjectWorkflow(project.name, workflowId);
      if (!response.ok) {
        return;
      }
      await window.refreshProjects?.();
    } catch (error) {
      console.error('Error deleting workflow:', error);
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
   * Rename a workflow title while keeping the underlying workflow/session ids stable.
   */
  const handleRenameWorkflow = async (workflow: ProjectWorkflow) => {
    const nextTitle = window.prompt('请输入新的工作流名称', String(workflow.title || '').trim());
    if (nextTitle == null) {
      return;
    }

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === workflow.title) {
      closeActionMenu();
      return;
    }

    const response = await api.renameProjectWorkflow(project.name, workflow.id, trimmedTitle);
    if (response.ok) {
      await window.refreshProjects?.();
    }
    closeActionMenu();
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
   * Toggle a workflow between favorite and normal priority.
   */
  const handleToggleWorkflowFavorite = async (workflow: ProjectWorkflow) => {
    await api.updateProjectWorkflowUiState(project.name, workflow.id, {
      favorite: workflow.favorite !== true,
      pending: workflow.pending === true,
      hidden: workflow.hidden === true,
    });
    await window.refreshProjects?.();
    closeActionMenu();
  };

  /**
   * Toggle a workflow's pending marker.
   */
  const handleToggleWorkflowPending = async (workflow: ProjectWorkflow) => {
    await api.updateProjectWorkflowUiState(project.name, workflow.id, {
      favorite: workflow.favorite === true,
      pending: workflow.pending !== true,
      hidden: workflow.hidden === true,
    });
    await window.refreshProjects?.();
    closeActionMenu();
  };

  /**
   * Hide a workflow from the project homepage list.
   */
  const handleHideWorkflow = async (workflow: ProjectWorkflow) => {
    await api.updateProjectWorkflowUiState(project.name, workflow.id, {
      favorite: workflow.favorite === true,
      pending: workflow.pending === true,
      hidden: workflow.hidden !== true,
    });
    await window.refreshProjects?.();
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
    <div data-testid="project-workspace-overview" className="h-full overflow-y-auto">
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
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                aria-label="工作流排序"
              >
                {CARD_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {(hiddenWorkflowCount > 0 || hiddenSessionCount > 0) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setShowHiddenItems((current) => !current)}
                >
                  {showHiddenItems ? '收起已隐藏项' : `显示已隐藏项 (${hiddenWorkflowCount + hiddenSessionCount})`}
                </Button>
              )}
              <Button variant="outline" className="h-9 gap-2 self-start" onClick={() => void openWorkflowComposer()}>
                <Plus className="h-4 w-4" />
                新建工作流
              </Button>
            </div>
          </div>
          {workflowComposerOpen && (
            <div className="mt-4 rounded-md border border-border/60 bg-card p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-foreground">
                  <span>摘要</span>
                  <Input
                    value={workflowTitleInput}
                    placeholder="例如：支持讨论优先的自动工作流"
                    onChange={(event) => setWorkflowTitleInput(event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm text-foreground md:col-span-2">
                  <span>需求正文</span>
                  <textarea
                    className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={workflowObjectiveInput}
                    placeholder="写清楚要解决的问题、预期行为和验收条件"
                    onChange={(event) => setWorkflowObjectiveInput(event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm text-foreground">
                  <span>接手已有 OpenSpec</span>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isLoadingOpenSpecChanges}
                    value={selectedOpenSpecChange}
                    onChange={(event) => setSelectedOpenSpecChange(event.target.value)}
                  >
                    <option value="">新需求，先进入规划会话</option>
                    {availableOpenSpecChanges.map((changeName) => (
                      <option key={changeName} value={changeName}>
                        {changeName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {selectedOpenSpecChange
                  ? '已选择接手现有 proposal，后端会跳过新规划并继续推进该变更。'
                  : '未选择 proposal 时，后端会预留 OpenSpec 编号，规划会话按该编号创建 10-xxx 形式的提案。'}
              </p>
              {workflowComposerError && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{workflowComposerError}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" onClick={() => void createWorkflow()} disabled={isCreatingWorkflow}>
                  {isCreatingWorkflow ? '创建中...' : '创建工作流'}
                </Button>
                <Button type="button" variant="ghost" onClick={closeWorkflowComposer} disabled={isCreatingWorkflow}>
                  取消
                </Button>
              </div>
            </div>
          )}
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
                        workflow.hidden === true ? 'opacity-60' : '',
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
                        </div>
                        <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {workflow.favorite === true && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-yellow-50 px-2 py-1 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
                              <Star className="h-3 w-3 fill-current" />
                              收藏
                            </span>
                          )}
                          {workflow.pending === true && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                              <Clock className="h-3 w-3" />
                              待处理
                            </span>
                          )}
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
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                  aria-label="手动会话排序"
                >
                  {CARD_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <Button className="h-9 gap-2 self-start" onClick={() => setProviderPickerOpen((value) => !value)}>
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
                    data-testid="project-new-session-provider-claude"
                    onClick={() => handleCreateSession('claude')}
                  >
                    Claude Code
                  </Button>
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
                    variant="ghost"
                    onClick={() => setProviderPickerOpen(false)}
                  >
                    取消
                  </Button>
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
              void handleRenameSession(
                activeSessionActionItem.__projectName || project.name,
                activeSessionActionItem.id,
                activeSessionActionItem.__provider || 'claude',
                createSessionViewModel(activeSessionActionItem, currentTime, t).sessionName,
              );
            }}
            onToggleFavorite={() => handleToggleSessionFavorite(
              activeSessionActionItem.__projectName || project.name,
              activeSessionActionItem.id,
              activeSessionActionItem.__provider || 'claude',
              activeSessionActionItem,
            )}
            onTogglePending={() => handleToggleSessionPending(
              activeSessionActionItem.__projectName || project.name,
              activeSessionActionItem.id,
              activeSessionActionItem.__provider || 'claude',
              activeSessionActionItem,
            )}
            onToggleHidden={() => handleHideSession(
              activeSessionActionItem.__projectName || project.name,
              activeSessionActionItem.id,
              activeSessionActionItem.__provider || 'claude',
              activeSessionActionItem,
            )}
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
              data-testid="project-overview-context-rename"
              onClick={() => void handleRenameWorkflow(activeWorkflowActionItem)}
            >
              <Edit3 className="h-4 w-4" />
              改名
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
              data-testid="project-overview-context-favorite"
              onClick={() => void handleToggleWorkflowFavorite(activeWorkflowActionItem)}
            >
              <Star className="h-4 w-4" />
              {activeWorkflowActionItem.favorite === true ? '取消收藏' : '收藏'}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
              data-testid="project-overview-context-pending"
              onClick={() => void handleToggleWorkflowPending(activeWorkflowActionItem)}
            >
              <Clock className="h-4 w-4" />
              {activeWorkflowActionItem.pending === true ? '取消待处理' : '待办'}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
              data-testid="project-overview-context-hide"
              onClick={() => void handleHideWorkflow(activeWorkflowActionItem)}
            >
              <EyeOff className="h-4 w-4" />
              {activeWorkflowActionItem.hidden === true ? '取消隐藏工作流' : '隐藏工作流'}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              data-testid="project-overview-context-delete"
              onClick={() => void handleDeleteWorkflow(actionMenu.workflowId, actionMenu.workflowTitle)}
            >
              <Trash2 className="h-4 w-4" />
              删除工作流
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
