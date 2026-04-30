/**
 * PURPOSE: Render a horizontal icon sequence showing workflow stage progress.
 * Each stage is mapped to a lucide icon and colored by its status:
 * green for completed, blue for currently running, gray for not started.
 */
import { Archive, Circle, Eye, FileText, Play, Wrench } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { WorkflowStageStatus } from '../../types/app';

const STAGE_ICON_MAP: Record<string, React.ComponentType<any>> = {
  planning: FileText,
  execution: Play,
  review_1: Eye,
  repair_1: Wrench,
  review_2: Eye,
  repair_2: Wrench,
  review_3: Eye,
  repair_3: Wrench,
  archive: Archive,
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

interface WorkflowStageProgressProps {
  stageStatuses: WorkflowStageStatus[];
  size?: 'sm' | 'md';
}

export default function WorkflowStageProgress({ stageStatuses, size = 'md' }: WorkflowStageProgressProps) {
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  if (!stageStatuses || stageStatuses.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-0.5" aria-label="工作流阶段进度">
      {stageStatuses.map((stage) => {
        const Icon = STAGE_ICON_MAP[stage.key] || Circle;
        return (
          <Icon
            key={stage.key}
            className={cn(iconSize, getStageTone(stage.status))}
            title={`${stage.label}: ${stage.status}`}
            aria-label={`${stage.label}: ${stage.status}`}
          />
        );
      })}
    </div>
  );
}
