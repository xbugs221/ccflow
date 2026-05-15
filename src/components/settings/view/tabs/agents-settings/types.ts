import type {
  AgentProvider,
  AuthStatus,
} from '../../../types/types';

export type AgentContext = {
  authStatus: AuthStatus;
  onLogin: () => void;
};

export type AgentContextByProvider = Record<AgentProvider, AgentContext>;

export type AgentsSettingsTabProps = {
  usageEnabled?: boolean;
  codexAuthStatus: AuthStatus;
  opencodeAuthStatus: AuthStatus;
  piAuthStatus: AuthStatus;
  onCodexLogin: () => void;
  onOpencodeLogin: () => void;
};

export type AgentSelectorSectionProps = {
  selectedAgent: AgentProvider;
  onSelectAgent: (agent: AgentProvider) => void;
  agentContextById: AgentContextByProvider;
};

export type AgentCategoryContentSectionProps = {
  usageEnabled?: boolean;
  selectedAgent: AgentProvider;
  agentContextById: AgentContextByProvider;
};
