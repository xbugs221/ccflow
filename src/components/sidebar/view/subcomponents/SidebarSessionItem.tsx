/**
 * PURPOSE: Render a sidebar session row with contextual actions that live
 * behind desktop right-click and mobile long-press gestures.
 */
import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { Button } from '../../../ui/button';
import { Check, Clock, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import SessionActionIconMenu from '../../../session-actions/SessionActionIconMenu';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

const SESSION_ACTION_LONG_PRESS_MS = 450;
const VIEWED_SESSION_SIGNATURES_STORAGE_KEY = 'ccflow:viewed-session-signatures';

type SessionActionMenuState =
  | { isOpen: false; x: number; y: number }
  | { isOpen: true; x: number; y: number };

/**
 * Read the visible session number from the same stable index used by `/cN` URLs.
 */
const getSessionRouteNumber = (session: SessionWithProvider): string | null => {
  const routeIndex = Number(session.routeIndex);
  if (Number.isInteger(routeIndex) && routeIndex > 0) {
    return String(routeIndex);
  }

  const idMatch = String(session.id || '').match(/^c(\d+)$/);
  return idMatch ? idMatch[1] : null;
};

/**
 * Build the persisted read-state key for one provider session inside a project.
 */
const getViewedSessionKey = (projectName: string, session: SessionWithProvider): string =>
  [projectName, session.__provider, session.id].join(':');

/**
 * Build a compact marker that changes when the visible session activity changes.
 */
const getSessionActivitySignature = (session: SessionWithProvider): string => {
  const sessionRecord = session as Record<string, unknown>;
  const sessionTime =
    sessionRecord.lastActivity ||
    sessionRecord.lastMessageAt ||
    sessionRecord.updatedAt ||
    sessionRecord.updated_at ||
    sessionRecord.createdAt ||
    sessionRecord.created_at ||
    '';
  const messageCount = Number(sessionRecord.messageCount || 0);

  return `${Number.isFinite(messageCount) ? messageCount : 0}:${String(sessionTime)}`;
};

/**
 * Read the stored marker for a session without failing server-side rendering.
 */
const readViewedSessionSignature = (sessionKey: string): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawMarkers = window.localStorage.getItem(VIEWED_SESSION_SIGNATURES_STORAGE_KEY);
    const markers = rawMarkers ? (JSON.parse(rawMarkers) as Record<string, string>) : {};
    return typeof markers[sessionKey] === 'string' ? markers[sessionKey] : null;
  } catch {
    return null;
  }
};

/**
 * Persist the latest visible activity marker after the user views a session.
 */
const writeViewedSessionSignature = (sessionKey: string, signature: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const rawMarkers = window.localStorage.getItem(VIEWED_SESSION_SIGNATURES_STORAGE_KEY);
    const markers = rawMarkers ? (JSON.parse(rawMarkers) as Record<string, string>) : {};
    window.localStorage.setItem(
      VIEWED_SESSION_SIGNATURES_STORAGE_KEY,
      JSON.stringify({ ...markers, [sessionKey]: signature }),
    );
  } catch {
    // Ignore storage failures; unread lights should never block navigation.
  }
};

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onToggleStarSession: (session: SessionWithProvider, projectName: string) => void;
  onTogglePendingSession: (session: SessionWithProvider, projectName: string) => void;
  onToggleHiddenSession: (session: SessionWithProvider, projectName: string) => void;
  isStarred: boolean;
  isPending?: boolean;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
    projectPath?: string,
  ) => void;
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onToggleStarSession,
  onTogglePendingSession,
  onToggleHiddenSession,
  isStarred,
  isPending = false,
  onDeleteSession,
  touchHandlerFactory,
  t,
}: SidebarSessionItemProps) {
  /**
   * Worktree sessions may be rendered under a parent project but still belong
   * to the original Claude project directory for backend API routing.
   */
  const sessionProjectName =
    typeof session.__projectName === 'string' && session.__projectName
      ? session.__projectName
      : project.name;
  const sessionView = createSessionViewModel(session, currentTime, t);
  const sessionRouteNumber = getSessionRouteNumber(session);
  const isSelected = selectedSession?.id === session.id;
  const isMobileEditing = editingSession === session.id;
  const viewedSessionKey = getViewedSessionKey(sessionProjectName, session);
  const sessionActivitySignature = getSessionActivitySignature(session);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const [viewedSessionSignature, setViewedSessionSignature] = useState(
    () => readViewedSessionSignature(viewedSessionKey) || sessionActivitySignature,
  );
  const [sessionActionMenu, setSessionActionMenu] = useState<SessionActionMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
  });
  const hasUnreadActivity = !isSelected && viewedSessionSignature !== sessionActivitySignature;

  /**
   * Mark the current activity as viewed before routing into the session.
   */
  const markCurrentSessionViewed = () => {
    writeViewedSessionSignature(viewedSessionKey, sessionActivitySignature);
    setViewedSessionSignature(sessionActivitySignature);
  };

  const selectMobileSession = () => {
    markCurrentSessionViewed();
    onProjectSelect(project);
    onSessionSelect(session, sessionProjectName);
  };

  /**
   * Select a desktop session while clearing its unread activity light.
   */
  const selectDesktopSession = () => {
    markCurrentSessionViewed();
    onSessionSelect(session, sessionProjectName);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(sessionProjectName, session.id, editingSessionName);
  };

  const requestDeleteSession = () => {
    onDeleteSession(
      sessionProjectName,
      session.id,
      sessionView.sessionName,
      session.__provider,
      session.projectPath || project.fullPath || project.path || '',
    );
  };

  const openSessionActionMenu = (x: number, y: number) => {
    setSessionActionMenu({ isOpen: true, x, y });
  };

  const closeSessionActionMenu = () => {
    setSessionActionMenu((current) => (current.isOpen ? { ...current, isOpen: false } : current));
  };

  /**
   * Toggle the persisted favorite flag for the current session.
   */
  const toggleStarSession = () => {
    closeSessionActionMenu();
    onToggleStarSession(session, sessionProjectName);
  };

  /**
   * Toggle the persisted pending flag for the current session.
   */
  const togglePendingSession = () => {
    closeSessionActionMenu();
    onTogglePendingSession(session, sessionProjectName);
  };

  /**
   * Hide the current session from navigation.
   */
  const toggleHiddenSession = () => {
    closeSessionActionMenu();
    onToggleHiddenSession(session, sessionProjectName);
  };

  /**
   * Start rename mode from the contextual session action menu.
   */
  const handleStartEditingSession = () => {
    closeSessionActionMenu();
    onStartEditingSession(session.id, sessionView.sessionName);
  };

  /**
   * Clear any pending long-press timer.
   */
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  /**
   * Open the action menu when the user long-presses a mobile session row.
   */
  const handleTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    if (isMobileEditing) {
      return;
    }

    const touch = event.touches[0];
    const target = event.currentTarget;
    const touchPoint = touch ? { x: touch.clientX, y: touch.clientY } : null;
    touchStartPointRef.current = touchPoint;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      suppressNextClickRef.current = true;
      const bounds = target.getBoundingClientRect();
      openSessionActionMenu(
        touchPoint?.x ?? bounds.left + bounds.width / 2,
        touchPoint?.y ?? bounds.top + bounds.height / 2,
      );
      clearLongPressTimer();
    }, SESSION_ACTION_LONG_PRESS_MS);
  };

  /**
   * Stop long-press tracking once the finger leaves or lifts.
   */
  const handleTouchEnd = () => {
    touchStartPointRef.current = null;
    clearLongPressTimer();
  };

  /**
   * Allow tiny finger jitter while cancelling real scroll gestures.
   */
  const handleTouchMove = (event: ReactTouchEvent<HTMLElement>) => {
    const startPoint = touchStartPointRef.current;
    const touch = event.touches[0];
    if (!startPoint || !touch) {
      return;
    }

    const movedX = Math.abs(touch.clientX - startPoint.x);
    const movedY = Math.abs(touch.clientY - startPoint.y);
    if (movedX > 10 || movedY > 10) {
      handleTouchEnd();
    }
  };

  /**
   * Ignore the tap event that follows a completed long press.
   */
  const handleMobileClick = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    selectMobileSession();
  };

  useEffect(() => {
    if (isSelected) {
      writeViewedSessionSignature(viewedSessionKey, sessionActivitySignature);
      setViewedSessionSignature(sessionActivitySignature);
    }
  }, [isSelected, sessionActivitySignature, viewedSessionKey]);

  useEffect(() => {
    if (!sessionActionMenu.isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      closeSessionActionMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSessionActionMenu();
      }
    };

    const handleScroll = () => {
      closeSessionActionMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [sessionActionMenu.isOpen]);

  /**
   * On desktop, session actions live behind the native right-click gesture.
   */
  const handleDesktopContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openSessionActionMenu(event.clientX, event.clientY);
  };

  return (
    <div className="group relative">
      {hasUnreadActivity && (
        <span
          className="absolute left-1 top-1/2 z-10 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-yellow-400 shadow-sm"
          title="有未读新消息"
        />
      )}
      <div className="md:hidden">
        <div
          data-session-surface="true"
          className={cn(
            'w-full rounded-md border px-3 py-2 text-left transition-colors active:scale-[0.98]',
            isSelected ? 'border-primary bg-primary/10' : 'border-border/40 bg-background hover:bg-accent/40',
          )}
          onClick={handleMobileClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onContextMenu={handleDesktopContextMenu}
        >
          {isMobileEditing ? (
            <div className="flex items-center gap-2">
              {sessionRouteNumber && (
                <span className="w-6 flex-shrink-0 text-right text-[11px] font-medium text-muted-foreground">
                  {sessionRouteNumber}
                </span>
              )}
              <input
                type="text"
                value={editingSessionName}
                onChange={(event) => onEditingSessionNameChange(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') {
                    saveEditedSession();
                  } else if (event.key === 'Escape') {
                    onCancelEditingSession();
                  }
                }}
                className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              <button
                className="w-6 h-6 rounded-md bg-green-50 dark:bg-green-900/20 flex items-center justify-center"
                onClick={(event) => {
                  event.stopPropagation();
                  saveEditedSession();
                }}
                title={t('tooltips.save')}
              >
                <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
              </button>
              <button
                className="w-6 h-6 rounded-md bg-gray-50 dark:bg-gray-900/20 flex items-center justify-center"
                onClick={(event) => {
                  event.stopPropagation();
                  onCancelEditingSession();
                }}
                title={t('tooltips.cancel')}
              >
                <X className="w-3 h-3 text-gray-600 dark:text-gray-400" />
              </button>
              <button
                className="w-6 h-6 rounded-md bg-red-50 dark:bg-red-900/20 flex items-center justify-center"
                onClick={(event) => {
                  event.stopPropagation();
                  requestDeleteSession();
                }}
                title={t('tooltips.deleteSession')}
              >
                <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
              </button>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {sessionRouteNumber && (
                  <span className="w-6 flex-shrink-0 text-right text-[11px] font-medium text-muted-foreground">
                    {sessionRouteNumber}
                  </span>
                )}
                <div className="truncate text-xs font-medium text-foreground">{sessionView.sessionName}</div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                {isStarred && <Star className="h-3 w-3 fill-current text-yellow-500" />}
                {isPending && <Clock className="h-3 w-3 text-amber-500" />}
                <SessionProviderLogo
                  provider={session.__provider}
                  model={session.model || null}
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                />
                <span>{formatTimeAgo(sessionView.sessionTime, currentTime, t)}</span>
                {sessionView.messageCount > 0 && <span>{sessionView.messageCount} 条</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="hidden md:flex items-center gap-1">
        <Button
          variant="ghost"
          className={cn(
            'h-auto min-w-0 flex-1 justify-start rounded-md border px-3 py-2 font-normal text-left transition-colors',
            isSelected ? 'border-primary bg-primary/10' : 'border-border/40 bg-background hover:bg-accent/40',
          )}
          onClick={selectDesktopSession}
          onContextMenu={handleDesktopContextMenu}
          data-session-surface="true"
        >
          <div className="min-w-0 w-full">
            <div className="min-w-0">
              {editingSession === session.id ? (
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-full px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    {sessionRouteNumber && (
                      <span className="w-6 flex-shrink-0 text-right text-[11px] font-medium text-muted-foreground">
                        {sessionRouteNumber}
                      </span>
                    )}
                    <div className="truncate text-xs font-medium text-foreground">{sessionView.sessionName}</div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {isStarred && <Star className="h-3 w-3 fill-current text-yellow-500" />}
                    {isPending && <Clock className="h-3 w-3 text-amber-500" />}
                    <SessionProviderLogo
                      provider={session.__provider}
                      model={session.model || null}
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                    />
                    <span>{formatTimeAgo(sessionView.sessionTime, currentTime, t)}</span>
                    {sessionView.messageCount > 0 && <span>{sessionView.messageCount} 条</span>}
                  </div>
                </>
              )}
            </div>
          </div>
        </Button>
        {editingSession === session.id && (
          <div className="flex flex-shrink-0 items-center gap-1 pr-2">
            <button
              className="w-6 h-6 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40 rounded flex items-center justify-center"
              onClick={(event) => {
                event.stopPropagation();
                saveEditedSession();
              }}
              title={t('tooltips.save')}
            >
              <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
            </button>
            <button
              className="w-6 h-6 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40 rounded flex items-center justify-center"
              onClick={(event) => {
                event.stopPropagation();
                onCancelEditingSession();
              }}
              title={t('tooltips.cancel')}
            >
              <X className="w-3 h-3 text-gray-600 dark:text-gray-400" />
            </button>
            <button
              className="w-6 h-6 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded flex items-center justify-center"
              onClick={(event) => {
                event.stopPropagation();
                requestDeleteSession();
              }}
              title={t('tooltips.deleteSession')}
            >
              <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
            </button>
          </div>
        )}
      </div>

      {sessionActionMenu.isOpen && editingSession !== session.id && (
        <SessionActionIconMenu
          ref={actionMenuRef}
          className=""
          style={{ left: sessionActionMenu.x, top: sessionActionMenu.y }}
          isFavorite={isStarred}
          isPending={isPending}
          isHidden={session.hidden === true}
          labels={{
            rename: t('tooltips.editSessionName'),
            favorite: t('tooltips.addSessionToFavorites'),
            unfavorite: t('tooltips.removeSessionFromFavorites'),
            pending: '待办',
            unpending: '取消待处理',
            hide: '隐藏',
            unhide: '取消隐藏',
            delete: t('tooltips.deleteSession'),
          }}
          testIds={{
            rename: 'sidebar-session-context-rename',
            favorite: 'sidebar-session-context-favorite',
            pending: 'sidebar-session-context-pending',
            hide: 'sidebar-session-context-hide',
            delete: 'sidebar-session-context-delete',
          }}
          onRename={handleStartEditingSession}
          onToggleFavorite={toggleStarSession}
          onTogglePending={togglePendingSession}
          onToggleHidden={toggleHiddenSession}
          onDelete={() => {
            closeSessionActionMenu();
            requestDeleteSession();
          }}
        />
      )}
    </div>
  );
}
