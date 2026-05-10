/**
 * PURPOSE: Main content area with separate desktop dock and mobile single-view workspace layouts.
 */
import React, { useEffect } from 'react';
import { ChevronsLeft, ChevronsRight, Move } from 'lucide-react';

import ChatInterface from '../../chat/view/ChatInterface';
import FileTree from '../../file-tree/view/FileTree';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import GitPanel from '../../git-panel/view/GitPanel';
import ErrorBoundary from '../../ui/ErrorBoundary';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import TaskMasterPanel from './subcomponents/TaskMasterPanel';
import ProjectOverviewPanel from './subcomponents/ProjectOverviewPanel';
import WorkspaceDockLayout from './subcomponents/WorkspaceDockLayout';
import type { MainContentProps } from '../types/types';
import { useWorkspaceLayoutState } from '../hooks/useWorkspaceLayoutState';

import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import type { AppTab, Project } from '../../../types/app';
import WorkflowDetailView from './subcomponents/WorkflowDetailView';
import { getAllSessions } from '../../sidebar/utils/utils';

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
};

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  isTaskMasterReady: boolean | null;
};

type WorkflowMiniMapPosition = {
  x: number;
  y: number;
};

const WORKFLOW_MINIMAP_MARGIN = 16;

function clampWorkflowMiniMapPosition(
  position: WorkflowMiniMapPosition,
  containerRect: DOMRect,
  panelRect: DOMRect,
): WorkflowMiniMapPosition {
  const maxX = Math.max(WORKFLOW_MINIMAP_MARGIN, containerRect.width - panelRect.width - WORKFLOW_MINIMAP_MARGIN);
  const maxY = Math.max(WORKFLOW_MINIMAP_MARGIN, containerRect.height - panelRect.height - WORKFLOW_MINIMAP_MARGIN);

  return {
    x: Math.min(Math.max(position.x, WORKFLOW_MINIMAP_MARGIN), maxX),
    y: Math.min(Math.max(position.y, WORKFLOW_MINIMAP_MARGIN), maxY),
  };
}

function getDefaultWorkflowMiniMapPosition(containerRect: DOMRect, panelRect: DOMRect): WorkflowMiniMapPosition {
  return clampWorkflowMiniMapPosition(
    {
      x: containerRect.width - panelRect.width - WORKFLOW_MINIMAP_MARGIN,
      y: WORKFLOW_MINIMAP_MARGIN,
    },
    containerRect,
    panelRect,
  );
}

function MainContent({
  selectedProject,
  selectedSession,
  selectedWorkflow,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  latestMessage,
  messageHistory,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onSelectSession,
  onSelectWorkflow,
  onNewSession,
  onShowSettings,
  externalMessageUpdate,
  headerLeadingContent,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter } = preferences;

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings() as TasksSettingsContextValue;

  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);
  const projectSessions = selectedProject ? getAllSessions(selectedProject, {}, true) : [];
  const [revealDirectoryRequest, setRevealDirectoryRequest] = React.useState<{ path: string; requestId: number } | null>(null);
  const [isWorkflowMiniMapCollapsed, setIsWorkflowMiniMapCollapsed] = React.useState(false);
  const [workflowMiniMapPosition, setWorkflowMiniMapPosition] = React.useState<WorkflowMiniMapPosition | null>(null);
  const workflowMiniMapContainerRef = React.useRef<HTMLDivElement | null>(null);
  const workflowMiniMapPanelRef = React.useRef<HTMLDivElement | null>(null);
  const workflowMiniMapDragRef = React.useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origin: WorkflowMiniMapPosition;
  } | null>(null);
  const workflowSessionWorkflow = React.useMemo(() => {
    if (selectedWorkflow) {
      return selectedWorkflow;
    }
    if (!selectedProject || !selectedSession?.workflowId) {
      return null;
    }
    return (selectedProject.workflows || []).find((workflow) => workflow.id === selectedSession.workflowId) || null;
  }, [selectedProject, selectedSession?.workflowId, selectedWorkflow]);

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Workspace layout state for dock-based layout
  const {
    layout,
    setRightDock,
    setBottomDock,
    toggleRightDockCollapse,
    toggleBottomDockCollapse,
    setRightDockWidth,
    setBottomDockHeight,
    toggleRightDockFullscreen,
    toggleBottomDockFullscreen,
    moveTerminalToRightSplit,
    moveTerminalToBottom,
    setRightDockSplitRatio,
  } = useWorkspaceLayoutState(isMobile);

  const resolveWorkflowMiniMapPosition = React.useCallback(() => {
    const container = workflowMiniMapContainerRef.current;
    const panel = workflowMiniMapPanelRef.current;
    if (!container || !panel) {
      return null;
    }
    const containerRect = container.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return workflowMiniMapPosition
      ? clampWorkflowMiniMapPosition(workflowMiniMapPosition, containerRect, panelRect)
      : getDefaultWorkflowMiniMapPosition(containerRect, panelRect);
  }, [workflowMiniMapPosition]);

  const handleWorkflowMiniMapDragStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const origin = resolveWorkflowMiniMapPosition();
    if (!origin) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    workflowMiniMapDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin,
    };
    setWorkflowMiniMapPosition(origin);
  }, [resolveWorkflowMiniMapPosition]);

  const handleWorkflowMiniMapDragMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = workflowMiniMapDragRef.current;
    const container = workflowMiniMapContainerRef.current;
    const panel = workflowMiniMapPanelRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !container || !panel) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    setWorkflowMiniMapPosition(clampWorkflowMiniMapPosition(
      {
        x: drag.origin.x + event.clientX - drag.startClientX,
        y: drag.origin.y + event.clientY - drag.startClientY,
      },
      containerRect,
      panelRect,
    ));
  }, []);

  const handleWorkflowMiniMapDragEnd = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (workflowMiniMapDragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    workflowMiniMapDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  React.useLayoutEffect(() => {
    if (!workflowMiniMapPosition) {
      return;
    }
    const nextPosition = resolveWorkflowMiniMapPosition();
    if (nextPosition && (nextPosition.x !== workflowMiniMapPosition.x || nextPosition.y !== workflowMiniMapPosition.y)) {
      setWorkflowMiniMapPosition(nextPosition);
    }
  }, [isWorkflowMiniMapCollapsed, resolveWorkflowMiniMapPosition, workflowMiniMapPosition]);

  useEffect(() => {
    if (selectedProject && selectedProject !== currentProject) {
      setCurrentProject?.(selectedProject);
    }
  }, [selectedProject, currentProject, setCurrentProject]);

  useEffect(() => {
    if (!shouldShowTasksTab && activeTab === 'tasks') {
      setActiveTab('chat');
    }
  }, [shouldShowTasksTab, activeTab, setActiveTab]);

  // Wrap setActiveTab to handle dock toggle on user clicks without useEffect loops
  const handleSetActiveTab = React.useCallback(
    (value: React.SetStateAction<AppTab>) => {
      const nextTab = typeof value === 'function' ? value(activeTab) : value;

      if (isMobile) {
        setActiveTab(nextTab);
        return;
      }

      if (nextTab === 'files') {
        // Only toggle collapse when clicking the same tab again
        if (activeTab === 'files' && layout.rightDock.activePanel === 'files' && !layout.rightDock.collapsed) {
          setRightDock({ collapsed: true });
        } else {
          setRightDock({ activePanel: 'files', collapsed: false });
        }
      } else if (nextTab === 'git') {
        if (activeTab === 'git' && layout.rightDock.activePanel === 'git' && !layout.rightDock.collapsed) {
          setRightDock({ collapsed: true });
        } else {
          setRightDock({ activePanel: 'git', collapsed: false });
        }
      } else if (nextTab === 'shell') {
        if (activeTab === 'shell' && layout.bottomDock.activePanel === 'terminal' && !layout.bottomDock.collapsed) {
          setBottomDock({ collapsed: true });
        } else {
          setBottomDock({ activePanel: 'terminal', collapsed: false });
        }
      }

      setActiveTab(nextTab);
    },
    [activeTab, isMobile, layout.rightDock.activePanel, layout.rightDock.collapsed, layout.bottomDock.activePanel, layout.bottomDock.collapsed, setRightDock, setBottomDock, setActiveTab],
  );

  const renderHeader = (headerActiveTab: AppTab = activeTab) => (
    <MainContentHeader
      activeTab={headerActiveTab}
      setActiveTab={handleSetActiveTab}
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      selectedWorkflow={selectedWorkflow}
      shouldShowTasksTab={shouldShowTasksTab}
      isMobile={isMobile}
      onMenuClick={onMenuClick}
      leadingContent={headerLeadingContent}
      dockLayout={isMobile ? undefined : {
        rightDockActive: layout.rightDock.activePanel,
        rightDockCollapsed: layout.rightDock.collapsed,
        bottomDockActive: layout.bottomDock.activePanel,
        bottomDockCollapsed: layout.bottomDock.collapsed,
      }}
    />
  );

  const renderMobileEditor = () => (
    <EditorSidebar
      editingFile={editingFile}
      isMobile={isMobile}
      editorExpanded={editorExpanded}
      editorWidth={editorWidth}
      hasManualWidth={hasManualWidth}
      resizeHandleRef={resizeHandleRef}
      onResizeStart={handleResizeStart}
      onCloseEditor={handleCloseEditor}
      onToggleEditorExpand={handleToggleEditorExpand}
      projectPath={selectedProject?.path}
    />
  );

  const renderMobileWorkspace = (chatContent: React.ReactNode) => {
    /**
     * Render the mobile workspace as one full-screen task view selected by activeTab.
     */
    if (!selectedProject) {
      return chatContent;
    }

    if (activeTab === 'files') {
      return editingFile ? renderMobileEditor() : (
        <FileTree
          selectedProject={selectedProject}
          onFileOpen={handleFileOpen}
          revealDirectoryRequest={revealDirectoryRequest}
        />
      );
    }

    if (activeTab === 'git') {
      return <GitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />;
    }

    if (activeTab === 'shell') {
      return (
        <StandaloneShell
          key={`shell-${selectedProject.fullPath || selectedProject.path || selectedProject.name}`}
          project={selectedProject}
          command={null}
          isPlainShell
          showHeader={false}
        />
      );
    }

    return chatContent;
  };

  const renderMobileShell = (chatContent: React.ReactNode) => (
    <div className="h-full flex flex-col">
      {renderHeader()}
      <div className="flex-1 min-h-0 overflow-hidden" data-testid={`mobile-workspace-${activeTab}`}>
        {renderMobileWorkspace(chatContent)}
      </div>
    </div>
  );

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    if (activeTab !== 'chat') {
      return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
    }

    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={handleSetActiveTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          selectedWorkflow={selectedWorkflow}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
          leadingContent={headerLeadingContent}
          dockLayout={{
            rightDockActive: layout.rightDock.activePanel,
            rightDockCollapsed: layout.rightDock.collapsed,
            bottomDockActive: layout.bottomDock.activePanel,
            bottomDockCollapsed: layout.bottomDock.collapsed,
          }}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <ErrorBoundary showDetails>
            <ChatInterface
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              ws={ws}
              sendMessage={sendMessage}
              latestMessage={latestMessage}
              messageHistory={messageHistory}
              onFileOpen={handleFileOpen}
              onInputFocusChange={onInputFocusChange}
              onSessionActive={onSessionActive}
              onSessionInactive={onSessionInactive}
              onSessionProcessing={onSessionProcessing}
              onSessionNotProcessing={onSessionNotProcessing}
              processingSessions={processingSessions}
              onReplaceTemporarySession={onReplaceTemporarySession}
              onNavigateToSession={onNavigateToSession}
              onNewSession={onNewSession}
              onShowSettings={onShowSettings}
              autoExpandTools={autoExpandTools}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              autoScrollToBottom={autoScrollToBottom}
              sendByCtrlEnter={sendByCtrlEnter}
              externalMessageUpdate={externalMessageUpdate}
              onShowAllTasks={tasksEnabled ? () => setActiveTab('tasks') : null}
            />
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  if (selectedWorkflow && !selectedSession) {
    // Workflow detail page with dock layout
    const workflowCenterContent = (
      <>
        <div className={`flex flex-col min-h-0 min-w-0 overflow-hidden flex-1 ${editorExpanded ? 'hidden' : ''}`}>
          <WorkflowDetailView
            project={selectedProject}
            workflow={selectedWorkflow}
            onNavigateToSession={onNavigateToSession}
            onOpenArtifactFile={handleFileOpen}
            onOpenArtifactDirectory={(directoryPath) => {
              setActiveTab('files');
              setRevealDirectoryRequest({ path: directoryPath, requestId: Date.now() });
            }}
          />
        </div>
        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.path}
        />
      </>
    );

    if (isMobile) {
      return renderMobileShell(workflowCenterContent);
    }

    const workflowRightDockContent = layout.rightDock.activePanel === 'files' ? (
      <FileTree
        selectedProject={selectedProject}
        onFileOpen={handleFileOpen}
        revealDirectoryRequest={revealDirectoryRequest}
      />
    ) : layout.rightDock.activePanel === 'git' ? (
      <GitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />
    ) : null;

    const workflowBottomDockContent = layout.bottomDock.activePanel === 'terminal' ? (
      <StandaloneShell
        key={`shell-${selectedProject.fullPath || selectedProject.path || selectedProject.name}`}
        project={selectedProject}
        command={null}
        isPlainShell
        showHeader={false}
      />
    ) : null;

    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={handleSetActiveTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          selectedWorkflow={selectedWorkflow}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
          leadingContent={headerLeadingContent}
          dockLayout={{
            rightDockActive: layout.rightDock.activePanel,
            rightDockCollapsed: layout.rightDock.collapsed,
            bottomDockActive: layout.bottomDock.activePanel,
            bottomDockCollapsed: layout.bottomDock.collapsed,
          }}
        />
        <div ref={workflowMiniMapContainerRef} className="relative flex-1 flex min-h-0 overflow-hidden">
          {workflowSessionWorkflow && (
            <div
              ref={workflowMiniMapPanelRef}
              className={[
                'pointer-events-none absolute z-20 hidden xl:block',
                isWorkflowMiniMapCollapsed ? 'w-auto' : 'w-[22rem]',
              ].join(' ')}
              style={workflowMiniMapPosition
                ? { left: `${workflowMiniMapPosition.x}px`, top: `${workflowMiniMapPosition.y}px` }
                : { right: `${WORKFLOW_MINIMAP_MARGIN}px`, top: `${WORKFLOW_MINIMAP_MARGIN}px` }}
              data-testid="workflow-minimap"
            >
              {isWorkflowMiniMapCollapsed ? (
                <button
                  type="button"
                  className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/95 px-2.5 py-2 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted/70"
                  title="展开流程图"
                  aria-label="展开流程图"
                  onClick={() => setIsWorkflowMiniMapCollapsed(false)}
                >
                  <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  流程
                </button>
              ) : (
                <div className="pointer-events-auto space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="inline-flex cursor-move touch-none select-none items-center gap-1 rounded-md border border-border/70 bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm"
                      title="拖动流程图"
                      aria-label="拖动流程图"
                      data-testid="workflow-minimap-drag-handle"
                      onPointerDown={handleWorkflowMiniMapDragStart}
                      onPointerMove={handleWorkflowMiniMapDragMove}
                      onPointerUp={handleWorkflowMiniMapDragEnd}
                      onPointerCancel={handleWorkflowMiniMapDragEnd}
                    >
                      <Move className="h-3.5 w-3.5" aria-hidden="true" />
                      流程图
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:bg-muted/70"
                      title="收起流程图"
                      aria-label="收起流程图"
                      onClick={() => setIsWorkflowMiniMapCollapsed(true)}
                    >
                      <ChevronsRight className="h-3.5 w-3.5" aria-hidden="true" />
                      收起
                    </button>
                  </div>
                  <WorkflowDetailView
                    project={selectedProject}
                    workflow={workflowSessionWorkflow}
                    treeOnly
                    onNavigateToSession={onNavigateToSession}
                    onOpenArtifactFile={handleFileOpen}
                    onOpenArtifactDirectory={(directoryPath) => {
                      setActiveTab('files');
                      setRevealDirectoryRequest({ path: directoryPath, requestId: Date.now() });
                    }}
                  />
                </div>
              )}
            </div>
          )}
          <WorkspaceDockLayout
            layout={layout}
            isMobile={isMobile}
            centerContent={workflowCenterContent}
            rightDockContent={workflowRightDockContent}
            bottomDockContent={workflowBottomDockContent}
            onRightDockWidthChange={setRightDockWidth}
            onBottomDockHeightChange={setBottomDockHeight}
            onRightDockCollapseToggle={toggleRightDockCollapse}
            onBottomDockCollapseToggle={toggleBottomDockCollapse}
            onRightDockFullscreenToggle={toggleRightDockFullscreen}
            onBottomDockFullscreenToggle={toggleBottomDockFullscreen}
            onMoveTerminalToRightSplit={moveTerminalToRightSplit}
            onMoveTerminalToBottom={moveTerminalToBottom}
            onRightDockSplitRatioChange={setRightDockSplitRatio}
          />

        </div>
      </div>
    );
  }

  if (
    selectedProject
    && !selectedSession
    && !selectedWorkflow
  ) {
    // Project overview page with dock layout for files/git/shell access
    const overviewCenterContent = (
      <>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ProjectOverviewPanel
            project={selectedProject}
            selectedSession={selectedSession}
            selectedWorkflow={selectedWorkflow}
            sessions={getAllSessions(selectedProject, {}, true)}
            onNewSession={onNewSession}
            onSelectSession={onSelectSession}
            onSelectWorkflow={onSelectWorkflow}
          />
        </div>
        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.path}
          fillSpace={layout.rightDock.activePanel === 'files'}
        />
      </>
    );

    if (isMobile) {
      return renderMobileShell(overviewCenterContent);
    }

    const overviewRightDockContent = layout.rightDock.activePanel === 'files' ? (
      <FileTree
        selectedProject={selectedProject}
        onFileOpen={handleFileOpen}
        revealDirectoryRequest={revealDirectoryRequest}
      />
    ) : layout.rightDock.activePanel === 'git' ? (
      <GitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />
    ) : null;

    const overviewBottomDockContent = layout.bottomDock.activePanel === 'terminal' ? (
      <StandaloneShell
        key={`shell-${selectedProject.fullPath || selectedProject.path || selectedProject.name}`}
        project={selectedProject}
        command={null}
        isPlainShell
        showHeader={false}
      />
    ) : null;

    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={handleSetActiveTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          selectedWorkflow={selectedWorkflow}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
          leadingContent={headerLeadingContent}
          dockLayout={{
            rightDockActive: layout.rightDock.activePanel,
            rightDockCollapsed: layout.rightDock.collapsed,
            bottomDockActive: layout.bottomDock.activePanel,
            bottomDockCollapsed: layout.bottomDock.collapsed,
          }}
        />
        <div ref={workflowMiniMapContainerRef} className="relative flex-1 flex min-h-0 overflow-hidden">
          {workflowSessionWorkflow && (
            <div
              ref={workflowMiniMapPanelRef}
              className={[
                'pointer-events-none absolute z-20 hidden xl:block',
                isWorkflowMiniMapCollapsed ? 'w-auto' : 'w-[22rem]',
              ].join(' ')}
              style={workflowMiniMapPosition
                ? { left: `${workflowMiniMapPosition.x}px`, top: `${workflowMiniMapPosition.y}px` }
                : { right: `${WORKFLOW_MINIMAP_MARGIN}px`, top: `${WORKFLOW_MINIMAP_MARGIN}px` }}
              data-testid="workflow-minimap"
            >
              {isWorkflowMiniMapCollapsed ? (
                <button
                  type="button"
                  className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/95 px-2.5 py-2 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted/70"
                  title="展开流程图"
                  aria-label="展开流程图"
                  onClick={() => setIsWorkflowMiniMapCollapsed(false)}
                >
                  <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  流程
                </button>
              ) : (
                <div className="pointer-events-auto space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="inline-flex cursor-move touch-none select-none items-center gap-1 rounded-md border border-border/70 bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm"
                      title="拖动流程图"
                      aria-label="拖动流程图"
                      data-testid="workflow-minimap-drag-handle"
                      onPointerDown={handleWorkflowMiniMapDragStart}
                      onPointerMove={handleWorkflowMiniMapDragMove}
                      onPointerUp={handleWorkflowMiniMapDragEnd}
                      onPointerCancel={handleWorkflowMiniMapDragEnd}
                    >
                      <Move className="h-3.5 w-3.5" aria-hidden="true" />
                      流程图
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:bg-muted/70"
                      title="收起流程图"
                      aria-label="收起流程图"
                      onClick={() => setIsWorkflowMiniMapCollapsed(true)}
                    >
                      <ChevronsRight className="h-3.5 w-3.5" aria-hidden="true" />
                      收起
                    </button>
                  </div>
                  <WorkflowDetailView
                    project={selectedProject}
                    workflow={workflowSessionWorkflow}
                    treeOnly
                    onNavigateToSession={onNavigateToSession}
                    onOpenArtifactFile={handleFileOpen}
                    onOpenArtifactDirectory={(directoryPath) => {
                      setActiveTab('files');
                      setRevealDirectoryRequest({ path: directoryPath, requestId: Date.now() });
                    }}
                  />
                </div>
              )}
            </div>
          )}
          <WorkspaceDockLayout
            layout={layout}
            isMobile={isMobile}
            centerContent={overviewCenterContent}
            rightDockContent={overviewRightDockContent}
            bottomDockContent={overviewBottomDockContent}
            onRightDockWidthChange={setRightDockWidth}
            onBottomDockHeightChange={setBottomDockHeight}
            onRightDockCollapseToggle={toggleRightDockCollapse}
            onBottomDockCollapseToggle={toggleBottomDockCollapse}
            onRightDockFullscreenToggle={toggleRightDockFullscreen}
            onBottomDockFullscreenToggle={toggleBottomDockFullscreen}
            onMoveTerminalToRightSplit={moveTerminalToRightSplit}
            onMoveTerminalToBottom={moveTerminalToBottom}
            onRightDockSplitRatioChange={setRightDockSplitRatio}
          />

        </div>
      </div>
    );
  }

  // Main workspace with dock layout
  const centerContent = (
    <>
      <div className={`flex flex-col min-h-0 min-w-0 overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
        <div className={`flex-1 min-h-0 overflow-hidden ${activeTab === 'chat' ? 'flex flex-col' : 'hidden'}`}>
          <ErrorBoundary showDetails>
            <ChatInterface
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              ws={ws}
              sendMessage={sendMessage}
              latestMessage={latestMessage}
              messageHistory={messageHistory}
              onFileOpen={handleFileOpen}
              onInputFocusChange={onInputFocusChange}
              onSessionActive={onSessionActive}
              onSessionInactive={onSessionInactive}
              onSessionProcessing={onSessionProcessing}
              onSessionNotProcessing={onSessionNotProcessing}
              processingSessions={processingSessions}
              onReplaceTemporarySession={onReplaceTemporarySession}
              onNavigateToSession={onNavigateToSession}
              onNewSession={onNewSession}
              onShowSettings={onShowSettings}
              autoExpandTools={autoExpandTools}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              autoScrollToBottom={autoScrollToBottom}
              sendByCtrlEnter={sendByCtrlEnter}
              externalMessageUpdate={externalMessageUpdate}
              onShowAllTasks={tasksEnabled ? () => setActiveTab('tasks') : null}
            />
          </ErrorBoundary>
        </div>

        {shouldShowTasksTab && <TaskMasterPanel isVisible={activeTab === 'tasks'} />}

        <div className={`h-full overflow-hidden ${activeTab === 'preview' ? 'block' : 'hidden'}`} />
      </div>

      <EditorSidebar
        editingFile={editingFile}
        isMobile={isMobile}
        editorExpanded={editorExpanded}
        editorWidth={editorWidth}
        hasManualWidth={hasManualWidth}
        resizeHandleRef={resizeHandleRef}
        onResizeStart={handleResizeStart}
        onCloseEditor={handleCloseEditor}
        onToggleEditorExpand={handleToggleEditorExpand}
        projectPath={selectedProject.path}
        fillSpace={layout.rightDock.activePanel === 'files'}
      />
    </>
  );

  const rightDockContent = layout.rightDock.activePanel === 'files' ? (
    <FileTree
      selectedProject={selectedProject}
      onFileOpen={handleFileOpen}
      revealDirectoryRequest={revealDirectoryRequest}
    />
  ) : layout.rightDock.activePanel === 'git' ? (
    <GitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />
  ) : null;

  const bottomDockContent = layout.bottomDock.activePanel === 'terminal' ? (
    <StandaloneShell
      key={`shell-${selectedProject.fullPath || selectedProject.path || selectedProject.name}`}
      project={selectedProject}
      command={null}
      isPlainShell
      showHeader={false}
    />
  ) : null;

  if (isMobile) {
    return renderMobileShell(centerContent);
  }

  return (
    <div className="h-full flex flex-col">
      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        selectedWorkflow={selectedWorkflow}
        shouldShowTasksTab={shouldShowTasksTab}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        leadingContent={headerLeadingContent}
        dockLayout={{
          rightDockActive: layout.rightDock.activePanel,
          rightDockCollapsed: layout.rightDock.collapsed,
          bottomDockActive: layout.bottomDock.activePanel,
          bottomDockCollapsed: layout.bottomDock.collapsed,
        }}
      />

      <div ref={workflowMiniMapContainerRef} className="relative flex-1 flex min-h-0 overflow-hidden">
        {workflowSessionWorkflow && (
          <div
            ref={workflowMiniMapPanelRef}
            className={[
              'pointer-events-none absolute z-20 hidden xl:block',
              isWorkflowMiniMapCollapsed ? 'w-auto' : 'w-[22rem]',
            ].join(' ')}
            style={workflowMiniMapPosition
              ? { left: `${workflowMiniMapPosition.x}px`, top: `${workflowMiniMapPosition.y}px` }
              : { right: `${WORKFLOW_MINIMAP_MARGIN}px`, top: `${WORKFLOW_MINIMAP_MARGIN}px` }}
            data-testid="workflow-minimap"
          >
            {isWorkflowMiniMapCollapsed ? (
              <button
                type="button"
                className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/95 px-2.5 py-2 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted/70"
                title="展开流程图"
                aria-label="展开流程图"
                onClick={() => setIsWorkflowMiniMapCollapsed(false)}
              >
                <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" />
                流程
              </button>
            ) : (
              <div className="pointer-events-auto space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="inline-flex cursor-move touch-none select-none items-center gap-1 rounded-md border border-border/70 bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm"
                    title="拖动流程图"
                    aria-label="拖动流程图"
                    data-testid="workflow-minimap-drag-handle"
                    onPointerDown={handleWorkflowMiniMapDragStart}
                    onPointerMove={handleWorkflowMiniMapDragMove}
                    onPointerUp={handleWorkflowMiniMapDragEnd}
                    onPointerCancel={handleWorkflowMiniMapDragEnd}
                  >
                    <Move className="h-3.5 w-3.5" aria-hidden="true" />
                    流程图
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:bg-muted/70"
                    title="收起流程图"
                    aria-label="收起流程图"
                    onClick={() => setIsWorkflowMiniMapCollapsed(true)}
                  >
                    <ChevronsRight className="h-3.5 w-3.5" aria-hidden="true" />
                    收起
                  </button>
                </div>
                <WorkflowDetailView
                  project={selectedProject}
                  workflow={workflowSessionWorkflow}
                  treeOnly
                  onNavigateToSession={onNavigateToSession}
                  onOpenArtifactFile={handleFileOpen}
                  onOpenArtifactDirectory={(directoryPath) => {
                    setActiveTab('files');
                    setRevealDirectoryRequest({ path: directoryPath, requestId: Date.now() });
                  }}
                />
              </div>
            )}
          </div>
        )}
        <WorkspaceDockLayout
          layout={layout}
          isMobile={isMobile}
          centerContent={centerContent}
          rightDockContent={rightDockContent}
          bottomDockContent={bottomDockContent}
          onRightDockWidthChange={setRightDockWidth}
          onBottomDockHeightChange={setBottomDockHeight}
          onRightDockCollapseToggle={toggleRightDockCollapse}
          onBottomDockCollapseToggle={toggleBottomDockCollapse}
          onRightDockFullscreenToggle={toggleRightDockFullscreen}
          onBottomDockFullscreenToggle={toggleBottomDockFullscreen}
          onMoveTerminalToRightSplit={moveTerminalToRightSplit}
          onMoveTerminalToBottom={moveTerminalToBottom}
          onRightDockSplitRatioChange={setRightDockSplitRatio}
        />

      </div>
    </div>
  );
}

export default React.memo(MainContent);
