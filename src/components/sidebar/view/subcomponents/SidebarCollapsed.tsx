const Search = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const Settings = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
const PanelLeftOpen = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><path d="m13 9 3 3-3 3"/></svg>;
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
        data-testid="open-chat-history-search"
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
