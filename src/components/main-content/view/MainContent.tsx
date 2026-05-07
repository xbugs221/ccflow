/**
 * Main content switcher.
 * Routes the selected project/session into chat, files, shell, git, tasks, and editor panels.
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
import type { MainContentProps } from '../types/types';

import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import type { Project } from '../../../types/app';
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

/**
 * PURPOSE: Keep the workflow minimap inside the visible main-content panel while users drag it.
 */
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

/**
 * PURPOSE: Convert the default top-right workflow minimap placement into draggable coordinates.
 */
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

  const resolveWorkflowMiniMapPosition = React.useCallback(() => {
    /**
     * Read live DOM sizes so drag math follows collapse/expand and responsive layout changes.
     */
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
    /**
     * Start a pointer-captured drag from the visible minimap handle.
     */
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
    /**
     * Move the minimap by pointer delta and clamp it inside the main-content viewport.
     */
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
    /**
     * Release pointer capture once the user stops repositioning the minimap.
     */
    if (workflowMiniMapDragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    workflowMiniMapDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  React.useLayoutEffect(() => {
    /**
     * Keep a dragged minimap visible when the panel resizes or the tree is collapsed.
     */
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
          setActiveTab={setActiveTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          selectedWorkflow={selectedWorkflow}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
          leadingContent={headerLeadingContent}
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

  if (selectedWorkflow && !selectedSession && activeTab === 'chat') {
    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          selectedWorkflow={selectedWorkflow}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
          leadingContent={headerLeadingContent}
        />
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className={`flex min-w-0 flex-1 flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''}`}>
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
        </div>
      </div>
    );
  }

  if (
    selectedProject
    && activeTab === 'chat'
    && !selectedSession
    && !selectedWorkflow
  ) {
    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          selectedWorkflow={selectedWorkflow}
          shouldShowTasksTab={shouldShowTasksTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
          leadingContent={headerLeadingContent}
        />
        <div className="flex-1 min-h-0 overflow-hidden">
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
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        selectedWorkflow={selectedWorkflow}
        shouldShowTasksTab={shouldShowTasksTab}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        leadingContent={headerLeadingContent}
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

          {activeTab === 'files' && (
            <div className="h-full overflow-hidden">
              <FileTree
                selectedProject={selectedProject}
                onFileOpen={handleFileOpen}
                revealDirectoryRequest={revealDirectoryRequest}
              />
            </div>
          )}

          {activeTab === 'shell' && (
            <div className="h-full w-full overflow-hidden">
              <StandaloneShell
                key={`shell-${selectedProject.fullPath || selectedProject.path || selectedProject.name}`}
                project={selectedProject}
                command={null}
                isPlainShell
                showHeader={false}
              />
            </div>
          )}

          {activeTab === 'git' && (
            <div className="h-full overflow-hidden">
              <GitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />
            </div>
          )}

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
          fillSpace={activeTab === 'files'}
        />
      </div>
    </div>
  );
}

export default React.memo(MainContent);
