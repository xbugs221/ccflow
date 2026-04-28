import { Search, Settings, PanelLeftOpen } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarCollapsedProps = {
  onExpand: () => void;
  onShowSettings: () => void;
  onOpenChatHistorySearch: () => void;
  t: TFunction;
};

export default function SidebarCollapsed({
  onExpand,
  onShowSettings,
  onOpenChatHistorySearch,
  t,
}: SidebarCollapsedProps) {
  return (
    <div className="h-full flex flex-col items-center py-3 gap-1 bg-background/80 backdrop-blur-sm w-12">
      {/* Expand button with brand logo */}
      <button
        onClick={onExpand}
        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent/80 transition-colors group"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <PanelLeftOpen className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </button>

      <div className="nav-divider w-6 my-1" />

      <button
        onClick={onOpenChatHistorySearch}
        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent/80 transition-colors group"
        aria-label={t('search.placeholder')}
        title={t('search.placeholder')}
      >
        <Search className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </button>

      {/* Settings */}
      <button
        onClick={onShowSettings}
        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent/80 transition-colors group"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </button>
    </div>
  );
}
