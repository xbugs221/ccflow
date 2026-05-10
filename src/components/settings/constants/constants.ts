import type {
  AgentProvider,
  AuthStatus,
  SettingsMainTab,
} from '../types/types';

export const SETTINGS_MAIN_TABS: SettingsMainTab[] = [
  'appearance',
  'agents',
  'diagnostics',
];

export const AGENT_PROVIDERS: AgentProvider[] = ['codex', 'opencode'];
export const DEFAULT_SAVE_STATUS = null;

export const DEFAULT_AUTH_STATUS: AuthStatus = {
  authenticated: false,
  email: null,
  loading: true,
  error: null,
  provider: null,
  baseUrl: null,
};

export const AUTH_STATUS_ENDPOINTS: Partial<Record<AgentProvider, string>> = {
  codex: '/api/cli/codex/status',
  opencode: '/api/cli/opencode/status',
};
