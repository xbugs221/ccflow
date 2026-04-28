/**
 * PURPOSE: Render the per-project workflow list inside the left sidebar with
 * local "show more" expansion and direct workflow creation.
 */
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Plus, Star, Clock, Workflow, Edit2, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../ui/button';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectWorkflow } from '../../../../types/app';
import { api } from '../../../../utils/api';
import { buildProjectWorkflowRoute } from '../../../../utils/projectRoute';

const DEFAULT_VISIBLE_WORKFLOWS = 5;
const WORKFLOW_ACTION_LONG_PRESS_MS = 450;

type WorkflowActionMenuState =
  | { isOpen: false; workflowId: null; x: number; y: number }
  | { isOpen: true; workflowId: string; x: number; y: number };

type SidebarProjectWorkflowsProps = {
  project: Project;
  isExpanded: boolean;
  selectedWorkflow?: ProjectWorkflow | null;
  onProjectSelect: (project: Project) => void;
  onWorkflowSelect?: (project: Project, workflow: ProjectWorkflow) => void;
  onNewSession: (project: Project, provider?: 'claude' | 'codex', options?: Record<string, unknown>) => void;
  t: TFunction;
};

function compareWorkflowPriority(
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
 * PURPOSE: Prefer the freshest workflow activity when choosing recent items.
 */
function getWorkflowUpdatedAt(workflow: ProjectWorkflow): number {
  return new Date(String(workflow.updatedAt || 0)).getTime();
}

/**
 * PURPOSE: Render workflow status lights from completion state instead of
 * user-specific unread state.
 */
function isWorkflowFinished(workflow: ProjectWorkflow): boolean {
  const stageStatusMap = new Map((workflow.stageStatuses || []).map((stage) => [stage.key, stage.status]));
  return workflow.runState === 'completed'
    || stageStatusMap.get('archive') === 'completed'
    || stageStatusMap.get('verification') === 'completed';
}

export default function SidebarProjectWorkflows({
  project,
  isExpanded,
  selectedWorkflow,
  onProjectSelect,
  onWorkflowSelect,
  onNewSession: _onNewSession,
  t,
}: SidebarProjectWorkflowsProps) {
  const navigate = useNavigate();
  const [showAllLocal, setShowAllLocal] = useState(false);
  const [workflowActionMenu, setWorkflowActionMenu] = useState<WorkflowActionMenuState>({
    isOpen: false,
    workflowId: null,
    x: 0,
    y: 0,
  });
  const [composerOpen, setComposerOpen] = useState(false);
  const [workflowTitleInput, setWorkflowTitleInput] = useState('');
  const [workflowObjectiveInput, setWorkflowObjectiveInput] = useState('');
  const [availableOpenSpecChanges, setAvailableOpenSpecChanges] = useState<string[]>([]);
  const [selectedOpenSpecChange, setSelectedOpenSpecChange] = useState('');
  const [isLoadingOpenSpecChanges, setIsLoadingOpenSpecChanges] = useState(false);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);
  const [composerError, setComposerError] = useState('');
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);

  const workflows = [...(project.workflows || [])]
    .filter((workflow) => workflow.hidden !== true)
    .sort((left, right) => {
      const priority = compareWorkflowPriority(left, right);
      if (priority !== 0) {
        return priority;
      }
      return getWorkflowUpdatedAt(right) - getWorkflowUpdatedAt(left);
    });

  const hasWorkflows = workflows.length > 0;
  const hasHiddenWorkflows = workflows.length > DEFAULT_VISIBLE_WORKFLOWS;
  const visibleWorkflows = showAllLocal ? workflows : workflows.slice(0, DEFAULT_VISIBLE_WORKFLOWS);
  const hiddenCount = workflows.length - DEFAULT_VISIBLE_WORKFLOWS;

  const openWorkflowComposer = async () => {
    /**
     * PURPOSE: Open the sidebar workflow composer and preload adoptable
     * OpenSpec changes so the left navigation has feature parity with the
     * project overview composer.
     */
    setComposerOpen(true);
    setComposerError('');
    setIsLoadingOpenSpecChanges(true);
    try {
      const response = await api.projectOpenSpecChanges(project.name);
      const payload = response.ok ? await response.json() : [];
      const changes = Array.isArray(payload) ? payload.filter((item) => typeof item === 'string') : [];
      setAvailableOpenSpecChanges(changes);
      setSelectedOpenSpecChange((current) => (changes.includes(current) ? current : ''));
    } catch (error) {
      console.error('Error loading OpenSpec changes from sidebar project list:', error);
      setAvailableOpenSpecChanges([]);
      setSelectedOpenSpecChange('');
      setComposerError('无法读取可接手的 OpenSpec 提案。');
    } finally {
      setIsLoadingOpenSpecChanges(false);
    }
  };

  const closeWorkflowComposer = () => {
    setComposerOpen(false);
    setWorkflowTitleInput('');
    setWorkflowObjectiveInput('');
    setAvailableOpenSpecChanges([]);
    setSelectedOpenSpecChange('');
    setComposerError('');
  };

  /**
   * PURPOSE: Create a workflow directly from the project row.
   */
  const handleCreateWorkflow = async () => {
    const title = workflowTitleInput.trim();
    const objective = workflowObjectiveInput.trim();
    if (!title) {
      setComposerError('请先填写摘要。');
      return;
    }
    if (!objective) {
      setComposerError('请先填写需求正文。');
      return;
    }

    try {
      setIsCreatingWorkflow(true);
      setComposerError('');
      const openspecChangeName = selectedOpenSpecChange.trim();
      const response = await api.createProjectWorkflow(project.name, {
        title,
        objective,
        openspecChangeName: openspecChangeName || undefined,
      });
      if (!response.ok) {
        setComposerError('创建工作流失败，请稍后重试。');
        return;
      }

      const workflow = await response.json();
      await window.refreshProjects?.();
      closeWorkflowComposer();
      navigate(buildProjectWorkflowRoute(project, workflow));
    } catch (error) {
      console.error('Error creating workflow from sidebar project list:', error);
      setComposerError('创建工作流失败，请稍后重试。');
    } finally {
      setIsCreatingWorkflow(false);
    }
  };

  /**
   * PURPOSE: Collapse the contextual workflow action menu.
   */
  const closeWorkflowActionMenu = () => {
    setWorkflowActionMenu((current) => (
      current.isOpen
        ? {
            isOpen: false,
            workflowId: null,
            x: current.x,
            y: current.y,
          }
        : current
    ));
  };

  /**
   * PURPOSE: Open the contextual workflow action menu for a specific row.
   */
  const openWorkflowActionMenu = (workflowId: string, x: number, y: number) => {
    setWorkflowActionMenu({ isOpen: true, workflowId, x, y });
  };

  /**
   * PURPOSE: Refresh the project list after mutating workflow metadata.
   */
  const refreshProject = async () => {
    await window.refreshProjects?.();
  };

  /**
   * PURPOSE: Toggle the workflow favorite flag from the contextual menu.
   */
  const handleToggleWorkflowFavorite = async (workflow: ProjectWorkflow) => {
    closeWorkflowActionMenu();
    await api.updateProjectWorkflowUiState(project.name, workflow.id, {
      favorite: workflow.favorite !== true,
      pending: workflow.pending === true,
      hidden: workflow.hidden === true,
    });
    await refreshProject();
  };

  /**
   * PURPOSE: Start workflow rename from the contextual menu.
   */
  const handleRenameWorkflow = async (workflow: ProjectWorkflow) => {
    const nextTitle = window.prompt('请输入新的工作流名称', String(workflow.title || '').trim());
    closeWorkflowActionMenu();
    if (nextTitle == null) {
      return;
    }

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === workflow.title) {
      return;
    }

    await api.renameProjectWorkflow(project.name, workflow.id, trimmedTitle);
    await refreshProject();
  };

  /**
   * PURPOSE: Delete a workflow only after explicit confirmation.
   */
  const handleDeleteWorkflow = async (workflow: ProjectWorkflow) => {
    closeWorkflowActionMenu();
    if (!window.confirm(`确定删除工作流“${workflow.title}”吗？此操作无法撤销。`)) {
      return;
    }

    await api.deleteProjectWorkflow(project.name, workflow.id);
    await refreshProject();
  };

  /**
   * PURPOSE: Clear any pending mobile long-press timer.
   */
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  /**
   * PURPOSE: Open the workflow menu after a mobile long press.
   */
  const handleWorkflowTouchStart = (workflowId: string, event: ReactTouchEvent<HTMLButtonElement>) => {
    const touch = event.touches[0];
    const target = event.currentTarget;
    const touchPoint = touch ? { x: touch.clientX, y: touch.clientY } : null;
    touchStartPointRef.current = touchPoint;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      suppressNextClickRef.current = true;
      const bounds = target.getBoundingClientRect();
      openWorkflowActionMenu(
        workflowId,
        touchPoint?.x ?? bounds.left + bounds.width / 2,
        touchPoint?.y ?? bounds.top + bounds.height / 2,
      );
      clearLongPressTimer();
    }, WORKFLOW_ACTION_LONG_PRESS_MS);
  };

  /**
   * PURPOSE: Stop long-press tracking once the user lifts their finger.
   */
  const handleWorkflowTouchEnd = () => {
    touchStartPointRef.current = null;
    clearLongPressTimer();
  };

  /**
   * PURPOSE: Keep long-press tolerant of small jitter while allowing scroll.
   */
  const handleWorkflowTouchMove = (event: ReactTouchEvent<HTMLButtonElement>) => {
    const startPoint = touchStartPointRef.current;
    const touch = event.touches[0];
    if (!startPoint || !touch) {
      return;
    }

    const movedX = Math.abs(touch.clientX - startPoint.x);
    const movedY = Math.abs(touch.clientY - startPoint.y);
    if (movedX > 10 || movedY > 10) {
      handleWorkflowTouchEnd();
    }
  };

  /**
   * PURPOSE: Only select the workflow when the tap was not consumed by long press.
   */
  const handleWorkflowClick = (workflow: ProjectWorkflow) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    onProjectSelect(project);
    onWorkflowSelect?.(project, workflow);
  };

  /**
   * PURPOSE: Expose workflow actions behind right-click on desktop.
   */
  const handleWorkflowContextMenu = (workflowId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openWorkflowActionMenu(workflowId, event.clientX, event.clientY);
  };

  useEffect(() => {
    if (!workflowActionMenu.isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      closeWorkflowActionMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeWorkflowActionMenu();
      }
    };

    const handleScroll = () => {
      closeWorkflowActionMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [workflowActionMenu.isOpen]);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, []);

  if (!isExpanded || !onWorkflowSelect) {
    return null;
  }

  return (
    <div data-testid="project-workflow-group" className="ml-3 space-y-1 border-l border-border pl-3">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <div className="flex items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
          <h4 className="text-xs font-medium text-foreground">需求工作流</h4>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => void openWorkflowComposer()}
        >
          <Plus className="h-3 w-3" />
          新建
        </Button>
      </div>

      {composerOpen && (
        <div className="space-y-2 rounded-md border border-border/60 bg-background p-2">
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
              className="min-h-20 rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
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
          {composerError && <p className="text-xs text-destructive">{composerError}</p>}
          <div className="flex items-center justify-end gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={closeWorkflowComposer} disabled={isCreatingWorkflow}>
              取消
            </Button>
            <Button type="button" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void handleCreateWorkflow()} disabled={isCreatingWorkflow}>
              {isCreatingWorkflow ? '创建中' : '创建'}
            </Button>
          </div>
        </div>
      )}

      {!hasWorkflows ? (
        <div className="py-2 px-3 text-left">
          <p className="text-xs text-muted-foreground">暂无需求工作流</p>
        </div>
      ) : (
        visibleWorkflows.map((workflow) => {
            const isSelected = selectedWorkflow?.id === workflow.id;
            const isActionMenuOpen = workflowActionMenu.isOpen && workflowActionMenu.workflowId === workflow.id;
            const workflowFinished = isWorkflowFinished(workflow);
            return (
            <div key={workflow.id} className="relative">
              <button
                type="button"
                className={cn(
                  'w-full rounded-md border px-3 py-2 text-left transition-colors',
                  isSelected ? 'border-primary bg-primary/10' : 'border-border/40 bg-background hover:bg-accent/40',
                )}
                onClick={() => handleWorkflowClick(workflow)}
                onContextMenu={(event) => handleWorkflowContextMenu(workflow.id, event)}
                onTouchStart={(event) => handleWorkflowTouchStart(workflow.id, event)}
                onTouchEnd={handleWorkflowTouchEnd}
                onTouchCancel={handleWorkflowTouchEnd}
                onTouchMove={handleWorkflowTouchMove}
                data-workflow-surface="true"
              >
                <div className="truncate text-xs font-medium text-foreground">
                  {workflow.title}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {workflow.favorite === true && <Star className="h-3 w-3 fill-current text-yellow-500" />}
                  {workflow.pending === true && <Clock className="h-3 w-3 text-amber-500" />}
                  <span>{workflow.stage}</span>
                  <span
                    className={cn(
                      'inline-flex h-2 w-2 rounded-full',
                      workflowFinished ? 'bg-emerald-500' : 'bg-amber-500',
                    )}
                    title={workflowFinished ? '工作流已结束' : '工作流进行中'}
                  />
                </div>
              </button>
              {isActionMenuOpen && (
                <div
                  ref={actionMenuRef}
                  className="fixed z-[80] flex items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-lg"
                  style={{ left: workflowActionMenu.x, top: workflowActionMenu.y }}
                >
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-sm hover:bg-accent"
                    onClick={() => void handleToggleWorkflowFavorite(workflow)}
                    title={workflow.favorite === true ? '取消收藏工作流' : '收藏工作流'}
                    aria-label={workflow.favorite === true ? '取消收藏工作流' : '收藏工作流'}
                  >
                    <Star
                      className={cn(
                        'h-4 w-4',
                        workflow.favorite === true
                          ? 'fill-current text-yellow-500 dark:text-yellow-400'
                          : 'text-yellow-600/70 dark:text-yellow-500/70',
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-sm hover:bg-accent"
                    onClick={() => void handleRenameWorkflow(workflow)}
                    title="重命名工作流"
                    aria-label="重命名工作流"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    onClick={() => void handleDeleteWorkflow(workflow)}
                    title="删除工作流"
                    aria-label="删除工作流"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {hasWorkflows && hasHiddenWorkflows && !showAllLocal && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-center gap-2 text-xs text-muted-foreground"
          onClick={() => setShowAllLocal(true)}
        >
          <ChevronDown className="h-3 w-3" />
          {t('sessions.showMore')} ({hiddenCount})
        </Button>
      )}

      {hasWorkflows && hasHiddenWorkflows && showAllLocal && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-center gap-2 text-xs text-muted-foreground"
          onClick={() => setShowAllLocal(false)}
        >
          <ChevronUp className="h-3 w-3" />
          {t('sessions.showLess')}
        </Button>
      )}
    </div>
  );
}
