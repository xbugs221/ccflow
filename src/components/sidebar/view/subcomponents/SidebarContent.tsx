/**
 * PURPOSE: Render the full project sidebar, including header controls,
 * scrollable project navigation, and desktop resize affordance.
 */
import { ScrollArea } from '../../../ui/scroll-area';
import type { TFunction } from 'i18next';
import type { Project } from '../../../../types/app';
import { useResizableWidth } from '../../../../hooks/useResizableWidth';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  onShowSettings: () => void;
  onOpenChatHistorySearch: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  projects,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  onShowSettings,
  onOpenChatHistorySearch,
  projectListProps,
  t,
}: SidebarContentProps) {
  /**
   * PURPOSE: Keep desktop project navigation adjustable while preserving the
   * fixed mobile drawer width controlled by AppContent.
   */
  const { width, resizeHandleProps } = useResizableWidth({
    storageKey: 'ccflow:sidebar-width',
    defaultWidth: 288,
    minWidth: 224,
    maxWidth: 520,
  });

  return (
    <div
      className="relative h-full flex flex-col bg-background/80 backdrop-blur-sm md:select-none"
      style={isMobile ? undefined : { width }}
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        projectsCount={projects.length}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        onShowSettings={onShowSettings}
        onOpenChatHistorySearch={onOpenChatHistorySearch}
        t={t}
      />

      <ScrollArea className="flex-1 md:px-1.5 md:py-2 overflow-y-auto overscroll-contain">
        <SidebarProjectList {...projectListProps} />
      </ScrollArea>
      {!isMobile && (
        <button
          type="button"
          className="absolute inset-y-0 right-[-3px] z-10 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none"
          aria-label="调整左侧导航宽度"
          {...resizeHandleProps}
        />
      )}
    </div>
  );
}
