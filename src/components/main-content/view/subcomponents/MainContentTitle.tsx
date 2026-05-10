/**
 * PURPOSE: Render the main content header title for project and chat views.
 * The session provider icon is intentionally omitted here because it drifts
 * from the real provider state during session creation and first message send.
 */
import { useTranslation } from 'react-i18next';
import type { AppTab, Project, ProjectSession, ProjectWorkflow } from '../../../../types/app';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  shouldShowTasksTab: boolean;
};

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string) {
  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'codex') {
    return (session.summary as string) || (session.name as string) || 'Codex Session';
  }

  return (session.summary as string) || (session.name as string) || 'New Session';
}

function isTemporaryOrRouteSessionId(sessionId: string): boolean {
  /**
   * Reject ccflow-only session identifiers that cannot be passed to provider resume commands.
   */
  return /^(c\d+|new-session-)/.test(sessionId);
}

function hasProviderResumeIdentity(session: ProjectSession): boolean {
  /**
   * Only provider-backed sessions should render a resume identifier in the title.
   */
  return session.__provider === 'codex'
    || session.__provider === 'opencode'
    || session.provider === 'codex'
    || session.provider === 'opencode';
}

function getSessionResumeId(session: ProjectSession | null): string {
  /**
   * Return the provider resume id without provider CLI prefixes or flags.
   */
  if (!session) {
    return '';
  }

  const providerSessionId = typeof session.providerSessionId === 'string' ? session.providerSessionId.trim() : '';
  if (providerSessionId) {
    return providerSessionId;
  }

  const directSessionId = typeof session.id === 'string' ? session.id.trim() : '';
  if (!directSessionId || isTemporaryOrRouteSessionId(directSessionId) || !hasProviderResumeIdentity(session)) {
    return '';
  }

  return directSessionId;
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  selectedWorkflow,
  shouldShowTasksTab,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const showMessagePlaceholder = activeTab === 'chat' && !selectedSession && !selectedWorkflow;
  const resumeId = getSessionResumeId(selectedSession);

  return (
    <div className="min-w-0 flex items-center gap-2 flex-1 overflow-x-auto scrollbar-hide">
      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <>
            <h2 className="text-sm font-semibold text-foreground whitespace-nowrap overflow-x-auto scrollbar-hide leading-tight">
              {getSessionTitle(selectedSession)}
            </h2>
            {selectedProject && (
              <div className="mt-1 text-xs leading-tight text-muted-foreground">
                {selectedProject.displayName || selectedProject.name}
              </div>
            )}
            {resumeId && (
              <div className="mt-1 overflow-x-auto scrollbar-hide text-[11px] leading-tight text-muted-foreground">
                <code className="whitespace-nowrap font-mono">{resumeId}</code>
              </div>
            )}
          </>
        ) : activeTab === 'chat' && selectedWorkflow ? (
          <h2 className="text-sm font-semibold text-foreground whitespace-nowrap overflow-x-auto scrollbar-hide leading-tight">
            {selectedWorkflow.title || t('tabs.chat')}
          </h2>
        ) : showMessagePlaceholder ? (
          <h2 className="text-base font-semibold text-foreground leading-tight">{t('tabs.chat')}</h2>
        ) : (
          <h2 className="text-sm font-semibold text-foreground leading-tight">
            {getTabTitle(activeTab, shouldShowTasksTab, t)}
          </h2>
        )}
      </div>
    </div>
  );
}
