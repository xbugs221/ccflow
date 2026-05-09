// PURPOSE: Coordinate settings modal state, persistence, auth checks, and MCP actions.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../../contexts/ThemeContext';
import { authenticatedFetch } from '../../../utils/api';
import {
  readProjectSortOrderSetting,
  writeProjectSortOrderSetting,
} from '../../../utils/settingsStorage';
import {
  AUTH_STATUS_ENDPOINTS,
  DEFAULT_AUTH_STATUS,
  DEFAULT_CODE_EDITOR_SETTINGS,
} from '../constants/constants';
import type {
  AgentProvider,
  AuthStatus,
  CodeEditorSettingsState,
  CodexMcpFormState,
  CodexPermissionMode,
  McpServer,
  ProjectSortOrder,
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
  authenticated?: boolean;
  email?: string | null;
  error?: string | null;
  provider?: string | null;
  baseUrl?: string | null;
};

type JsonResult = {
  success?: boolean;
  error?: string;
};

type McpReadResponse = {
  success?: boolean;
  servers?: McpServer[];
};

type McpCliServer = {
  name: string;
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

type McpCliReadResponse = {
  success?: boolean;
  servers?: McpCliServer[];
};

type CodexSettingsStorage = {
  permissionMode?: CodexPermissionMode;
};

type ActiveLoginProvider = AgentProvider | '';

const KNOWN_MAIN_TABS: SettingsMainTab[] = ['appearance', 'git', 'api', 'agents', 'diagnostics'];

/**
 * Resolve external settings tab names into a supported panel, using appearance
 * as the default entry point for the settings modal.
 */
const normalizeMainTab = (tab: string): SettingsMainTab => {
  // Keep backwards compatibility with older callers that still pass retired tabs.
  if (tab === 'tools' || tab === 'tasks') {
    return 'agents';
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

const readCodeEditorSettings = (): CodeEditorSettingsState => ({
  theme: localStorage.getItem('codeEditorTheme') === 'light' ? 'light' : 'dark',
  wordWrap: localStorage.getItem('codeEditorWordWrap') === 'true',
  showMinimap: localStorage.getItem('codeEditorShowMinimap') !== 'false',
  lineNumbers: localStorage.getItem('codeEditorLineNumbers') !== 'false',
  fontSize: localStorage.getItem('codeEditorFontSize') ?? DEFAULT_CODE_EDITOR_SETTINGS.fontSize,
});

const mapCliServersToMcpServers = (servers: McpCliServer[] = []): McpServer[] => (
  servers.map((server) => ({
    id: server.name,
    name: server.name,
    type: server.type || 'stdio',
    scope: 'user',
    config: {
      command: server.command || '',
      args: server.args || [],
      env: server.env || {},
      url: server.url || '',
      headers: server.headers || {},
      timeout: 30000,
    },
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }))
);

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

export function useSettingsController({ isOpen, initialTab, projects, onClose }: UseSettingsControllerArgs) {
  const { isDarkMode, toggleDarkMode } = useTheme() as ThemeContextValue;
  const closeTimerRef = useRef<number | null>(null);

  const [activeTab, setActiveTab] = useState<SettingsMainTab>(() => normalizeMainTab(initialTab));
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [codeEditorSettings, setCodeEditorSettings] = useState<CodeEditorSettingsState>(() => (
    readCodeEditorSettings()
  ));

  const [codexPermissionMode, setCodexPermissionMode] = useState<CodexPermissionMode>('bypassPermissions');

  const [codexMcpServers, setCodexMcpServers] = useState<McpServer[]>([]);

  const [showCodexMcpForm, setShowCodexMcpForm] = useState(false);
  const [editingCodexMcpServer, setEditingCodexMcpServer] = useState<McpServer | null>(null);

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState<ActiveLoginProvider>('');
  const [selectedProject, setSelectedProject] = useState<SettingsProject | null>(null);

  const [codexAuthStatus, setCodexAuthStatus] = useState<AuthStatus>(DEFAULT_AUTH_STATUS);

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
      // OpenCode auth status is managed locally since it uses local CLI
      return;
    }
  }, []);

  const checkAuthStatus = useCallback(async (provider: AgentProvider) => {
    /**
     * PURPOSE: Skip the network probe for local CLI providers (OpenCode)
     * since they don't require remote authentication.
     */
    if (provider === 'opencode') {
      setAuthStatusByProvider(provider, {
        authenticated: true,
        email: null,
        loading: false,
        error: null,
      });
      return;
    }
    try {
      const response = await authenticatedFetch(AUTH_STATUS_ENDPOINTS[provider]);

      if (!response.ok) {
        setAuthStatusByProvider(provider, {
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status',
        });
        return;
      }

      const data = await toResponseJson<StatusApiResponse>(response);
      setAuthStatusByProvider(provider, {
        authenticated: Boolean(data.authenticated),
        email: data.email || null,
        loading: false,
        error: data.error || null,
        provider: data.provider || null,
        baseUrl: data.baseUrl || null,
      });
    } catch (error) {
      console.error(`Error checking ${provider} auth status:`, error);
      setAuthStatusByProvider(provider, {
        authenticated: false,
        email: null,
        loading: false,
        error: getErrorMessage(error),
      });
    }
  }, [setAuthStatusByProvider]);

  const fetchCodexMcpServers = useCallback(async () => {
    try {
      const configResponse = await authenticatedFetch('/api/codex/mcp/config/read');

      if (configResponse.ok) {
        const configData = await toResponseJson<McpReadResponse>(configResponse);
        if (configData.success && configData.servers) {
          setCodexMcpServers(configData.servers);
          return;
        }
      }

      const cliResponse = await authenticatedFetch('/api/codex/mcp/cli/list');
      if (!cliResponse.ok) {
        return;
      }

      const cliData = await toResponseJson<McpCliReadResponse>(cliResponse);
      if (!cliData.success || !cliData.servers) {
        return;
      }

      setCodexMcpServers(mapCliServersToMcpServers(cliData.servers));
    } catch (error) {
      console.error('Error fetching Codex MCP servers:', error);
    }
  }, []);

  const deleteCodexMcpServer = useCallback(async (serverId: string) => {
    const response = await authenticatedFetch(`/api/codex/mcp/cli/remove/${serverId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await toResponseJson<JsonResult>(response);
      throw new Error(error.error || 'Failed to delete server');
    }

    const result = await toResponseJson<JsonResult>(response);
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete Codex MCP server');
    }
  }, []);

  const saveCodexMcpServer = useCallback(
    async (serverData: CodexMcpFormState, editingServer: McpServer | null) => {
      const response = await authenticatedFetch('/api/codex/mcp/cli/add', {
        method: 'POST',
        body: JSON.stringify({
          name: serverData.name,
          command: serverData.config.command,
          args: serverData.config.args || [],
          env: serverData.config.env || {},
        }),
      });

      if (!response.ok) {
        const error = await toResponseJson<JsonResult>(response);
        throw new Error(error.error || 'Failed to save server');
      }

      const result = await toResponseJson<JsonResult>(response);
      if (!result.success) {
        throw new Error(result.error || 'Failed to save Codex MCP server');
      }

      if (!editingServer?.name || editingServer.name === serverData.name) {
        return;
      }

      try {
        await deleteCodexMcpServer(editingServer.name);
      } catch (error) {
        console.warn('Saved Codex MCP server update but failed to remove the previous server entry.', {
          previousServerName: editingServer.name,
          error: getErrorMessage(error),
        });
      }
    },
    [deleteCodexMcpServer],
  );

  const submitCodexMcpForm = useCallback(
    async (formData: CodexMcpFormState, editingServer: McpServer | null) => {
      await saveCodexMcpServer(formData, editingServer);
      await fetchCodexMcpServers();
      setSaveStatus('success');
      setShowCodexMcpForm(false);
      setEditingCodexMcpServer(null);
    },
    [fetchCodexMcpServers, saveCodexMcpServer],
  );

  const handleCodexMcpDelete = useCallback(
    async (serverName: string) => {
      if (!window.confirm('Are you sure you want to delete this MCP server?')) {
        return;
      }

      setDeleteError(null);
      try {
        await deleteCodexMcpServer(serverName);
        await fetchCodexMcpServers();
        setDeleteError(null);
        setSaveStatus('success');
      } catch (error) {
        setDeleteError(getErrorMessage(error));
        setSaveStatus('error');
      }
    },
    [deleteCodexMcpServer, fetchCodexMcpServers],
  );

  const loadSettings = useCallback(async () => {
    try {
      setProjectSortOrder(readProjectSortOrderSetting());

      const savedCodexSettings = parseJson<CodexSettingsStorage>(
        localStorage.getItem('codex-settings'),
        {},
      );
      setCodexPermissionMode(toCodexPermissionMode(savedCodexSettings.permissionMode));

      await fetchCodexMcpServers();
    } catch (error) {
      console.error('Error loading settings:', error);
      setCodexPermissionMode('bypassPermissions');
      setProjectSortOrder('name');
    }
  }, [fetchCodexMcpServers]);

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
      const now = new Date().toISOString();
      writeProjectSortOrderSetting(projectSortOrder, now);

      localStorage.setItem('codex-settings', JSON.stringify({
        permissionMode: codexPermissionMode,
        lastUpdated: now,
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
    projectSortOrder,
  ]);

  const updateCodeEditorSetting = useCallback(
    <K extends keyof CodeEditorSettingsState>(key: K, value: CodeEditorSettingsState[K]) => {
      setCodeEditorSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const openCodexMcpForm = useCallback((server?: McpServer) => {
    setEditingCodexMcpServer(server || null);
    setShowCodexMcpForm(true);
  }, []);

  const closeCodexMcpForm = useCallback(() => {
    setShowCodexMcpForm(false);
    setEditingCodexMcpServer(null);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab(normalizeMainTab(initialTab));
    void loadSettings();
    void checkAuthStatus('codex');
  }, [checkAuthStatus, initialTab, isOpen, loadSettings]);

  useEffect(() => {
    localStorage.setItem('codeEditorTheme', codeEditorSettings.theme);
    localStorage.setItem('codeEditorWordWrap', String(codeEditorSettings.wordWrap));
    localStorage.setItem('codeEditorShowMinimap', String(codeEditorSettings.showMinimap));
    localStorage.setItem('codeEditorLineNumbers', String(codeEditorSettings.lineNumbers));
    localStorage.setItem('codeEditorFontSize', codeEditorSettings.fontSize);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorSettings]);

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
    deleteError,
    projectSortOrder,
    setProjectSortOrder,
    codeEditorSettings,
    updateCodeEditorSetting,
    codexPermissionMode,
    setCodexPermissionMode,
    codexMcpServers,
    showCodexMcpForm,
    editingCodexMcpServer,
    openCodexMcpForm,
    closeCodexMcpForm,
    submitCodexMcpForm,
    handleCodexMcpDelete,
    codexAuthStatus,
    openLoginForProvider,
    showLoginModal,
    setShowLoginModal,
    loginProvider,
    selectedProject,
    handleLoginComplete,
    saveSettings,
  };
}
