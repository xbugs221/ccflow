/**
 * PURPOSE: Render the per-project workflow navigation list inside the left
 * sidebar while leaving sorting and creation controls on the project overview.
 */
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { ChevronDown, ChevronUp, Star, Clock, Workflow, Edit2, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../ui/button';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectWorkflow } from '../../../../types/app';
import { api } from '../../../../utils/api';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import WorkflowStageProgress from '../../../workflow/WorkflowStageProgress';

const DEFAULT_VISIBLE_WORKFLOWS = 5;
const WORKFLOW_ACTION_LONG_PRESS_MS = 450;
type WorkflowCardSortMode = 'created' | 'updated' | 'title' | 'provider';

type WorkflowActionMenuState =
  | { isOpen: false; workflowId: null; x: number; y: number }
  | { isOpen: true; workflowId: string; x: number; y: number };

type SidebarProjectWorkflowsProps = {
  project: Project;
  isExpanded: boolean;
  selectedWorkflow?: ProjectWorkflow | null;
  onProjectSelect: (project: Project) => void;
  onWorkflowSelect?: (project: Project, workflow: ProjectWorkflow) => void;
  currentTime: Date;
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

function isWorkflowScheduledPending(workflow: ProjectWorkflow): boolean {
  const scheduledAt = workflow.scheduledAt;
  if (!scheduledAt) return false;
  const scheduledTime = new Date(scheduledAt).getTime();
  return Number.isFinite(scheduledTime) && Date.now() < scheduledTime;
}

function formatWorkflowScheduleTime(workflow: ProjectWorkflow): string {
  const scheduledAt = workflow.scheduledAt;
  if (!scheduledAt) return '';
  const date = new Date(scheduledAt);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

/**
 * PURPOSE: Sort workflow cards by the selected visible field without changing route ids.
 */
function compareWorkflowBySortMode(
  left: ProjectWorkflow,
  right: ProjectWorkflow,
  mode: WorkflowCardSortMode,
): number {
  if (mode === 'updated') {
    return getWorkflowUpdatedAt(right) - getWorkflowUpdatedAt(left);
  }

  if (mode === 'title') {
    return String(left.title || '').localeCompare(String(right.title || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  if (mode === 'provider') {
    const leftProvider = String(left.provider || left.ownerProvider || left.childSessions?.[0]?.provider || '');
    const rightProvider = String(right.provider || right.ownerProvider || right.childSessions?.[0]?.provider || '');
    return leftProvider.localeCompare(rightProvider) || String(left.title || '').localeCompare(String(right.title || ''));
  }

  return Number(right.routeIndex || 0) - Number(left.routeIndex || 0);
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
  currentTime,
  t,
}: SidebarProjectWorkflowsProps) {
  const [showAllLocal, setShowAllLocal] = useState(false);
  const [workflowActionMenu, setWorkflowActionMenu] = useState<WorkflowActionMenuState>({
    isOpen: false,
    workflowId: null,
    x: 0,
    y: 0,
  });
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
      return compareWorkflowBySortMode(left, right, 'created' as WorkflowCardSortMode);
    });

  const hasWorkflows = workflows.length > 0;
  const hasHiddenWorkflows = workflows.length > DEFAULT_VISIBLE_WORKFLOWS;
  const visibleWorkflows = showAllLocal ? workflows : workflows.slice(0, DEFAULT_VISIBLE_WORKFLOWS);
  const hiddenCount = workflows.length - DEFAULT_VISIBLE_WORKFLOWS;

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
      </div>

      {!hasWorkflows ? (
        <div className="py-2 px-3 text-left">
          <p className="text-xs text-muted-foreground">暂无需求工作流</p>
        </div>
      ) : (
        visibleWorkflows.map((workflow) => {
            const isSelected = selectedWorkflow?.id === workflow.id;
            const isActionMenuOpen = workflowActionMenu.isOpen && workflowActionMenu.workflowId === workflow.id;
            return (
            <div key={workflow.id} className="relative">
              <button
                type="button"
                className={cn(
                  'flex w-full min-w-0 flex-col items-start rounded-md border px-3 py-2 text-left transition-colors',
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
                <div className="w-full min-w-0 truncate text-xs font-medium text-foreground">
                  {workflow.title}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {workflow.updatedAt
                    ? formatTimeAgo(workflow.updatedAt, currentTime, t)
                    : '未知时间'}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {workflow.favorite === true && <Star className="h-3 w-3 fill-current text-yellow-500" />}
                  {workflow.pending === true && <Clock className="h-3 w-3 text-amber-500" />}
                  {isWorkflowScheduledPending(workflow) && (
                    <span className="inline-flex items-center gap-1 text-blue-500" title={`定时启动: ${formatWorkflowScheduleTime(workflow)}`}>
                      <Clock className="h-3 w-3" />
                      {formatWorkflowScheduleTime(workflow)}
                    </span>
                  )}
                  <WorkflowStageProgress stageStatuses={workflow.stageStatuses} size="sm" />
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
                    title="改名工作流"
                    aria-label="改名工作流"
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
