// PURPOSE: Render account connection details and provider-scoped quota for one agent.
import { LogIn } from 'lucide-react';
import type { TFunction } from 'i18next';
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
  opencode: {
    name: 'OpenCode',
    bgClass: 'bg-orange-50 dark:bg-orange-900/20',
    borderClass: 'border-orange-200 dark:border-orange-800',
    textClass: 'text-orange-900 dark:text-orange-100',
    subtextClass: 'text-orange-700 dark:text-orange-300',
    buttonClass: 'bg-orange-600 hover:bg-orange-700',
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

function getConnectedProviderNames(authStatus: AuthStatus) {
  /**
   * Derive the provider names OpenCode reported as connected.
   */
  return (authStatus.providers || [])
    .filter((provider) => provider.connected)
    .map((provider) => provider.name)
    .filter(Boolean);
}

function getOpenCodeProviderSummary(authStatus: AuthStatus, connectedProviders: string[], t: TFunction) {
  /**
   * Prioritize failure diagnostics over the "available without provider" state.
   */
  if (connectedProviders.length > 0) {
    return t('agents.account.opencode.connectedProviders', { providers: connectedProviders.join(', ') });
  }
  if (authStatus.error) {
    return t('agents.error', { error: authStatus.error });
  }
  return t('agents.account.opencode.noProviders');
}

function getOpenCodeProviderHeadline(authStatus: AuthStatus, connectedProviders: string[], t: TFunction) {
  /**
   * Separate OpenCode CLI failure from the valid no-provider connection state.
   */
  if (authStatus.error && !authStatus.available) {
    return t('agents.authStatus.disconnected');
  }
  if (connectedProviders.length > 0) {
    return t('agents.authStatus.connected');
  }
  return t('agents.account.opencode.available');
}

function getOpenCodeConnectionText(authStatus: AuthStatus, t: TFunction) {
  /**
   * Report CLI availability separately from provider authentication.
   */
  if (authStatus.available) {
    if (authStatus.error) {
      return t('agents.account.opencode.providerStatusFailed');
    }
    return authStatus.providers?.some((provider) => provider.connected)
      ? t('agents.account.opencode.available')
      : t('agents.account.opencode.noProviders');
  }
  return t('agents.authStatus.notConnected');
}

function getOpenCodeProviderApiLabel(provider: NonNullable<AuthStatus['providers']>[number]) {
  /**
   * Build the compact API metadata label shown beside one OpenCode provider.
   */
  const authType = provider.authType || provider.api?.type;
  const pieces = [
    authType ? authType.toUpperCase() : null,
    provider.api?.baseUrl || null,
    provider.api?.keyPreview || null,
  ].filter(Boolean);
  return pieces.join(' · ');
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
  const connectedProviders = getConnectedProviderNames(authStatus);
  const opencodeProviderSummary = getOpenCodeProviderSummary(authStatus, connectedProviders, t);
  const opencodeProviderHeadline = getOpenCodeProviderHeadline(authStatus, connectedProviders, t);

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
                {agent === 'opencode' && !authStatus.loading ? (
                  getOpenCodeConnectionText(authStatus, t)
                ) : agent === 'pi' && !authStatus.loading ? (
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
              ) : authStatus.authenticated || (agent === 'opencode' && authStatus.available) ? (
                <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  {agent === 'opencode' ? t('agents.account.opencode.available') : t('agents.authStatus.connected')}
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                  {t('agents.authStatus.disconnected')}
                </Badge>
              )}
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            {agent === 'opencode' ? (
              <div>
                <div className={`font-medium ${config.textClass}`}>
                  {opencodeProviderHeadline}
                </div>
                <div className={`text-sm ${config.subtextClass}`}>
                  {opencodeProviderSummary}
                </div>
                {(authStatus.providers || []).length > 0 && (
                  <div className="mt-3 space-y-2">
                    {(authStatus.providers || []).map((provider) => (
                      <div
                        key={`${provider.name}-${provider.source || ''}`}
                        className="flex items-center justify-between gap-3 rounded border border-orange-200/70 bg-white/60 px-3 py-2 text-sm dark:border-orange-800/70 dark:bg-black/10"
                      >
                        <span className={config.textClass}>{provider.name}</span>
                        <span className={config.subtextClass}>{getOpenCodeProviderApiLabel(provider)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : agent === 'pi' ? (
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

          {agent !== 'opencode' && agent !== 'pi' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <UsageProviderQuota provider={agent} enabled={usageEnabled} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
