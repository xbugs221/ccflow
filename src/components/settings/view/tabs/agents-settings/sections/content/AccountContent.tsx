// PURPOSE: Render account connection details and provider-scoped quota for one agent.
const LogIn = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10,17 15,12 10,7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>;
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../../../../ui/badge';
import { Button } from '../../../../../../ui/button';
import SessionProviderLogo from '../../../../../../llm-logo-provider/SessionProviderLogo';
import { UsageProviderQuota } from '../../../../UsageOverviewSection';
import type { AgentProvider, AuthStatus } from '../../../../../types/types';

type AccountContentProps = {
  agent: AgentProvider;
  authStatus: AuthStatus;
  onLogin: () => void;
  usageEnabled?: boolean;
};

type AgentVisualConfig = {
  name: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  subtextClass: string;
  buttonClass: string;
  description?: string;
};

const agentConfig: Record<AgentProvider, AgentVisualConfig> = {
  codex: {
    name: 'Codex',
    bgClass: 'bg-gray-100 dark:bg-gray-800/50',
    borderClass: 'border-gray-300 dark:border-gray-600',
    textClass: 'text-gray-900 dark:text-gray-100',
    subtextClass: 'text-gray-700 dark:text-gray-300',
    buttonClass: 'bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600',
  },
  pi: {
    name: 'Pi',
    bgClass: 'bg-violet-50 dark:bg-violet-900/20',
    borderClass: 'border-violet-200 dark:border-violet-800',
    textClass: 'text-violet-900 dark:text-violet-100',
    subtextClass: 'text-violet-700 dark:text-violet-300',
    buttonClass: 'bg-violet-600 hover:bg-violet-700',
  },
};

/**
 * Return the provider account label shown in settings.
 */
function getConnectionLabel(agent: AgentProvider, authStatus: AuthStatus, fallbackLabel: string) {
  return authStatus.email || fallbackLabel;
}

/**
 * Render the selected provider's account status and usage quota together.
 */
export default function AccountContent({
  agent,
  authStatus,
  onLogin,
  usageEnabled = true,
}: AccountContentProps) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agent];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <SessionProviderLogo provider={agent} className="w-6 h-6" />
        <div>
          <h3 className="text-lg font-medium text-foreground">{config.name}</h3>
          <p className="text-sm text-muted-foreground">{t(`agents.account.${agent}.description`)}</p>
        </div>
      </div>

      <div className={`${config.bgClass} border ${config.borderClass} rounded-lg p-4`}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className={`font-medium ${config.textClass}`}>
                {t('agents.connectionStatus')}
              </div>
              <div className={`text-sm ${config.subtextClass}`}>
                {agent === 'pi' && !authStatus.loading ? (
                  authStatus.available
                    ? t('agents.account.pi.cliAvailable', {
                        path: authStatus.commandPath || '',
                        version: authStatus.version || '',
                      })
                    : t('agents.account.pi.cliNotAvailable')
                ) : authStatus.loading ? (
                  t('agents.authStatus.checkingAuth')
                ) : authStatus.authenticated ? (
                  t('agents.authStatus.loggedInAs', {
                    email: getConnectionLabel(agent, authStatus, t('agents.authStatus.authenticatedUser')),
                  })
                ) : (
                  t('agents.authStatus.notConnected')
                )}
              </div>
            </div>
            <div>
              {authStatus.loading ? (
                <Badge variant="secondary" className="bg-gray-100 dark:bg-gray-800">
                  {t('agents.authStatus.checking')}
                </Badge>
              ) : agent === 'pi' ? (
                authStatus.available ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                    {t('agents.account.pi.available')}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                    {t('agents.account.pi.unavailable')}
                  </Badge>
                )
              ) : authStatus.authenticated ? (
                <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  {t('agents.authStatus.connected')}
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                  {t('agents.authStatus.disconnected')}
                </Badge>
              )}
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            {agent === 'pi' ? (
              <div>
                <div className={`font-medium ${config.textClass}`}>
                  {t('agents.account.pi.authenticatedUnknown')}
                </div>
                <div className={`text-sm ${config.subtextClass}`}>
                  {t('agents.account.pi.authNotRequired')}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <div className={`font-medium ${config.textClass}`}>
                    {authStatus.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
                  </div>
                  <div className={`text-sm ${config.subtextClass}`}>
                    {authStatus.authenticated
                      ? t('agents.login.reAuthDescription')
                      : t('agents.login.description', { agent: config.name })}
                  </div>
                </div>
                <Button
                  onClick={onLogin}
                  className={`${config.buttonClass} text-white`}
                  size="sm"
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  {authStatus.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
                </Button>
              </div>
            )}
          </div>

          {authStatus.error && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="text-sm text-red-600 dark:text-red-400">
                {t('agents.error', { error: authStatus.error })}
              </div>
            </div>
          )}

          {agent !== 'pi' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <UsageProviderQuota provider={agent} enabled={usageEnabled} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
