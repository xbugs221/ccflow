import { useState } from 'react';
import { ChevronDown, ChevronUp, MessageSquare, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../ui/button';
import type { Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../../../../types/app';
import type { NewSessionOptions } from '../../../../utils/workflowAutoStart';
import type { SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import SidebarSessionItem from './SidebarSessionItem';

/** 每个项目组默认显示的会话数量 */
const DEFAULT_VISIBLE_SESSIONS = 5;

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
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
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

/**
 * PURPOSE: Exclude workflow-owned sessions from the sidebar manual-session
 * group so project expansion only lists sessions that are truly standalone.
 */
function isWorkflowChildSession(project: Project, session: SessionWithProvider): boolean {
  if (session.workflowId || session.stageKey || session.substageKey || Number.isInteger(session.reviewPassIndex)) {
    return true;
  }

  const childSessionIds = new Set(
    (project.workflows || []).flatMap((workflow) => (
      (workflow.childSessions || []).map((childSession) => childSession.id)
    )),
  );

  return childSessionIds.has(session.id);
}

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="p-2 rounded-md">
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 bg-muted rounded-full animate-pulse mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="h-3 bg-muted rounded animate-pulse" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 bg-muted rounded animate-pulse w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function SidebarProjectSessions({
  project,
  isExpanded,
  sessions,
  selectedSession,
  selectedWorkflow,
  initialSessionsLoaded,
  isLoadingSessions,
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
  isSessionStarred,
  isSessionPending,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  touchHandlerFactory,
  t,
}: SidebarProjectSessionsProps) {
  /** 本地折叠状态：是否展开显示全部已加载的会话 */
  const [showAllLocal, setShowAllLocal] = useState(false);

  if (!isExpanded) {
    return null;
  }

  const manualSessions = sessions.filter((session) => {
    const isCurrentWorkflowChildSession = selectedSession?.id === session.id && (
      Boolean(selectedSession?.workflowId)
      || Boolean((selectedWorkflow?.childSessions || []).some((childSession) => childSession.id === session.id))
    );
    if (isCurrentWorkflowChildSession) {
      return false;
    }
    return !isWorkflowChildSession(project, session);
  });
  const hasSessions = manualSessions.length > 0;
  const hasMoreSessions = project.sessionMeta?.hasMore === true;

  /* 本地折叠：默认只显示 DEFAULT_VISIBLE_SESSIONS 个，点击展开显示全部已加载的 */
  const hasHiddenSessions = manualSessions.length > DEFAULT_VISIBLE_SESSIONS;
  const visibleSessions = showAllLocal ? manualSessions : manualSessions.slice(0, DEFAULT_VISIBLE_SESSIONS);
  const hiddenCount = manualSessions.length - DEFAULT_VISIBLE_SESSIONS;

  return (
    <div data-testid="manual-session-group" className="ml-3 space-y-1 border-l border-border pl-3">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <h4 className="text-xs font-medium text-foreground">手动会话</h4>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => {
            onProjectSelect(project);
            onNewSession(project);
          }}
        >
          <Plus className="h-3 w-3" />
          新建
        </Button>
      </div>
      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions && !isLoadingSessions ? (
        <div className="py-2 px-3 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        visibleSessions.map((session) => (
          <SidebarSessionItem
            key={session.id}
            project={project}
            session={session}
            selectedSession={selectedSession}
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
            isStarred={isSessionStarred(session, project.name)}
            isPending={isSessionPending(session, project.name)}
            onDeleteSession={onDeleteSession}
            touchHandlerFactory={touchHandlerFactory}
            t={t}
          />
        ))
      )}

      {/* 本地折叠/展开按钮：当已加载会话超过默认数量时显示 */}
      {hasSessions && hasHiddenSessions && !showAllLocal && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center gap-2 mt-1 text-muted-foreground text-xs"
          onClick={() => setShowAllLocal(true)}
        >
          <ChevronDown className="w-3 h-3" />
          {t('sessions.showMore')} ({hiddenCount})
        </Button>
      )}

      {/* 展开后可以收起 */}
      {hasSessions && hasHiddenSessions && showAllLocal && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center gap-2 mt-1 text-muted-foreground text-xs"
          onClick={() => setShowAllLocal(false)}
        >
          <ChevronUp className="w-3 h-3" />
          {t('sessions.showLess')}
        </Button>
      )}

      {/* 从后端加载更多会话 */}
      {hasSessions && hasMoreSessions && showAllLocal && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center gap-2 mt-2 text-muted-foreground"
          onClick={() => onLoadMoreSessions(project)}
          disabled={isLoadingSessions}
        >
          {isLoadingSessions ? (
            <>
              <div className="w-3 h-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
              {t('sessions.loading')}
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              {t('sessions.loadMore')}
            </>
          )}
        </Button>
      )}

    </div>
  );
}
