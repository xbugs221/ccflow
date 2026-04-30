/**
 * PURPOSE: Render the current project's workspace navigation with fixed
 * workflow/session grouping and project-scoped item actions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Edit3, Eye, MessageSquare, Star, Trash2, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../../types/app';
import { api } from '../../utils/api';
import { createSessionViewModel, getAllSessions, sortSessions } from '../sidebar/utils/utils';
import type { SessionWithProvider } from '../sidebar/types/types';
import { buildProjectRoute, buildProjectWorkflowRoute } from '../../utils/projectRoute';
import type { NewSessionOptions } from '../../utils/workflowAutoStart';
import { useResizableWidth } from '../../hooks/useResizableWidth';

type ProjectWorkspaceNavProps = {
  project: Project;
  selectedSession: ProjectSession | null;
  selectedWorkflow: ProjectWorkflow | null;
  onSessionSelect: (session: ProjectSession) => void;
  onWorkflowSelect: (project: Project, workflow: ProjectWorkflow) => void;
  onNewSession: (project: Project, provider?: SessionProvider, options?: NewSessionOptions) => void;
  onRefresh: () => Promise<void> | void;
};

const WORKFLOW_STAGE_PROVIDER_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'planning', label: '规划提案' },
  { key: 'execution', label: '执行' },
  { key: 'review_1', label: '初审' },
  { key: 'repair_1', label: '初修' },
  { key: 'review_2', label: '再审' },
  { key: 'repair_2', label: '再修' },
  { key: 'review_3', label: '三审' },
  { key: 'repair_3', label: '三修' },
  { key: 'archive', label: '归档' },
];

function buildDefaultStageProviders(): Record<string, SessionProvider> {
  /**
   * PURPOSE: Give every workflow stage a deterministic provider choice.
   */
  return Object.fromEntries(
    WORKFLOW_STAGE_PROVIDER_OPTIONS.map((stage) => [stage.key, 'codex' as SessionProvider]),
  );
}

function buildExplicitStageProviders(
  stageProviders: Record<string, SessionProvider>,
  enabled: boolean,
): Record<string, SessionProvider> | undefined {
  /**
   * PURPOSE: Send only user-configured stage providers when the create form exposes that choice.
   */
  if (!enabled) {
    return undefined;
  }
  const explicitProviders = WORKFLOW_STAGE_PROVIDER_OPTIONS.reduce<Record<string, SessionProvider>>((providers, stage) => {
    const provider = stageProviders[stage.key] === 'claude' ? 'claude' : 'codex';
    if (provider !== 'codex') {
      providers[stage.key] = provider;
    }
    return providers;
  }, {});
  return Object.keys(explicitProviders).length > 0 ? explicitProviders : undefined;
}

type ActionMenuState =
  | { isOpen: false; x: number; y: number }
  | {
    isOpen: true;
    x: number;
    y: number;
    kind: 'workflow';
    workflowId: string;
  }
  | {
    isOpen: true;
    x: number;
    y: number;
    kind: 'session';
    sessionId: string;
    provider: SessionProvider;
    projectName: string;
  };

function comparePriority(
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
 * PURPOSE: Show workflow navigation state from completion evidence, not from
 * per-user read/unread flags.
 */
function isWorkflowFinished(workflow: ProjectWorkflow): boolean {
  const stageStatusMap = new Map((workflow.stageStatuses || []).map((stage) => [stage.key, stage.status]));
  return workflow.runState === 'completed'
    || stageStatusMap.get('archive') === 'completed'
    || stageStatusMap.get('verification') === 'completed';
}

/**
 * PURPOSE: Keep workflow child sessions inside workflow detail pages instead of
 * duplicating them under the manual-session navigation group.
 */
function isWorkflowChildSession(project: Project, session: SessionWithProvider): boolean {
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

export default function ProjectWorkspaceNav({
  project,
  selectedSession,
  selectedWorkflow,
  onSessionSelect,
  onWorkflowSelect,
  onNewSession,
  onRefresh,
}: ProjectWorkspaceNavProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const navigate = useNavigate();
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [actionMenu, setActionMenu] = useState<ActionMenuState>({ isOpen: false, x: 0, y: 0 });
  const [manualSessionTitleWrapped, setManualSessionTitleWrapped] = useState(false);
  const [workflowComposerOpen, setWorkflowComposerOpen] = useState(false);
  const [workflowTitleInput, setWorkflowTitleInput] = useState('');
  const [workflowObjectiveInput, setWorkflowObjectiveInput] = useState('');
  const [workflowStageProviders, setWorkflowStageProviders] = useState<Record<string, SessionProvider>>(
    () => buildDefaultStageProviders(),
  );
  const [workflowStageConfigOpen, setWorkflowStageConfigOpen] = useState(false);
  const [availableOpenSpecChanges, setAvailableOpenSpecChanges] = useState<string[]>([]);
  const [selectedOpenSpecChange, setSelectedOpenSpecChange] = useState('');
  const [isLoadingOpenSpecChanges, setIsLoadingOpenSpecChanges] = useState(false);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);
  const [workflowComposerError, setWorkflowComposerError] = useState('');
  /**
   * PURPOSE: Let users resize dense workflow/session navigation without
   * affecting the global project sidebar width.
   */
  const { width, resizeHandleProps } = useResizableWidth({
    storageKey: 'ccflow:project-workspace-nav-width',
    defaultWidth: 288,
    minWidth: 224,
    maxWidth: 520,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!actionMenu.isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setActionMenu({ isOpen: false, x: 0, y: 0 });
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionMenu({ isOpen: false, x: 0, y: 0 });
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [actionMenu]);

  const workflows = useMemo(() => (
    [...(project.workflows || [])]
      .filter((workflow) => workflow.hidden !== true)
      .sort((left, right) => {
        const priority = comparePriority(left, right);
        if (priority !== 0) {
          return priority;
        }
        return new Date(String(right.updatedAt || 0)).getTime() - new Date(String(left.updatedAt || 0)).getTime();
      })
  ), [project.workflows]);

  const sessions = useMemo(() => sortSessions(
    getAllSessions(project, {})
      .filter((session) => {
        if (session.hidden === true) {
          return false;
        }
        const isCurrentWorkflowChildSession = selectedSession?.id === session.id && (
          Boolean(selectedSession?.workflowId)
          || Boolean((selectedWorkflow?.childSessions || []).some((childSession) => childSession.id === session.id))
        );
        if (isCurrentWorkflowChildSession) {
          return false;
        }
        return !isWorkflowChildSession(project, session);
      }),
    (session) => ({
      favorite: session.favorite === true,
      pending: session.pending === true,
      hidden: session.hidden === true,
    }),
    project.name,
  ), [project, selectedSession?.id, selectedSession?.workflowId, selectedWorkflow?.childSessions]);

  const activeWorkflow = actionMenu.isOpen && actionMenu.kind === 'workflow'
    ? workflows.find((workflow) => workflow.id === actionMenu.workflowId) || null
    : null;
  const activeSession = actionMenu.isOpen && actionMenu.kind === 'session'
    ? sessions.find((session) => (
      session.id === actionMenu.sessionId
      && session.__provider === actionMenu.provider
      && (session.__projectName || project.name) === actionMenu.projectName
    )) || null
    : null;

  const closeActionMenu = () => setActionMenu({ isOpen: false, x: 0, y: 0 });

  const refreshProject = async () => {
    await onRefresh();
    closeActionMenu();
  };

  const openWorkflowComposer = async () => {
    /**
     * PURPOSE: Open the workspace navigation composer with the same create and
     * adopt choices available in the project overview.
     */
    setWorkflowComposerOpen(true);
    setWorkflowComposerError('');
    setIsLoadingOpenSpecChanges(true);
    try {
      const response = await api.projectOpenSpecChanges(project.name);
      const payload = response.ok ? await response.json() : { changes: [] };
      const changes = Array.isArray(payload?.changes) ? payload.changes : [];
      setAvailableOpenSpecChanges(changes);
      setSelectedOpenSpecChange((current) => (changes.includes(current) ? current : ''));
    } catch (error) {
      console.error('Error loading OpenSpec changes from project workspace nav:', error);
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
    setWorkflowStageProviders(buildDefaultStageProviders());
    setWorkflowStageConfigOpen(false);
    setAvailableOpenSpecChanges([]);
    setSelectedOpenSpecChange('');
    setWorkflowComposerError('');
  };

  /**
   * PURPOSE: Create a new workflow from the workspace navigation composer.
   */
  const handleCreateWorkflow = async () => {
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
        stageProviders: buildExplicitStageProviders(workflowStageProviders, workflowStageConfigOpen),
      });
      if (!response.ok) {
        setWorkflowComposerError('创建工作流失败，请稍后重试。');
        return;
      }

      const workflow = await response.json();
      await onRefresh();
      closeWorkflowComposer();
      navigate(buildProjectWorkflowRoute(project, workflow));
    } catch (error) {
      console.error('Error creating workflow from project workspace nav:', error);
      setWorkflowComposerError('创建工作流失败，请稍后重试。');
    } finally {
      setIsCreatingWorkflow(false);
    }
  };

  /**
   * PURPOSE: Create a new manual session from the workspace sidebar.
   */
  const handleCreateManualSession = () => {
    onNewSession(project, 'codex');
  };

  const handleRenameWorkflow = async (workflow: ProjectWorkflow) => {
    const nextTitle = window.prompt('请输入新的工作流名称', String(workflow.title || '').trim());
    if (nextTitle == null) {
      closeActionMenu();
      return;
    }

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === workflow.title) {
      closeActionMenu();
      return;
    }

    await api.renameProjectWorkflow(project.name, workflow.id, trimmedTitle);
    await refreshProject();
  };

  const handleRenameSession = async (session: SessionWithProvider) => {
    const currentTitle = createSessionViewModel(session, currentTime, t).sessionName;
    const nextTitle = window.prompt('请输入新的会话名称', currentTitle);
    if (nextTitle == null) {
      closeActionMenu();
      return;
    }

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === currentTitle.trim()) {
      closeActionMenu();
      return;
    }

    if (session.__provider === 'codex') {
      await api.renameCodexSession(session.id, trimmedTitle);
    } else {
      await api.renameSession(session.__projectName || project.name, session.id, trimmedTitle);
    }
    await refreshProject();
  };

  const handleDeleteWorkflow = async (workflow: ProjectWorkflow) => {
    if (!window.confirm(`确定删除工作流“${workflow.title}”吗？此操作无法撤销。`)) {
      closeActionMenu();
      return;
    }
    await api.deleteProjectWorkflow(project.name, workflow.id);
    await refreshProject();
  };

  const handleDeleteSession = async (session: SessionWithProvider) => {
    const sessionTitle = createSessionViewModel(session, currentTime, t).sessionName;
    if (!window.confirm(`确定删除“${sessionTitle}”吗？此操作无法撤销。`)) {
      closeActionMenu();
      return;
    }
    if (session.__provider === 'codex') {
      await api.deleteCodexSession(session.id, session.projectPath || project.fullPath || project.path || '');
    } else {
      await api.deleteSession(session.__projectName || project.name, session.id);
    }
    await refreshProject();
  };

  const handleToggleWorkflowFavorite = async (workflow: ProjectWorkflow) => {
    await api.updateProjectWorkflowUiState(project.name, workflow.id, {
      favorite: workflow.favorite !== true,
      pending: workflow.pending === true,
      hidden: workflow.hidden === true,
    });
    await refreshProject();
  };

  const handleToggleWorkflowPending = async (workflow: ProjectWorkflow) => {
    await api.updateProjectWorkflowUiState(project.name, workflow.id, {
      favorite: workflow.favorite === true,
      pending: workflow.pending !== true,
      hidden: workflow.hidden === true,
    });
    await refreshProject();
  };

  const handleToggleSessionFavorite = async (session: SessionWithProvider) => {
    await api.updateSessionUiState(session.__projectName || project.name, session.id, {
      provider: session.__provider,
      favorite: session.favorite !== true,
      pending: session.pending === true,
      hidden: session.hidden === true,
    });
    await refreshProject();
  };

  const handleToggleSessionPending = async (session: SessionWithProvider) => {
    await api.updateSessionUiState(session.__projectName || project.name, session.id, {
      provider: session.__provider,
      favorite: session.favorite === true,
      pending: session.pending !== true,
      hidden: session.hidden === true,
    });
    await refreshProject();
  };

  return (
    <div
      data-testid="project-workspace-nav"
      className="relative flex h-full flex-shrink-0 flex-col border-r border-border/60 bg-background"
      style={{ width }}
    >
      <div className="border-b border-border/60 px-4 py-4">
        <button
          type="button"
          data-testid="project-workspace-home-link"
          className="max-w-full truncate text-left text-xl font-semibold leading-tight text-foreground transition-colors hover:text-primary"
          onClick={() => navigate(buildProjectRoute(project))}
        >
          {project.displayName}
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <section data-testid="project-workspace-workflows-group" className="space-y-2">
          <div className="flex items-center justify-between gap-3 px-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Workflow className="h-3.5 w-3.5" />
              <span>需求工作流</span>
            </div>
            <button
              type="button"
              data-testid="project-workspace-new-workflow"
              className="rounded-md border border-border/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => {
                void openWorkflowComposer();
              }}
            >
              新建
            </button>
          </div>
          {workflowComposerOpen && (
            <div className="space-y-2 rounded-md border border-border/60 bg-card p-3">
              <label className="grid gap-1 text-xs text-foreground">
                <span>摘要</span>
                <input
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  value={workflowTitleInput}
                  placeholder="工作流摘要"
                  onChange={(event) => setWorkflowTitleInput(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs text-foreground">
                <span>需求正文</span>
                <textarea
                  className="min-h-24 rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                  value={workflowObjectiveInput}
                  placeholder="写清楚问题、预期行为和验收条件"
                  onChange={(event) => setWorkflowObjectiveInput(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs text-foreground">
                <span>接手已有 OpenSpec</span>
                <select
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  disabled={isLoadingOpenSpecChanges}
                  value={selectedOpenSpecChange}
                  onChange={(event) => setSelectedOpenSpecChange(event.target.value)}
                >
                  <option value="">新需求，先进入规划</option>
                  {availableOpenSpecChanges.map((changeName) => (
                    <option key={changeName} value={changeName}>
                      {changeName}
                    </option>
                  ))}
                </select>
              </label>
              <details
                className="rounded-md border border-border/60 p-2"
                open={workflowStageConfigOpen}
                onToggle={(event) => setWorkflowStageConfigOpen(event.currentTarget.open)}
              >
                <summary className="cursor-pointer text-xs font-medium text-foreground">阶段配置</summary>
                <div className="mt-2 grid gap-2">
                  {WORKFLOW_STAGE_PROVIDER_OPTIONS.map((stage) => (
                    <label key={stage.key} className="flex items-center justify-between gap-2 text-xs text-foreground">
                      <span>{stage.label}</span>
                      <select
                        data-testid={`workflow-stage-provider-${stage.key}`}
                        className="h-7 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                        value={workflowStageProviders[stage.key] || 'codex'}
                        onChange={(event) => {
                          const provider = event.target.value === 'claude' ? 'claude' : 'codex';
                          setWorkflowStageProviders((current) => ({
                            ...current,
                            [stage.key]: provider,
                          }));
                        }}
                      >
                        <option value="codex">codex</option>
                        <option value="claude">claude</option>
                      </select>
                    </label>
                  ))}
                </div>
              </details>
              {workflowComposerError && <p className="text-xs text-destructive">{workflowComposerError}</p>}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                  onClick={closeWorkflowComposer}
                  disabled={isCreatingWorkflow}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                  onClick={() => void handleCreateWorkflow()}
                  disabled={isCreatingWorkflow}
                >
                  {isCreatingWorkflow ? '创建中' : '创建'}
                </button>
              </div>
            </div>
          )}
          {workflows.map((workflow) => {
            const isSelected = selectedWorkflow?.id === workflow.id;
            const workflowFinished = isWorkflowFinished(workflow);
            return (
              <div
                key={workflow.id}
                className={[
                  'rounded-md border',
                  isSelected ? 'border-primary bg-primary/10' : 'border-border/50 bg-card',
                ].join(' ')}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActionMenu({
                    isOpen: true,
                    x: event.clientX,
                    y: event.clientY,
                    kind: 'workflow',
                    workflowId: workflow.id,
                  });
                }}
              >
                <button
                  type="button"
                  className="flex w-full items-start px-3 py-3 text-left"
                  onClick={() => onWorkflowSelect(project, workflow)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{workflow.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {workflow.favorite === true && <Star className="h-3 w-3 fill-current text-yellow-500" />}
                      {workflow.pending === true && <Clock className="h-3 w-3 text-amber-500" />}
                      <span>{workflow.stage}</span>
                      <span
                        className={[
                          'inline-flex h-2 w-2 rounded-full',
                          workflowFinished ? 'bg-emerald-500' : 'bg-amber-500',
                        ].join(' ')}
                        title={workflowFinished ? '工作流已结束' : '工作流进行中'}
                      />
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </section>

        <section data-testid="project-workspace-manual-sessions-group" className="space-y-2">
          <div className="flex items-center justify-between gap-3 px-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                <span>手动会话</span>
              </div>
              <button
                type="button"
                data-testid="project-workspace-new-session"
                className="rounded-md border border-border/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={handleCreateManualSession}
              >
                新建
              </button>
            </div>
            <button
              type="button"
              className={[
                'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                manualSessionTitleWrapped
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground',
              ].join(' ')}
              onClick={() => setManualSessionTitleWrapped((wrapped) => !wrapped)}
            >
              Wrap
            </button>
          </div>
          {sessions.map((session) => {
            const view = createSessionViewModel(session, currentTime, t);
            const isSelected = selectedSession?.id === session.id;
            return (
              <div
                key={`${session.__provider}-${session.id}`}
                className={[
                  'rounded-md border',
                  isSelected ? 'border-primary bg-primary/10' : 'border-border/50 bg-card',
                ].join(' ')}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActionMenu({
                    isOpen: true,
                    x: event.clientX,
                    y: event.clientY,
                    kind: 'session',
                    sessionId: session.id,
                    provider: session.__provider,
                    projectName: session.__projectName || project.name,
                  });
                }}
              >
                <button
                  type="button"
                  className="flex w-full items-start px-3 py-3 text-left"
                  onClick={() => onSessionSelect(session)}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={[
                        'text-sm font-medium text-foreground',
                        manualSessionTitleWrapped ? 'break-words whitespace-normal leading-snug' : 'truncate',
                      ].join(' ')}
                    >
                      {view.sessionName}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {session.favorite === true && <Star className="h-3 w-3 fill-current text-yellow-500" />}
                      {session.pending === true && <Clock className="h-3 w-3 text-amber-500" />}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </section>
      </div>

      {actionMenu.isOpen && (
        <div
          ref={actionMenuRef}
          className="fixed z-[80] min-w-[170px] rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ left: actionMenu.x, top: actionMenu.y }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
            onClick={() => {
              if (activeWorkflow) {
                void handleRenameWorkflow(activeWorkflow);
                return;
              }
              if (activeSession) {
                void handleRenameSession(activeSession);
              }
            }}
          >
            <Edit3 className="h-4 w-4" />
            改名
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
            onClick={() => {
              if (activeWorkflow) {
                void handleToggleWorkflowFavorite(activeWorkflow);
                return;
              }
              if (activeSession) {
                void handleToggleSessionFavorite(activeSession);
              }
            }}
          >
            <Star className="h-4 w-4" />
            {activeWorkflow
              ? (activeWorkflow.favorite === true ? '取消收藏' : '收藏')
              : (activeSession?.favorite === true ? '取消收藏' : '收藏')}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
            onClick={() => {
              if (activeWorkflow) {
                void handleToggleWorkflowPending(activeWorkflow);
                return;
              }
              if (activeSession) {
                void handleToggleSessionPending(activeSession);
              }
            }}
          >
            <Clock className="h-4 w-4" />
            {activeWorkflow
              ? (activeWorkflow.pending === true ? '取消待处理' : '待办')
              : (activeSession?.pending === true ? '取消待处理' : '待办')}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            onClick={() => {
              if (activeWorkflow) {
                void handleDeleteWorkflow(activeWorkflow);
                return;
              }
              if (activeSession) {
                void handleDeleteSession(activeSession);
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
            {actionMenu.kind === 'workflow' ? '删除工作流' : '删除'}
          </button>
          {activeWorkflow && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onWorkflowSelect(project, activeWorkflow);
                closeActionMenu();
              }}
            >
              <Eye className="h-4 w-4" />
              打开详情
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className="absolute inset-y-0 right-[-3px] z-10 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none"
        aria-label="调整左侧导航宽度"
        {...resizeHandleProps}
      />
    </div>
  );
}
