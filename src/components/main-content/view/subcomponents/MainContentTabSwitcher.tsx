/**
 * PURPOSE: Layout control buttons for the main workspace dock panels.
 * Renders icon-only controls that keep accessible names for dock tab actions.
 */
import { MessageSquare, Terminal, Folder, GitBranch, ClipboardCheck, type LucideIcon } from 'lucide-react';
import Tooltip from '../../../ui/Tooltip';
import type { AppTab } from '../../../../types/app';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { DockLayoutControl } from '../../types/types';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  compact?: boolean;
  dockLayout?: DockLayoutControl;
};

type TabDefinition = {
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

const BASE_TABS: TabDefinition[] = [
  { id: 'chat', labelKey: 'tabs.chat', icon: MessageSquare },
  { id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { id: 'files', labelKey: 'tabs.files', icon: Folder },
  { id: 'git', labelKey: 'tabs.git', icon: GitBranch },
];

const TASKS_TAB: TabDefinition = {
  id: 'tasks',
  labelKey: 'tabs.tasks',
  icon: ClipboardCheck,
};

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  compact = false,
  dockLayout,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  const tabs = shouldShowTasksTab ? [...BASE_TABS, TASKS_TAB] : BASE_TABS;

  const isTabActive = (tabId: AppTab): boolean => {
    /**
     * Desktop dock buttons are controls, not primary tab selections. Mobile
     * callers do not pass dockLayout, so they keep the single-view behavior.
     */
    if (tabId === 'chat') return activeTab === 'chat';
    if (tabId === 'tasks') return activeTab === 'tasks';
    if (tabId === 'preview') return activeTab === 'preview';

    if (dockLayout && (tabId === 'files' || tabId === 'git' || tabId === 'shell')) {
      return false;
    }

    return tabId === activeTab;
  };

  const handleTabClick = (tabId: AppTab) => {
    if (tabId === 'chat') {
      setActiveTab('chat');
      // Focus chat input or scroll to chat area could be added here
    } else if (tabId === 'files') {
      setActiveTab('files');
    } else if (tabId === 'git') {
      setActiveTab('git');
    } else if (tabId === 'shell') {
      setActiveTab('shell');
    } else {
      setActiveTab(tabId);
    }
  };

  return (
    <div
      className={`rounded-lg bg-muted/60 ${
        compact
          ? 'inline-flex items-center gap-[2px] p-[3px]'
          : 'inline-flex w-auto items-center gap-[2px] p-[3px]'
      }`}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = isTabActive(tab.id);
        const label = t(tab.labelKey);

        return (
          <Tooltip key={tab.id} content={label} position="bottom">
            <button
              onClick={() => handleTabClick(tab.id)}
              className={`relative flex h-9 w-9 flex-none touch-manipulation items-center justify-center rounded-md p-0 transition-all duration-150 ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label={label}
              aria-pressed={isActive}
              title={label}
              data-testid={`tab-${tab.id}`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
