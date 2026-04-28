import { Settings } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarFooterProps = {
  onShowSettings: () => void;
  t: TFunction;
};

export default function SidebarFooter({
  onShowSettings,
  t,
}: SidebarFooterProps) {
  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Settings */}
      <div className="nav-divider" />

      {/* Desktop settings */}
      <div className="hidden md:block px-2 py-1.5">
        <button
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          onClick={onShowSettings}
        >
          <Settings className="w-3.5 h-3.5" />
          <span className="text-sm">{t('actions.settings')}</span>
        </button>
      </div>

      {/* Mobile settings */}
      <div className="md:hidden p-3 pb-20">
        <button
          className="w-full h-12 bg-muted/40 hover:bg-muted/60 rounded-xl flex items-center gap-3.5 px-4 active:scale-[0.98] transition-all"
          onClick={onShowSettings}
        >
          <div className="w-8 h-8 rounded-xl bg-background/80 flex items-center justify-center">
            <Settings className="w-4.5 h-4.5 text-muted-foreground" />
          </div>
          <span className="text-base font-medium text-foreground">{t('actions.settings')}</span>
        </button>
      </div>
    </div>
  );
}
