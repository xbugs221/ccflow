import { FolderPlus, PanelLeftClose, RefreshCw, Search, Settings } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarFooterProps = {
  isMobile: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  onShowSettings: () => void;
  onOpenChatHistorySearch: () => void;
  t: TFunction;
};

export default function SidebarFooter({
  isMobile,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  onShowSettings,
  onOpenChatHistorySearch,
  t,
}: SidebarFooterProps) {
  /**
   * Render sidebar actions below the project list so the header stays focused
   * on product identity.
   */
  const actions = [
    {
      key: 'refresh',
      label: t('tooltips.refresh'),
      icon: <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />,
      onClick: onRefresh,
      disabled: isRefreshing,
    },
    {
      key: 'create',
      label: t('tooltips.createProject'),
      icon: <FolderPlus className="w-4 h-4" />,
      onClick: onCreateProject,
    },
    {
      key: 'chat-search',
      label: t('search.placeholder'),
      icon: <Search className="w-4 h-4" />,
      onClick: onOpenChatHistorySearch,
      testId: 'open-chat-history-search',
    },
    {
      key: 'settings',
      label: t('actions.settings'),
      icon: <Settings className="w-4 h-4" />,
      onClick: onShowSettings,
    },
    ...(!isMobile ? [{
      key: 'collapse',
      label: t('tooltips.hideSidebar'),
      icon: <PanelLeftClose className="w-4 h-4" />,
      onClick: onCollapseSidebar,
    }] : []),
  ];

  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      <div className="nav-divider" />

      <div className="hidden md:block px-2 py-1.5">
        <div className="grid grid-cols-5 gap-1">
          {actions.map((action) => (
            <button
              key={action.key}
              data-testid={action.testId}
              className="h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors flex items-center justify-center disabled:opacity-50"
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.label}
              aria-label={action.label}
            >
              {action.icon}
            </button>
          ))}
        </div>
      </div>

      <div className="md:hidden p-3 pb-20">
        <div className="grid grid-cols-4 gap-2">
          {actions.map((action) => (
            <button
              key={action.key}
              data-testid={action.testId}
              className="h-11 rounded-xl bg-muted/40 hover:bg-muted/60 active:scale-[0.98] transition-all text-muted-foreground flex items-center justify-center disabled:opacity-50"
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.label}
              aria-label={action.label}
            >
              {action.icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
