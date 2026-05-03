/**
 * Application shell composition.
 * Wires shared WebSocket state, project/session selection, and main layout containers together.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';

import { useWebSocket } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import type { SessionProvider } from '../../types/app';
import { buildProjectSessionRoute, buildWorkflowChildSessionRoute } from '../../utils/projectRoute';

export default function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, latestMessage, messageHistory } = useWebSocket();
  const {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
  } = useSessionProtection();

  const {
    selectedProject,
    selectedSession,
    selectedWorkflow,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    handleSidebarRefresh,
    sidebarSharedProps,
    handleSessionSelect,
    handleWorkflowSelect,
    handleNewSession,
  } = useProjectsState({
    locationPathname: location.pathname,
    locationSearch: location.search,
    navigate,
    messageHistory,
    isMobile,
    activeSessions,
  });

  const isProjectScopedRoute = location.pathname !== '/';
  const shouldInlineMobileSidebar = isMobile && !selectedProject && !isProjectScopedRoute;

  useEffect(() => {
    window.refreshProjects = handleSidebarRefresh;

    return () => {
      if (window.refreshProjects === handleSidebarRefresh) {
        delete window.refreshProjects;
      }
    };
  }, [handleSidebarRefresh]);

  useEffect(() => {
    window.openSettings = openSettings;

    return () => {
      if (window.openSettings === openSettings) {
        delete window.openSettings;
      }
    };
  }, [openSettings]);

  const mainContent = (
    <MainContent
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      selectedWorkflow={selectedWorkflow}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      ws={ws}
      sendMessage={sendMessage}
      latestMessage={latestMessage}
      messageHistory={messageHistory}
      isMobile={isMobile}
      onMenuClick={() => setSidebarOpen(true)}
      isLoading={isLoadingProjects}
      onInputFocusChange={setIsInputFocused}
      onSessionActive={markSessionAsActive}
      onSessionInactive={markSessionAsInactive}
      onSessionProcessing={markSessionAsProcessing}
      onSessionNotProcessing={markSessionAsNotProcessing}
      processingSessions={processingSessions}
      onReplaceTemporarySession={replaceTemporarySession}
      onNavigateToSession={(
        targetSessionId: string,
        options?: {
          provider?: SessionProvider;
          projectName?: string;
          projectPath?: string;
          workflowId?: string;
          workflowStageKey?: string;
          routeSearch?: Record<string, string>;
        },
      ) => {
        const allProjects = sidebarSharedProps.projects || [];
        const matchingProject = allProjects.find((project) => (
          project.name === options?.projectName
          || project.fullPath === options?.projectPath
          || project.path === options?.projectPath
          || (project.sessions || []).some((session) => session.id === targetSessionId)
          || (project.codexSessions || []).some((session) => session.id === targetSessionId)
          || (project.workflows || []).some((workflow) => (
            (workflow.childSessions || []).some((session) => session.id === targetSessionId)
          ))
        )) || selectedProject;
        const targetSession = matchingProject
          ? [
              ...(matchingProject.sessions || []),
              ...(matchingProject.codexSessions || []),
            ].find((session) => session.id === targetSessionId) || null
          : null;
        const explicitWorkflowId = typeof options?.workflowId === 'string' ? options.workflowId : '';
        const targetWorkflow = matchingProject
          ? (matchingProject.workflows || []).find((workflow) => (
              workflow.id === explicitWorkflowId
              || (workflow.childSessions || []).some((session) => session.id === targetSessionId)
            )) || null
          : null;
        const childSession = targetWorkflow
          ? (targetWorkflow.childSessions || []).find((session) => session.id === targetSessionId) || null
          : null;
        const nextSearchParams = new URLSearchParams(options?.routeSearch || {});
        const isConcreteSessionRoute = /\/c\d+$/.test(location.pathname);
        const fallbackProject = matchingProject || selectedProject;
        const fallbackSelectedSession = selectedSession?.routeIndex
          ? {
              ...selectedSession,
              id: targetSessionId,
            }
          : null;
        const workflowDraftSession = targetWorkflow && fallbackSelectedSession?.routeIndex
          ? {
              ...fallbackSelectedSession,
              workflowId: targetWorkflow.id,
              stageKey: options?.workflowStageKey || fallbackSelectedSession.stageKey,
            }
          : null;
        const workflowRouteSession = childSession || workflowDraftSession;
        if (matchingProject && targetWorkflow && workflowRouteSession) {
          const route = buildWorkflowChildSessionRoute(
            matchingProject,
            targetWorkflow,
            workflowRouteSession,
          );
          navigate(`${route}${nextSearchParams.toString() ? `?${nextSearchParams.toString()}` : ''}`, {
            state: location.state,
          });
          return;
        }
        if (matchingProject && targetSession) {
          const route = buildProjectSessionRoute(matchingProject, targetSession);
          navigate(`${route}${nextSearchParams.toString() ? `?${nextSearchParams.toString()}` : ''}`, {
            state: location.state,
          });
          return;
        }
        /**
         * Keep the user on the draft route while the provider session is being
         * indexed. Falling back to `/` here discards correct project context and
         * can also misroute a concrete session page after the first message.
         * If the user is already on a stable `.../cN` route, keep the current
         * URL until project/session indexing catches up.
         */
        if (isConcreteSessionRoute) {
          return;
        }

        if (fallbackProject && fallbackSelectedSession) {
          const route = selectedWorkflow
            ? buildWorkflowChildSessionRoute(fallbackProject, selectedWorkflow, fallbackSelectedSession)
            : buildProjectSessionRoute(fallbackProject, fallbackSelectedSession);
          navigate(`${route}${nextSearchParams.toString() ? `?${nextSearchParams.toString()}` : ''}`, {
            state: location.state,
          });
          return;
        }
      }}
      onSelectSession={handleSessionSelect}
      onSelectWorkflow={handleWorkflowSelect}
      onNewSession={handleNewSession}
      onMarkWorkflowRead={(projectName: string, workflowIdToMark: string) =>
        sidebarSharedProps.onWorkflowMarkRead?.(projectName, workflowIdToMark)
      }
      onShowSettings={() => setShowSettings(true)}
      externalMessageUpdate={externalMessageUpdate}
    />
  );

  return (
    <div className="fixed inset-0 flex bg-background">
      {!isMobile || shouldInlineMobileSidebar ? (
        <div className="h-full flex-shrink-0 border-r border-border/50">
          <Sidebar {...sidebarSharedProps} />
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative w-[85vw] max-w-sm sm:w-80 h-full bg-card border-r border-border/40 transform transition-transform duration-150 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {mainContent}
      </div>

    </div>
  );
}
