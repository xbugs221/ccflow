import type { Dispatch, SetStateAction } from 'react';

export type SettingsMainTab = 'agents' | 'appearance' | 'diagnostics';
export type AgentProvider = 'codex' | 'opencode';
export type SaveStatus = 'success' | 'error' | null;
export type CodexPermissionMode = 'bypassPermissions';

export type SettingsProject = {
  name: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

export type AuthStatus = {
  available?: boolean;
  authenticated: boolean;
  email: string | null;
  loading: boolean;
  error: string | null;
  provider?: string | null;
  baseUrl?: string | null;
  providers?: Array<{
    name: string;
    connected: boolean;
    source?: string | null;
    authType?: string | null;
    api?: {
      type?: string | null;
      baseUrl?: string | null;
      keyPreview?: string | null;
    } | null;
  }>;
};

export type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects?: SettingsProject[];
  initialTab?: string;
};

export type SetState<T> = Dispatch<SetStateAction<T>>;
