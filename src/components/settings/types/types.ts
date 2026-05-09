import type { Dispatch, SetStateAction } from 'react';

export type SettingsMainTab = 'agents' | 'appearance' | 'git' | 'api' | 'diagnostics';
export type AgentProvider = 'codex' | 'opencode';
export type AgentCategory = 'account' | 'mcp';
export type ProjectSortOrder = 'name' | 'date';
export type SaveStatus = 'success' | 'error' | null;
export type CodexPermissionMode = 'bypassPermissions';

export type SettingsProject = {
  name: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

export type AuthStatus = {
  authenticated: boolean;
  email: string | null;
  loading: boolean;
  error: string | null;
  provider?: string | null;
  baseUrl?: string | null;
};

export type KeyValueMap = Record<string, string>;

export type McpServerConfig = {
  command?: string;
  args?: string[];
  env?: KeyValueMap;
  url?: string;
  headers?: KeyValueMap;
  timeout?: number;
};

export type McpServer = {
  id?: string;
  name: string;
  type?: string;
  scope?: string;
  projectPath?: string;
  config?: McpServerConfig;
  raw?: unknown;
  created?: string;
  updated?: string;
};

export type CodexMcpFormConfig = {
  command: string;
  args: string[];
  env: KeyValueMap;
};

export type CodexMcpFormState = {
  name: string;
  type: 'stdio';
  config: CodexMcpFormConfig;
};

export type CodeEditorSettingsState = {
  theme: 'dark' | 'light';
  wordWrap: boolean;
  showMinimap: boolean;
  lineNumbers: boolean;
  fontSize: string;
};

export type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects?: SettingsProject[];
  initialTab?: string;
};

export type SetState<T> = Dispatch<SetStateAction<T>>;
