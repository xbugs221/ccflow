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
import { ChevronDown, ChevronUp, Workflow } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../ui/button';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectWorkflow } from '../../../../types/app';
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

/**
 * PURPOSE: Prefer the freshest workflow activity when choosing recent items.
 */
function getWorkflowUpdatedAt(workflow: ProjectWorkflow): number {
  return new Date(String(workflow.updatedAt || 0)).getTime();
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
    .sort((left, right) => compareWorkflowBySortMode(left, right, 'created' as WorkflowCardSortMode));

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
	                    className="rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
	                    onClick={() => {
	                      handleWorkflowClick(workflow);
	                      closeWorkflowActionMenu();
	                    }}
	                  >
	                    打开详情
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
