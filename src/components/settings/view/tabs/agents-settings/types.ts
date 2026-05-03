import type {
  AgentProvider,
  AuthStatus,
  AgentCategory,
  McpServer,
  McpToolsResult,
  McpTestResult,
} from '../../../types/types';

export type AgentContext = {
  authStatus: AuthStatus;
  onLogin: () => void;
};

export type AgentContextByProvider = Record<AgentProvider, AgentContext>;

export type AgentsSettingsTabProps = {
  usageEnabled?: boolean;
  claudeAuthStatus: AuthStatus;
  codexAuthStatus: AuthStatus;
  opencodeAuthStatus: AuthStatus;
  onClaudeLogin: () => void;
  onCodexLogin: () => void;
  onOpencodeLogin: () => void;
  mcpServers: McpServer[];
  codexMcpServers: McpServer[];
  mcpTestResults: Record<string, McpTestResult>;
  mcpServerTools: Record<string, McpToolsResult>;
  mcpToolsLoading: Record<string, boolean>;
  deleteError: string | null;
  onOpenMcpForm: (server?: McpServer) => void;
  onDeleteMcpServer: (serverId: string, scope?: string, projectPath?: string) => void;
  onTestMcpServer: (serverId: string, scope?: string) => void;
  onDiscoverMcpTools: (serverId: string, scope?: string) => void;
  onOpenCodexMcpForm: (server?: McpServer) => void;
  onDeleteCodexMcpServer: (serverId: string) => void;
};

export type AgentCategoryTabsSectionProps = {
  selectedCategory: AgentCategory;
  onSelectCategory: (category: AgentCategory) => void;
};

export type AgentSelectorSectionProps = {
  selectedAgent: AgentProvider;
  onSelectAgent: (agent: AgentProvider) => void;
  agentContextById: AgentContextByProvider;
};

export type AgentCategoryContentSectionProps = {
  usageEnabled?: boolean;
  selectedAgent: AgentProvider;
  selectedCategory: AgentCategory;
  agentContextById: AgentContextByProvider;
  mcpServers: McpServer[];
  codexMcpServers: McpServer[];
  mcpTestResults: Record<string, McpTestResult>;
  mcpServerTools: Record<string, McpToolsResult>;
  mcpToolsLoading: Record<string, boolean>;
  deleteError: string | null;
  onOpenMcpForm: (server?: McpServer) => void;
  onDeleteMcpServer: (serverId: string, scope?: string, projectPath?: string) => void;
  onTestMcpServer: (serverId: string, scope?: string) => void;
  onDiscoverMcpTools: (serverId: string, scope?: string) => void;
  onOpenCodexMcpForm: (server?: McpServer) => void;
  onDeleteCodexMcpServer: (serverId: string) => void;
};
