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

const RefreshIcon = ({ spinning }: { spinning: boolean }) => <svg className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const FolderPlusIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round"/><line x1="12" y1="11" x2="12" y2="17" strokeLinecap="round" strokeLinejoin="round"/><line x1="9" y1="14" x2="15" y2="14" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const SearchIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" strokeLinecap="round" strokeLinejoin="round"/><line x1="21" y1="21" x2="16.65" y2="16.65" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const SettingsIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const PanelLeftCloseIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round"/><line x1="9" y1="3" x2="9" y2="21" strokeLinecap="round" strokeLinejoin="round"/><path d="m16 15-3-3 3-3" strokeLinecap="round" strokeLinejoin="round"/></svg>;

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
      icon: <RefreshIcon spinning={isRefreshing} />,
      onClick: onRefresh,
      disabled: isRefreshing,
    },
    {
      key: 'create',
      label: t('tooltips.createProject'),
      icon: <FolderPlusIcon />,
      onClick: onCreateProject,
    },
    {
      key: 'chat-search',
      label: t('search.placeholder'),
      icon: <SearchIcon />,
      onClick: onOpenChatHistorySearch,
      testId: 'open-chat-history-search',
    },
    {
      key: 'settings',
      label: t('actions.settings'),
      icon: <SettingsIcon />,
      onClick: onShowSettings,
    },
    ...(!isMobile ? [{
      key: 'collapse',
      label: t('tooltips.hideSidebar'),
      icon: <PanelLeftCloseIcon />,
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
