// PURPOSE: Coordinate settings modal state, persistence, and provider status checks.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../../contexts/ThemeContext';
import { authenticatedFetch } from '../../../utils/api';
import {
  AUTH_STATUS_ENDPOINTS,
  DEFAULT_AUTH_STATUS,
} from '../constants/constants';
import type {
  AgentProvider,
  AuthStatus,
  CodexPermissionMode,
  SettingsMainTab,
  SettingsProject,
} from '../types/types';

type ThemeContextValue = {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
};

type UseSettingsControllerArgs = {
  isOpen: boolean;
  initialTab: string;
  projects: SettingsProject[];
  onClose: () => void;
};

type StatusApiResponse = {
  available?: boolean;
  authenticated?: boolean;
  email?: string | null;
  error?: string | null;
  provider?: string | null;
  baseUrl?: string | null;
  providers?: Array<{
    name?: string;
    connected?: boolean;
    available?: boolean;
    source?: string | null;
    authType?: string | null;
    api?: {
      type?: string | null;
      baseUrl?: string | null;
      keyPreview?: string | null;
    } | null;
  }>;
};

type CodexSettingsStorage = {
  permissionMode?: CodexPermissionMode;
};

type ActiveLoginProvider = AgentProvider | '';

const KNOWN_MAIN_TABS: SettingsMainTab[] = ['appearance', 'agents', 'diagnostics'];

/**
 * Resolve external settings tab names into a supported panel, using appearance
 * as the default entry point for the settings modal.
 */
const normalizeMainTab = (tab: string): SettingsMainTab => {
  // Keep backwards compatibility with older callers that still pass retired tabs.
  if (tab === 'tools' || tab === 'tasks') {
    return 'agents';
  }
  if (tab === 'git' || tab === 'api') {
    return 'appearance';
  }

  return KNOWN_MAIN_TABS.includes(tab as SettingsMainTab) ? (tab as SettingsMainTab) : 'appearance';
};

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Unknown error'
);

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toCodexPermissionMode = (_value: unknown): CodexPermissionMode => {
  return 'bypassPermissions';
};

const getDefaultProject = (projects: SettingsProject[]): SettingsProject => {
  if (projects.length > 0) {
    return projects[0];
  }

  const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '';
  return {
    name: 'default',
    displayName: 'default',
    fullPath: cwd,
    path: cwd,
  };
};

const toResponseJson = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;

const readStatusError = async (response: Response): Promise<string> => {
  /**
   * Preserve provider-specific status errors so settings can show actionable
   * local CLI failures instead of a generic disconnected state.
   */
  try {
    const data = await toResponseJson<StatusApiResponse>(response);
    return data.error || 'Failed to check authentication status';
  } catch {
    return 'Failed to check authentication status';
  }
};

const normalizeOpenCodeProviders = (providers: StatusApiResponse['providers'] = []) => (
  providers
    .map((provider) => ({
      name: provider.name || '',
      connected: Boolean(provider.connected ?? provider.available),
      source: provider.source || null,
      authType: provider.authType || provider.api?.type || null,
      api: provider.api || null,
    }))
    .filter((provider) => provider.name)
);

export function useSettingsController({ isOpen, initialTab, projects, onClose }: UseSettingsControllerArgs) {
  const { isDarkMode, toggleDarkMode } = useTheme() as ThemeContextValue;
  const closeTimerRef = useRef<number | null>(null);

  const [activeTab, setActiveTab] = useState<SettingsMainTab>(() => normalizeMainTab(initialTab));
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);

  const [codexPermissionMode, setCodexPermissionMode] = useState<CodexPermissionMode>('bypassPermissions');

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState<ActiveLoginProvider>('');
  const [selectedProject, setSelectedProject] = useState<SettingsProject | null>(null);

  const [codexAuthStatus, setCodexAuthStatus] = useState<AuthStatus>(DEFAULT_AUTH_STATUS);
  const [opencodeAuthStatus, setOpencodeAuthStatus] = useState<AuthStatus>({
    ...DEFAULT_AUTH_STATUS,
    loading: true,
  });

  /**
   * PURPOSE: Route auth status updates to the correct provider's state slot so
   * a 404 on one provider's status endpoint cannot pollute another provider.
   */
  const setAuthStatusByProvider = useCallback((provider: AgentProvider, status: AuthStatus) => {
    if (provider === 'codex') {
      setCodexAuthStatus(status);
      return;
    }

    if (provider === 'opencode') {
      setOpencodeAuthStatus(status);
      return;
    }
  }, []);

  const checkAuthStatus = useCallback(async (provider: AgentProvider) => {
    try {
      const response = await authenticatedFetch(AUTH_STATUS_ENDPOINTS[provider]);

      if (!response.ok) {
        const error = await readStatusError(response);
        setAuthStatusByProvider(provider, {
          available: false,
          authenticated: false,
          email: null,
          loading: false,
          error,
        });
        return;
      }

      const data = await toResponseJson<StatusApiResponse>(response);
      setAuthStatusByProvider(provider, {
        available: data.available,
        authenticated: Boolean(data.authenticated),
        email: data.email || null,
        loading: false,
        error: data.error || null,
        provider: data.provider || null,
        baseUrl: data.baseUrl || null,
        providers: provider === 'opencode' ? normalizeOpenCodeProviders(data.providers) : undefined,
      });
    } catch (error) {
      console.error(`Error checking ${provider} auth status:`, error);
      setAuthStatusByProvider(provider, {
        available: false,
        authenticated: false,
        email: null,
        loading: false,
        error: getErrorMessage(error),
      });
    }
  }, [setAuthStatusByProvider]);

  const loadSettings = useCallback(async () => {
    try {
      const savedCodexSettings = parseJson<CodexSettingsStorage>(
        localStorage.getItem('codex-settings'),
        {},
      );
      setCodexPermissionMode(toCodexPermissionMode(savedCodexSettings.permissionMode));
    } catch (error) {
      console.error('Error loading settings:', error);
      setCodexPermissionMode('bypassPermissions');
    }
  }, []);

  const openLoginForProvider = useCallback((provider: AgentProvider) => {
    /**
     * PURPOSE: OpenCode uses local CLI authentication, so skip the login modal.
     */
    if (provider === 'opencode') {
      return;
    }
    setLoginProvider(provider);
    setSelectedProject(getDefaultProject(projects));
    setShowLoginModal(true);
  }, [projects]);

  const handleLoginComplete = useCallback((exitCode: number) => {
    if (exitCode !== 0 || !loginProvider) {
      return;
    }

    setSaveStatus('success');
    void checkAuthStatus(loginProvider);
  }, [checkAuthStatus, loginProvider]);

  const saveSettings = useCallback(() => {
    setIsSaving(true);
    setSaveStatus(null);

    try {
      localStorage.setItem('codex-settings', JSON.stringify({
        permissionMode: codexPermissionMode,
        lastUpdated: new Date().toISOString(),
      }));

      setSaveStatus('success');
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      closeTimerRef.current = window.setTimeout(() => onClose(), 1000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [
    codexPermissionMode,
    onClose,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab(normalizeMainTab(initialTab));
    void loadSettings();
    void checkAuthStatus('codex');
    void checkAuthStatus('opencode');
  }, [checkAuthStatus, initialTab, isOpen, loadSettings]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  return {
    activeTab,
    setActiveTab,
    isDarkMode,
    toggleDarkMode,
    isSaving,
    saveStatus,
    codexPermissionMode,
    setCodexPermissionMode,
    codexAuthStatus,
    opencodeAuthStatus,
    openLoginForProvider,
    showLoginModal,
    setShowLoginModal,
    loginProvider,
    selectedProject,
    handleLoginComplete,
    saveSettings,
  };
}
