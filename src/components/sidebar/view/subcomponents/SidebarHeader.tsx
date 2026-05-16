import type { TFunction } from 'i18next';
import { IS_PLATFORM } from '../../../../constants/config';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  projectsCount: number;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  projectsCount,
  t,
}: SidebarHeaderProps) {
  const LogoBlock = () => (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-7 h-7 bg-primary/90 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 18c2.2-5.4 5.4-8.2 9.6-8.2 1.6 0 3 .3 4.4 1" />
          <path d="M7 8.5 9.2 6.3" />
          <path d="m7 6.3 2.2 2.2" />
          <path d="m18.8 14.3 2.2 2.2" />
          <path d="m18.8 16.5 2.2-2.2" />
          <circle cx="6" cy="17.5" r="1.6" />
          <circle cx="13.5" cy="9" r="1.8" />
          <circle cx="19" cy="17" r="1.7" />
        </svg>
      </div>
      <h1 className="text-sm font-semibold text-foreground tracking-tight truncate">{t('app.title')}</h1>
    </div>
  );

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden md:block px-3 pt-3 pb-2"
        style={{}}
      >
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://cbw.ai/dashboard"
              className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="text-xs text-muted-foreground flex-shrink-0">{projectsCount}</div>
        </div>
      </div>

      {/* Desktop divider */}
      <div className="hidden md:block nav-divider" />

      {/* Mobile header */}
      <div
        className="md:hidden p-3 pb-2"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://cbw.ai/dashboard"
              className="flex items-center gap-2.5 active:opacity-70 transition-opacity min-w-0"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="text-xs text-muted-foreground flex-shrink-0">{projectsCount}</div>
        </div>
      </div>

      {/* Mobile divider */}
      <div className="md:hidden nav-divider" />
    </div>
  );
}
