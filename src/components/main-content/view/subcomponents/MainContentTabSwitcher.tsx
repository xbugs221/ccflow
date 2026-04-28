import { MessageSquare, Terminal, Folder, GitBranch, ClipboardCheck, type LucideIcon } from 'lucide-react';
import Tooltip from '../../../Tooltip';
import type { AppTab } from '../../../../types/app';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  compact?: boolean;
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
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  const tabs = shouldShowTasksTab ? [...BASE_TABS, TASKS_TAB] : BASE_TABS;

  return (
    <div
      className={`rounded-lg bg-muted/60 ${
        compact
          ? 'inline-flex items-center gap-[2px] p-[3px]'
          : 'grid w-full p-1 sm:inline-flex sm:w-auto sm:grid-cols-none sm:items-center sm:gap-[2px] sm:p-[3px]'
      }`}
      style={compact ? undefined : { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === activeTab;

        return (
          <Tooltip key={tab.id} content={t(tab.labelKey)} position="bottom">
            <button
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex min-w-0 touch-manipulation items-center justify-center rounded-md font-medium transition-all duration-150 ${
                compact
                  ? 'h-9 w-9 flex-none px-0 py-0'
                  : 'min-h-11 w-full gap-2 px-4 py-2.5 text-[15px] sm:min-h-9 sm:w-auto sm:flex-none sm:gap-1.5 sm:px-2.5 sm:py-[5px] sm:text-sm'
              } ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className={`flex-shrink-0 ${compact ? 'h-4 w-4' : 'h-[18px] w-[18px] sm:h-4 sm:w-4'}`} strokeWidth={isActive ? 2.2 : 1.8} />
              {!compact && <span className="hidden md:inline truncate">{t(tab.labelKey)}</span>}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
