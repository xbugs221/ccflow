// PURPOSE: Render account connection details and provider-scoped quota for one agent.
import { LogIn } from 'lucide-react';
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
  claude: {
    name: 'Claude',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
    borderClass: 'border-blue-200 dark:border-blue-800',
    textClass: 'text-blue-900 dark:text-blue-100',
    subtextClass: 'text-blue-700 dark:text-blue-300',
    buttonClass: 'bg-blue-600 hover:bg-blue-700',
  },
  codex: {
    name: 'Codex',
    bgClass: 'bg-gray-100 dark:bg-gray-800/50',
    borderClass: 'border-gray-300 dark:border-gray-600',
    textClass: 'text-gray-900 dark:text-gray-100',
    subtextClass: 'text-gray-700 dark:text-gray-300',
    buttonClass: 'bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600',
  },
};

/**
 * Prefer provider-specific copy when Claude is backed by a compatible gateway.
 */
function getConnectionLabel(agent: AgentProvider, authStatus: AuthStatus, fallbackLabel: string) {
  if (agent === 'claude' && authStatus.provider === 'kimi') {
    return 'Kimi provider';
  }

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
                {authStatus.loading ? (
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
          </div>

          {authStatus.error && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="text-sm text-red-600 dark:text-red-400">
                {t('agents.error', { error: authStatus.error })}
              </div>
            </div>
          )}

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <UsageProviderQuota provider={agent} enabled={usageEnabled} />
          </div>
        </div>
      </div>
    </div>
  );
}
