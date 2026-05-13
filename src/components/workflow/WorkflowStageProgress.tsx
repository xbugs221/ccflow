/**
 * PURPOSE: Render a horizontal icon sequence showing workflow stage progress.
 * Repeated review and repair rounds are collapsed into one stable icon with a
 * count so workflow cards stay readable across multiple review loops.
 */
import { Archive, Circle, Eye, FileText, Play, Wrench } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { WorkflowStageStatus } from '../../types/app';

const STAGE_ICON_MAP: Record<string, React.ComponentType<any>> = {
  planning: FileText,
  execution: Play,
  review: Eye,
  repair: Wrench,
  archive: Archive,
};

type DisplayStage = {
  key: string;
  label: string;
  status: string;
  count: number;
};

/**
 * Map workflow stage execution state to the progress icon color.
 */
function getStageTone(status: string): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') {
    return 'text-green-500';
  }
  if (normalized === 'active' || normalized === 'running' || normalized === 'blocked' || normalized === 'failed') {
    return 'text-blue-500';
  }
  return 'text-muted-foreground/40';
}

/**
 * Classify repeated wo review/fix stages into the single visual slot that
 * represents the role in compact project and sidebar cards.
 */
function getDisplayStageKey(stageKey: string): string {
  if (/^review_\d+$/.test(stageKey)) {
    return 'review';
  }
  if (/^(repair|fix)_\d+$/.test(stageKey)) {
    return 'repair';
  }
  return stageKey;
}

/**
 * Merge repeated stages while preserving the original ordering of the workflow
 * and giving active or failed rounds priority in the visible status color.
 */
function buildDisplayStages(stageStatuses: WorkflowStageStatus[]): DisplayStage[] {
  const stages = new Map<string, DisplayStage>();
  for (const stage of stageStatuses) {
    const key = getDisplayStageKey(stage.key);
    const previous = stages.get(key);
    if (!previous) {
      stages.set(key, {
        key,
        label: key === 'review' ? '审核' : key === 'repair' ? '修复' : stage.label,
        status: stage.status,
        count: 1,
      });
      continue;
    }

    previous.count += 1;
    const normalized = String(stage.status || '').toLowerCase();
    const currentStatus = String(previous.status || '').toLowerCase();
    if (normalized === 'active' || normalized === 'running' || normalized === 'blocked' || normalized === 'failed') {
      previous.status = stage.status;
    } else if (currentStatus !== 'active' && currentStatus !== 'running' && currentStatus !== 'blocked' && currentStatus !== 'failed') {
      previous.status = stage.status;
    }
  }
  return [...stages.values()];
}

interface WorkflowStageProgressProps {
  stageStatuses: WorkflowStageStatus[];
  size?: 'sm' | 'md';
}

export default function WorkflowStageProgress({ stageStatuses, size = 'md' }: WorkflowStageProgressProps) {
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  if (!stageStatuses || stageStatuses.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-0.5" aria-label="工作流阶段进度">
      {buildDisplayStages(stageStatuses).map((stage) => {
        const Icon = STAGE_ICON_MAP[stage.key] || Circle;
        return (
          <span
            key={stage.key}
            className="inline-flex items-center gap-0.5"
            data-testid={`workflow-stage-progress-${stage.key}`}
            title={`${stage.label}: ${stage.status}`}
            aria-label={`${stage.label}: ${stage.status}${stage.count > 1 || stage.key === 'review' || stage.key === 'repair' ? ` x${stage.count}` : ''}`}
          >
            <Icon className={cn(iconSize, getStageTone(stage.status))} aria-hidden="true" />
            {(stage.key === 'review' || stage.key === 'repair') ? (
              <span className={cn('font-medium tabular-nums text-muted-foreground', textSize)}>
                x{stage.count}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
