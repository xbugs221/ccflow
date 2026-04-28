/**
 * Main content switcher.
 * Routes the selected project/session into chat, files, shell, git, tasks, and editor panels.
 */
import React, { useEffect } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import ChatInterface from '../../chat/view/ChatInterface';
import FileTree from '../../file-tree/view/FileTree';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import GitPanel from '../../git-panel/view/GitPanel';
import ErrorBoundary from '../../ErrorBoundary';

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
import { api } from '../../../utils/api';
import { buildProjectRoute } from '../../../utils/projectRoute';
import type { NewSessionOptions } from '../../../utils/workflowAutoStart';

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
};

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  isTaskMasterReady: boolean | null;
};

/**
 * PURPOSE: Map a workflow CTA click to the backend launcher stage that should
 * create the next child session.
 */
function resolveWorkflowLauncherStage(workflow: MainContentProps['selectedWorkflow']): string {
  /**
   * Planning uses the execution launcher once OpenSpec output exists; otherwise
   * the CTA only routes back to the planning child session for inspection.
   */
  if (workflow?.stage === 'planning' && workflow.openspecChangeDetected === true) {
    return 'execution';
  }
  return String(workflow?.stage || 'execution');
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
  onMarkWorkflowRead,
  onShowSettings,
  externalMessageUpdate,
  headerLeadingContent,
}: MainContentProps) {
  const navigate = useNavigate();
  const { preferences } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter } = preferences;

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings() as TasksSettingsContextValue;

  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);
  const projectSessions = selectedProject ? getAllSessions(selectedProject, {}, true) : [];
  const [revealDirectoryRequest, setRevealDirectoryRequest] = React.useState<{ path: string; requestId: number } | null>(null);
  const [isWorkflowMiniMapCollapsed, setIsWorkflowMiniMapCollapsed] = React.useState(false);
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
              onUpdateWorkflowGateDecision={async (workflow, gateDecision) => {
                const response = await api.updateProjectWorkflowGateDecision(selectedProject.name, workflow.id, gateDecision);
                if (!response.ok) {
                  return;
                }
                await window.refreshProjects?.();
              }}
              onDeleteWorkflow={async (workflow) => {
                if (!window.confirm(`确定删除工作流“${workflow.title}”吗？此操作无法撤销。`)) {
                  return;
                }
                const response = await api.deleteProjectWorkflow(selectedProject.name, workflow.id);
                if (!response.ok) {
                  return;
                }
                await window.refreshProjects?.();
                navigate(buildProjectRoute(selectedProject));
              }}
              onContinueWorkflow={async (workflow) => {
                const hasReviewProgress = workflow.childSessions.some((session) => (
                  /^review_\d+$/.test(String(session.stageKey || ''))
                  || /^review_\d+$/.test(String(session.substageKey || ''))
                  || Number.isInteger(session.reviewPassIndex)
                ));

                if (workflow.stage === 'planning' && !hasReviewProgress) {
                  if (workflow.openspecChangeDetected === true) {
                    const response = await api.projectWorkflowLauncherConfig(
                      selectedProject.name,
                      workflow.id,
                      { stage: resolveWorkflowLauncherStage(workflow) },
                    );
                    if (!response.ok || response.status === 204) {
                      return;
                    }
                    const launcherOptions = (await response.json()) as NewSessionOptions;
                    onNewSession(selectedProject, 'codex', launcherOptions);
                    return;
                  }

                  const planningSession = workflow.childSessions.find((session) => (
                    session.stageKey === 'planning'
                    || session.substageKey === 'planning'
                    || session.substageKey === 'planner_output'
                  ));
                  if (planningSession) {
                    onNavigateToSession(planningSession.id, {
                      provider: planningSession.provider === 'claude' ? 'claude' : 'codex',
                      projectName: selectedProject.name,
                      projectPath: selectedProject.fullPath || selectedProject.path || '',
                      workflowId: workflow.id,
                      workflowStageKey: planningSession.stageKey,
                      workflowSubstageKey: planningSession.substageKey,
                      workflowReviewPass: planningSession.reviewPassIndex,
                    });
                    return;
                  }
                  await window.refreshProjects?.();
                  return;
                }

                const response = await api.projectWorkflowLauncherConfig(
                  selectedProject.name,
                  workflow.id,
                  { stage: resolveWorkflowLauncherStage(workflow) },
                );
                if (!response.ok || response.status === 204) {
                  return;
                }
                const launcherOptions = (await response.json()) as NewSessionOptions;
                onNewSession(selectedProject, 'codex', launcherOptions);
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
            sessions={getAllSessions(selectedProject, {})}
            onNewSession={onNewSession}
            onSelectSession={onSelectSession}
            onSelectWorkflow={onSelectWorkflow}
            onMarkWorkflowRead={onMarkWorkflowRead}
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

      <div className="relative flex-1 flex min-h-0 overflow-hidden">
        {workflowSessionWorkflow && (
          <div className={[
            'pointer-events-none absolute right-4 top-4 z-20 hidden xl:block',
            isWorkflowMiniMapCollapsed ? 'w-auto' : 'w-[22rem]',
          ].join(' ')}
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
                <div className="flex justify-end">
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
