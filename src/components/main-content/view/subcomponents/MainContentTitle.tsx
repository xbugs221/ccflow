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

function getSessionResumeCommand(session: ProjectSession | null): string {
  /**
   * Build the interactive CLI resume command for the selected provider session.
   */
  if (!session) {
    return '';
  }

  const providerSessionId = typeof session.providerSessionId === 'string' ? session.providerSessionId.trim() : '';
  const directSessionId = typeof session.id === 'string' && !/^(c\d+|new-session-)/.test(session.id)
    ? session.id.trim()
    : '';
  const resumeSessionId = providerSessionId || directSessionId;
  if (!resumeSessionId) {
    return '';
  }

  if (session.__provider === 'codex') {
    return `codex --dangerously-bypass-approvals-and-sandbox resume ${resumeSessionId}`;
  }

  return `claude --dangerously-skip-permissions --resume ${resumeSessionId}`;
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
  const resumeCommand = getSessionResumeCommand(selectedSession);

  return (
    <div className="min-w-0 flex items-center gap-2 flex-1 overflow-x-auto scrollbar-hide">
      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <>
            <h2 className="text-sm font-semibold text-foreground whitespace-nowrap overflow-x-auto scrollbar-hide leading-tight">
              {getSessionTitle(selectedSession)}
            </h2>
            {resumeCommand && (
              <div className="mt-1 overflow-x-auto scrollbar-hide text-[11px] leading-tight text-muted-foreground">
                <code className="whitespace-nowrap font-mono">{resumeCommand}</code>
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
